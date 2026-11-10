// Every sentence a student reads that a person wrote, in one place.
//
// Two reasons it is separate from the code. First, the support message and the
// consent wording are the parts of this page that have to be exactly right, and
// they should be reviewable without reading a state machine. Second, the model
// is never allowed to improvise any of these: when a student mentions distress
// the script stops and SUPPORT below is shown word for word.
//
// House rule: no em dashes anywhere in this file. tests/interview/unit.mjs
// fails the build if one appears.

export const GATE = {
  title: 'A five minute chat about how you study',
  intro:
    'We are building a study tool and want to hear how students really use AI. This is a short conversation, about six questions.',
  aiNotice:
    'You will be talking to an AI, not a person. It only asks questions. It will not give study help or advice.',
  kept: [
    'We keep the text of your answers so we can read them later.',
    'Voice notes are turned into text and the audio is thrown away. We never store audio.',
    'We do not ask for your name or email, and we do not store your IP address. Please leave out names, including your own and your lecturers.',
    'Your answers are stored on our own database. The AI services that process them are set not to keep them or train on them.',
    'You can stop at any time. At the end you get a reference code. To have your answers deleted, email us that code.',
  ],
  consent: 'I understand, and I agree to take part.',
  adult: 'I am 18 or older.',
  start: 'Start',
  needLink:
    'This interview opens from an invite link. Ask the person who shared it with you for the full link.',
  closed: 'The interview is closed right now. Please try again later.',
  full: 'We have reached the number of interviews we can run today. Please try again tomorrow.',
};

// The address already published on the privacy policy page.
export const CONTACT_EMAIL = 'hello@ayotomcs.me';

// Labels and short lines for the page itself. Kept here, with the rest of the
// copy, so the no-dash test covers every word a student can see.
export const UI = {
  brandTag: 'AI interviewer',
  placeholder: 'Type your answer',
  send: 'Send',
  record: 'Record a voice note',
  recording: 'Recording',
  stopRecording: 'Stop and use this',
  cancelRecording: 'Cancel',
  transcribing: 'Turning your voice note into text',
  review: 'Check the text below, fix anything it got wrong, then send.',
  micBlocked: 'The microphone is blocked or not available here. You can type your answer instead.',
  thinking: 'Thinking of the next question',
  progress: (n, max) => `Question ${n} of ${max}`,
  lastAnswer: 'Time is nearly up. Finish this answer and send it when you are ready.',
  stopLink: 'Stop interview',
  stopConfirm: 'Stop the interview now?',
  stopYes: 'Yes, stop',
  stopNo: 'Keep going',
  refLabel: 'Your reference code',
  deleteNote: 'To have your answers deleted, email this code to',
  loading: 'Loading',
  privacy: 'Privacy policy',
};

// Neutral on purpose. It names no problem, so anything the student raises in
// reply was raised by them, which is what makes "unprompted" measurable.
export const OPENER =
  'Tell me about the last time you used AI to study. What were you working on?';

// Used when the model's question fails validation or the model is down. One
// per topic, about the past, not leading.
export const FALLBACK_QUESTIONS = {
  trust:
    'Thinking of the last answer an AI gave you for your studies, how did you decide whether to believe it?',
  courseFit: 'How did the last AI explanation you got compare with what your lecturer taught?',
  learning:
    'After your last study session with AI, how did you find out whether you had really learned it?',
  paying: 'Which study or AI tools have you paid for or stopped paying for in the past year?',
  switching:
    'Which AI tools did you use for studying this past week, and what did you use each one for?',
  detection: 'What has your experience been with AI detection on your own assignments?',
  discovery: 'How did you first hear about the last study tool you started using?',
  device: 'When you study with AI, are you usually on your phone or a laptop?',
  examSpike: 'How does the way you use AI change in the weeks before exams?',
};

export const CLOSING =
  'That is everything. Thank you for your time. Your answers will shape what we build for students. You can close this page now.';

export const ENDED = 'No problem, we have stopped here. Thank you for your time.';

export const TIME_UP =
  'We are out of time, so we will stop here. Thank you, your answers will shape what we build for students.';

// Shown word for word when a student mentions distress. Written for students
// in any country, so it points at local emergency services and their own
// campus rather than one national line.
export const SUPPORT =
  "It sounds like things are hard right now, and I am only an AI, so I am not the right help. If you are in immediate danger, call your local emergency number. Your university's counselling or student support service can help, and findahelpline.com lists free support lines in most countries. We have stopped the interview here. Thank you for talking to us.";

export const UNDER_18 =
  'Thank you, but this interview is only for people aged 18 or over, so we have stopped here and deleted your answers.';

export const ERRORS = {
  generic: 'Something went wrong on our side. Please try again.',
  busy: 'Your last answer is still being read. Give it a moment.',
  tooMany: 'Too many requests. Please wait a moment and try again.',
  session: 'This interview session has ended. Open your invite link again to start a new one.',
  audioTooLong: 'That recording is too long. Please keep voice notes under 90 seconds.',
  audioBad: 'We could not read that recording. Please try again, or type your answer.',
  audioLimit: 'You have used all the voice notes for this interview. Please type your answer.',
  empty: 'Please type or record an answer first.',
};

// Phrases a model-written question may not contain. "Would you" is the mark of
// a hypothetical, and hypotheticals get answers about an imagined self.
export const BANNED_IN_QUESTIONS = [
  'justclarify',
  'just clarify',
  'would you',
  'our product',
  'our tool',
  'our app',
  'our extension',
  'imagine',
  'as an ai',
];
