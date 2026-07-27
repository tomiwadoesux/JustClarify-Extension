// offscreen.js — turn the audio of a live tab into transcript lines (Deepgram).
//
// MV3 service workers have no DOM and therefore no getUserMedia, so every part
// of live listening happens here, inside the offscreen document background.js
// creates with reason "USER_MEDIA". The worker owns the UI, the key, and the
// fact-checking pipeline; this file owns exactly one job: audio in, text out.
//
// Worker -> here (chrome.runtime.onMessage, only when msg.target === "offscreen"):
//   JC_AUDIO_START  { streamId, apiKey, language } -> { ok:true } | { ok:false, error }
//   JC_AUDIO_STOP                                  -> { ok:true }
//   JC_AUDIO_STATUS                                -> { ok:true, running }
//
// here -> worker (chrome.runtime.sendMessage, no target field):
//   JC_AUDIO_TRANSCRIPT { text, isFinal, start }  start = seconds since capture began
//   JC_AUDIO_ERROR      { error }                 human-readable, safe to show verbatim
//   JC_AUDIO_ENDED      {}                        capture stopped, for any reason
//
// A failed JC_AUDIO_START reports through its response only — it never also
// emits JC_AUDIO_ERROR, so the worker can surface start failures once.

const DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen";
const TARGET_SAMPLE_RATE = 16000; // Deepgram linear16 input rate
const PROCESSOR_BUFFER = 4096; // ~85ms at 48kHz: small enough to feel live
const KEEPALIVE_MS = 8000; // Deepgram drops a socket that goes ~10s without audio
const MAX_PENDING_BYTES = TARGET_SAMPLE_RATE * 2 * 3; // ~3s of 16-bit mono

// The one live capture, or null. Every async callback re-checks `session === s`
// before touching anything, which is what makes stop and restart safe.
let session = null;
let sessionCounter = 0;

function emit(message) {
  // The worker may be asleep; sendMessage wakes it, but a rejected promise here
  // must never be allowed to break the audio pipeline.
  chrome.runtime.sendMessage(message).catch(() => {});
}

function emitError(error) {
  emit({ type: "JC_AUDIO_ERROR", error });
}

// ---------------------------------------------------------------- audio maths

// Box-filter decimation from the context rate (usually 48kHz) down to 16kHz.
// The read cursor lives on the session because 44.1kHz gives a fractional ratio
// (2.756…): dropping the remainder each callback would drift the clock.
function downsample(s, input, inputRate) {
  if (inputRate === TARGET_SAMPLE_RATE) return input;

  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const out = new Float32Array(Math.ceil(input.length / ratio) + 1);
  let count = 0;

  while (s.resampleCursor + ratio <= input.length) {
    const start = Math.max(0, Math.floor(s.resampleCursor));
    const end = Math.min(input.length, Math.floor(s.resampleCursor + ratio));
    let sum = 0;
    for (let i = start; i < end; i++) sum += input[i];
    out[count++] = end > start ? sum / (end - start) : 0;
    s.resampleCursor += ratio;
  }

  s.resampleCursor -= input.length; // carry the leftover into the next callback
  return out.subarray(0, count);
}

function encodePcm16(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    // Negative and positive halves have different scales; using 0x7fff for both
    // clips the loudest negative peaks.
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

// ------------------------------------------------------------------ transport

function sendAudio(s, chunk) {
  const socket = s.socket;
  if (socket && socket.readyState === WebSocket.OPEN) {
    if (s.pending.length) flushPending(s);
    try {
      socket.send(chunk);
    } catch (_) {
      // Socket died mid-send; onclose is already on its way with the reason.
    }
    return;
  }

  // Still shaking hands with Deepgram. Hold a little audio so the opening words
  // survive, but stale audio is worthless to a live fact-checker — past the cap
  // the oldest frames go first rather than growing the queue forever.
  s.pending.push(chunk);
  s.pendingBytes += chunk.byteLength;
  while (s.pendingBytes > MAX_PENDING_BYTES && s.pending.length > 1) {
    const dropped = s.pending.shift();
    s.pendingBytes -= dropped.byteLength;
    s.droppedSeconds += dropped.byteLength / 2 / TARGET_SAMPLE_RATE;
  }
}

function flushPending(s) {
  const socket = s.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const queued = s.pending;
  s.pending = [];
  s.pendingBytes = 0;
  for (const chunk of queued) {
    try {
      socket.send(chunk);
    } catch (_) {
      return;
    }
  }
}

function handleDeepgramMessage(s, data) {
  if (typeof data !== "string") return; // Deepgram replies are JSON text frames

  let payload;
  try {
    payload = JSON.parse(data);
  } catch (_) {
    return;
  }

  // Request-level problems (bad params, unsupported language) arrive in-band,
  // usually just before Deepgram closes the socket.
  if (payload.type === "Error" || payload.error) {
    const detail = payload.description || payload.error || payload.message || "unknown reason";
    emitError(`Deepgram couldn't transcribe this tab — ${String(detail).slice(0, 160)}`);
    return;
  }
  if (!payload.channel) return; // Metadata, SpeechStarted, UtteranceEnd…

  const alternative = payload.channel.alternatives && payload.channel.alternatives[0];
  const text = alternative && typeof alternative.transcript === "string" ? alternative.transcript.trim() : "";
  if (!text) return; // silence and pauses come through as empty transcripts

  // Deepgram counts from the first byte we sent, which is the first byte we
  // captured — except for anything the pending queue had to drop, so add that
  // back to keep `start` honest relative to when listening began.
  const start =
    typeof payload.start === "number"
      ? payload.start + s.droppedSeconds
      : (Date.now() - s.startedAt) / 1000;

  emit({
    type: "JC_AUDIO_TRANSCRIPT",
    text,
    isFinal: payload.is_final === true,
    start,
  });
}

// A socket that never opened is almost always a rejected key: the subprotocol
// handshake fails before any close code with detail reaches the page.
function closeMessage(code, opened) {
  if (!opened) return "Deepgram rejected the API key — check it in the JustClarify popup.";
  if (code === 1008 || code === 4001 || code === 4003) {
    return "Deepgram rejected the API key — check it in the JustClarify popup.";
  }
  if (code === 4008) return "Deepgram stopped listening because no audio was coming from this tab.";
  if (code === 1006) return "Lost the connection to Deepgram — check your internet, then start listening again.";
  if (code === 1011 || code === 1012 || code === 1013) {
    return "Deepgram had a server problem — wait a moment, then start listening again.";
  }
  return `Deepgram ended live transcription (code ${code}). Start listening again to reconnect.`;
}

function openSocket(s, apiKey, language) {
  const params = new URLSearchParams({
    encoding: "linear16",
    sample_rate: String(TARGET_SAMPLE_RATE),
    channels: "1",
    model: "nova-3",
    interim_results: "true",
    punctuate: "true",
    smart_format: "true",
    language: language || "en",
  });

  let socket;
  try {
    // A browser WebSocket can't set an Authorization header, so the key rides
    // in the subprotocol slot — Deepgram's documented browser auth.
    socket = new WebSocket(`${DEEPGRAM_URL}?${params.toString()}`, ["token", apiKey]);
  } catch (_) {
    return false;
  }

  socket.binaryType = "arraybuffer";
  s.socket = socket;

  socket.onopen = () => {
    if (session !== s) {
      try {
        socket.close();
      } catch (_) {}
      return;
    }
    s.opened = true;
    flushPending(s);
    s.keepAlive = setInterval(() => {
      if (session !== s || socket.readyState !== WebSocket.OPEN) return;
      // A quiet stretch of the broadcast would otherwise look like a dead
      // client and get the socket closed out from under us.
      try {
        socket.send(JSON.stringify({ type: "KeepAlive" }));
      } catch (_) {}
    }, KEEPALIVE_MS);
  };

  socket.onmessage = (event) => {
    if (session !== s) return;
    handleDeepgramMessage(s, event.data);
  };

  socket.onerror = () => {
    // WebSocket errors carry no detail by design; the onclose right behind this
    // one has the code, so let that path do the reporting.
  };

  socket.onclose = (event) => {
    if (session !== s) return;
    // 1000 means Deepgram wound down cleanly — that's an ending, not a fault.
    if (event.code !== 1000) emitError(closeMessage(event.code, s.opened));
    stopCapture();
  };

  return true;
}

// ------------------------------------------------------------------- lifecycle

async function startCapture(message) {
  const streamId = message && message.streamId;
  const apiKey = message && message.apiKey ? String(message.apiKey).trim() : "";

  if (!streamId) {
    return { ok: false, error: "JustClarify lost track of this tab — start listening again from the popup." };
  }
  if (!apiKey) {
    return { ok: false, error: "Add your Deepgram API key in the JustClarify popup to listen to live audio." };
  }

  // Double-start: the worker asked for a new tab or a new key without stopping.
  // The previous stream id is dead either way, so retire that session first —
  // quietly, because the worker replaced it deliberately and a JC_AUDIO_ENDED
  // arriving after its own START would read as "listening stopped".
  if (session) stopCapture({ notify: false });

  const s = {
    id: ++sessionCounter,
    startedAt: Date.now(),
    stream: null,
    audioContext: null,
    source: null,
    processor: null,
    mute: null,
    socket: null,
    keepAlive: null,
    opened: false,
    pending: [],
    pendingBytes: 0,
    droppedSeconds: 0,
    resampleCursor: 0,
  };
  session = s;

  let stream;
  try {
    // The legacy `mandatory` constraint form is the only one that accepts a
    // chrome.tabCapture stream id — the modern getDisplayMedia shape is ignored.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });
  } catch (_) {
    if (session === s) session = null;
    return {
      ok: false,
      error: "Couldn't capture this tab's audio — reload the page, then start listening again.",
    };
  }

  // Stopped while we were awaiting the stream: honour that, don't leak the mic.
  if (session !== s) {
    stream.getTracks().forEach((track) => track.stop());
    return { ok: false, error: "Listening was cancelled before it started." };
  }
  s.stream = stream;

  const track = stream.getAudioTracks()[0];
  if (!track) {
    stopCapture({ notify: false });
    return { ok: false, error: "This tab isn't playing any audio — start something playing, then try again." };
  }
  track.addEventListener("ended", () => {
    // Tab closed, navigated away, or the user hit Chrome's "stop sharing".
    if (session !== s) return;
    stopCapture();
  });

  const audioContext = new AudioContext();
  s.audioContext = audioContext;
  // Offscreen documents get no user gesture, so the context can come up
  // suspended and silently deliver nothing.
  audioContext.resume().catch(() => {});

  const source = audioContext.createMediaStreamSource(stream);
  s.source = source;

  // CRITICAL: chrome.tabCapture takes the audio away from the tab. Without this
  // single connection the user's video plays silently for as long as we listen,
  // which reads as "the extension broke my video". Do not remove it.
  source.connect(audioContext.destination);

  // ScriptProcessorNode is deprecated, and chosen deliberately: an AudioWorklet
  // needs its processor loaded through addModule(), and MV3's script-src 'self'
  // CSP blocks the usual blob: URL, so it would have to ship as a third file.
  // Deprecated-but-correct beats that, and Chrome still runs it fine.
  const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);
  s.processor = processor;
  processor.onaudioprocess = (event) => {
    if (session !== s) return;
    const input = event.inputBuffer.getChannelData(0);
    const samples = downsample(s, input, event.inputBuffer.sampleRate);
    if (samples.length) sendAudio(s, encodePcm16(samples));
  };

  // A ScriptProcessorNode only fires while something pulls it, so it has to
  // reach the destination — through a silent gain node, because the playback
  // path above already carries the real audio and we must not double it.
  const mute = audioContext.createGain();
  mute.gain.value = 0;
  s.mute = mute;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);

  if (!openSocket(s, apiKey, normalizeLanguage(message))) {
    stopCapture({ notify: false });
    return { ok: false, error: "Couldn't open a connection to Deepgram — check your API key in the JustClarify popup." };
  }

  return { ok: true };
}

function normalizeLanguage(message) {
  const value = message && message.language ? String(message.language).trim() : "";
  return value || "en";
}

// Idempotent by design: STOP when nothing is running is a no-op, and every
// failure path routes through here so no AudioContext or socket is left behind.
function stopCapture(options) {
  const s = session;
  if (!s) return;
  session = null;

  const notify = !options || options.notify !== false;

  if (s.keepAlive) clearInterval(s.keepAlive);

  if (s.socket) {
    const socket = s.socket;
    s.socket = null;
    // Detach first: we're abandoning this socket, and its own close event must
    // not re-enter teardown or report an error the user didn't cause.
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      // Lets Deepgram finalise and bill the session instead of timing it out.
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "CloseStream" }));
      }
      socket.close();
    } catch (_) {}
  }

  if (s.processor) {
    s.processor.onaudioprocess = null;
    try {
      s.processor.disconnect();
    } catch (_) {}
  }
  if (s.mute) {
    try {
      s.mute.disconnect();
    } catch (_) {}
  }
  if (s.source) {
    try {
      s.source.disconnect();
    } catch (_) {}
  }
  if (s.stream) {
    s.stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (_) {}
    });
  }
  if (s.audioContext) {
    s.audioContext.close().catch(() => {});
  }

  s.pending = [];
  s.pendingBytes = 0;

  if (notify) emit({ type: "JC_AUDIO_ENDED" });
}

// -------------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // The worker broadcasts plenty of other traffic through the same channel;
  // anything not addressed here must fall through to its real listener.
  if (!message || message.target !== "offscreen") return false;

  if (message.type === "JC_AUDIO_START") {
    startCapture(message).then(sendResponse, (e) => {
      // Nothing above is expected to throw, but a rejected START must still
      // answer or the worker waits forever on a dead promise.
      stopCapture({ notify: false });
      sendResponse({
        ok: false,
        error: `Live listening couldn't start — ${String((e && e.message) || e).slice(0, 160)}`,
      });
    });
    return true; // keep the channel open for the async response
  }

  if (message.type === "JC_AUDIO_STOP") {
    stopCapture();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "JC_AUDIO_STATUS") {
    sendResponse({ ok: true, running: session !== null });
    return false;
  }

  sendResponse({ ok: false, error: `Unknown offscreen message "${message.type}".` });
  return false;
});
