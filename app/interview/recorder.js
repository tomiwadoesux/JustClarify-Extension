// Voice notes in the browser: one recording at a time, as small as possible.
//
// What it has to survive:
//   iOS Safari records mp4/aac, everything else records webm/opus. The first
//     supported type from MIME_ORDER is used and the server reads the real
//     container from the bytes.
//   In-app browsers (Instagram, some WhatsApp webviews) have no microphone API
//     at all. recordingSupported() says so and the page falls back to typing,
//     which is always available.
//   A phone that goes to sleep or switches app mid-recording. The recording is
//     stopped and kept rather than left running in the background.
//
// 32 kbps mono is plenty for speech and keeps a 90 second note around 360 KB.
// iOS may ignore the bitrate hint; the server's cap allows for that.

const MIME_ORDER = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

export function recordingSupported() {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

function pickMime() {
  for (const type of MIME_ORDER) {
    try {
      if (window.MediaRecorder.isTypeSupported(type)) return type;
    } catch (_) {}
  }
  return '';
}

// Resolves once recording has really started. Rejects if the microphone is
// refused or missing.
//
//   onTick(seconds)   once a second
//   onLevel(0..1)     roughly ten times a second, for the level bar
//   onAutoStop(blob)  the recording hit maxSeconds or the page was hidden
//
// Returns { stop(): Promise<Blob>, cancel() }.
export async function startRecording({ maxSeconds, onTick, onLevel, onAutoStop }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  const mimeType = pickMime();
  const recorder = new window.MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 32000,
  });

  const chunks = [];
  let finished = false;
  let cancelled = false;
  let seconds = 0;
  let tickTimer = null;
  let levelTimer = null;
  let audioContext = null;

  // The level bar is decoration. If the audio graph cannot be built, the
  // recording carries on without it.
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && onLevel) {
      audioContext = new Ctx();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      levelTimer = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i] - 128));
        onLevel(Math.min(1, peak / 90));
      }, 100);
    }
  } catch (_) {}

  function release() {
    clearInterval(tickTimer);
    clearInterval(levelTimer);
    document.removeEventListener('visibilitychange', onHidden);
    for (const track of stream.getTracks()) track.stop();
    if (audioContext) audioContext.close().catch(() => {});
  }

  const done = new Promise((resolve) => {
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => {
      release();
      resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
    };
    recorder.onerror = () => {
      release();
      resolve(new Blob([], { type: 'audio/webm' }));
    };
  });

  function finish() {
    if (finished) return done;
    finished = true;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch (_) {
      release();
    }
    return done;
  }

  async function auto() {
    if (finished) return;
    const blob = await finish();
    if (!cancelled && onAutoStop) onAutoStop(blob);
  }

  function onHidden() {
    if (document.visibilityState === 'hidden') auto();
  }
  document.addEventListener('visibilitychange', onHidden);

  tickTimer = setInterval(() => {
    seconds += 1;
    if (onTick) onTick(seconds);
    if (seconds >= maxSeconds) auto();
  }, 1000);

  // No timeslice: one blob at the end. Safari's chunked mp4 output is not a
  // valid file until it is finalised.
  recorder.start();

  return {
    stop: finish,
    cancel() {
      cancelled = true;
      finish();
    },
  };
}

export function fileNameFor(blob) {
  return String(blob?.type || '').includes('mp4') ? 'note.m4a' : 'note.webm';
}
