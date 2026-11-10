// Fixed facts about the student interview: what it asks about, how long it
// runs, which models it uses and how much it is allowed to spend in a day.
//
// Pure data, no imports, so the tests and the routes read the same numbers.
// This repo is public: nothing secret belongs here. Share-link codes live in
// the database and the caps can be overridden from the environment.

// The hidden checklist, in priority order. With one scripted opener and five
// model-written questions, an interview reaches about five of these; the order
// decides which ones. The first three are the needs the survey data pointed at,
// so they go first.
//
// `means` is what the interviewer model is told the topic covers. It is written
// as a neutral description of the student's behaviour and never presumes that
// something happened. The first live run showed why: a description that said
// "what they do when the two differ" produced "when the AI's answer did not
// match your lecturer, what did you do?", which puts a problem in the student's
// mouth. A leading topic description produces a leading question.
export const TOPICS = [
  {
    key: 'trust',
    label: 'Trusting the answer',
    means: 'how they decided whether an AI answer was correct',
  },
  {
    key: 'courseFit',
    label: 'Matching the course',
    means: 'how the AI answers compared with what their own lecturer, course or exam expects',
  },
  {
    key: 'learning',
    label: 'Really learning',
    means: 'how they found out whether they had actually learned the material after studying with AI',
  },
  {
    key: 'paying',
    label: 'Paying',
    means: 'what, if anything, they have paid for to help them study, and who paid',
  },
  {
    key: 'switching',
    label: 'Switching tools',
    means: 'which AI tools they used for studying recently, and what each one was for',
  },
  {
    key: 'detection',
    label: 'AI detection',
    means: 'what experience, if any, they have had with AI detection or AI rules on their own assignments',
  },
  {
    key: 'discovery',
    label: 'Finding tools',
    means: 'how they first heard about the study tools they use',
  },
  {
    key: 'device',
    label: 'Device',
    means: 'whether they study with AI on a phone or a laptop, and why',
  },
  {
    key: 'examSpike',
    label: 'Exam season',
    means: 'how their use of AI changes in the weeks before exams',
  },
];

export const TOPIC_KEYS = TOPICS.map((t) => t.key);

export const LIMITS = {
  // One scripted opener plus five follow-ups.
  maxTurns: 6,
  minutes: 5,
  // An answer that was already being spoken or typed when the clock ran out is
  // still taken. Cutting a student off mid-sentence is the rudest thing this
  // page could do.
  graceMs: 90_000,
  // How long one answer may be "in flight" before a retry is allowed.
  leaseSeconds: 45,
  maxAnswerChars: 1500,
  // Voice notes per session. More than turns, because a student may re-record.
  maxStt: 10,
  maxNoteSeconds: 90,
  // Under Vercel's 4.5 MB request limit with room for multipart overhead.
  maxAudioBytes: 3_000_000,
  questionMaxChars: 220,
};

// Open weights where they exist. The transcription list is tried in order.
//
// Both transcription models were chosen by testing, not from the price list:
// they accept what a browser actually records (webm/opus from Chrome and
// Android, mp4/aac from iPhones) AND they are zero-data-retention on every
// provider. microsoft/mai-transcribe-2 is cheaper but answers "Bad Request" to
// both of those containers; it only takes WAV. openai/gpt-4o-transcribe reads
// everything but is not zero-retention, so it is deliberately not a fallback:
// if both of these fail, the student types instead.
export const MODELS = {
  interviewer: 'openai/gpt-oss-120b',
  extractor: 'openai/gpt-oss-120b',
  safety: 'openai/gpt-oss-safeguard-20b',
  transcribe: ['mistral/voxtral-mini-transcribe-3', 'spacexai/grok-stt'],
};

function envInt(name, fallback) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Read at call time, not import time, so a changed env var takes effect on the
// next request and tests can import this file with no environment at all.
export function caps() {
  return {
    sessionsPerDay: envInt('JC_IV_CAP_SESSIONS', 200),
    // About 12 model calls per full interview: 6 safety, 5 interviewer, 1
    // extractor.
    llmCallsPerDay: envInt('JC_IV_CAP_LLM', 3000),
    sttSecondsPerDay: envInt('JC_IV_CAP_STT_SECONDS', 36_000),
  };
}

// The share link is required unless this is explicitly switched off.
export function linkRequired() {
  return (process.env.JC_IV_REQUIRE_LINK || 'on').toLowerCase() !== 'off';
}

// A hard off switch that needs no database: JC_INTERVIEW=off.
export function hardDisabled() {
  return (process.env.JC_INTERVIEW || '').toLowerCase() === 'off';
}
