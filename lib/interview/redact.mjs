// Remove personal details from a student's answer BEFORE it is stored or sent
// to the interviewer model.
//
// Pure functions, no network. This is the floor, not the whole defence: the
// safety classifier also returns name spans (applied by applySpans below), the
// consent screen asks students to leave names out, and the board can delete a
// session. Regexes over free text will always miss some names, which is why
// none of those other three are optional.
//
// Over-redaction is the right failure here. "my name is not important" losing
// two words costs nothing; a lecturer's name on a results board costs trust.

const RULES = [
  // Links first, so an address inside a URL is not half-eaten by a later rule.
  [/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, '[link]'],
  [/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi, '[email]'],
  // A phone number: at least 8 digits with the usual separators. A range of
  // years ("2023-2024") has eight digits too and is not one.
  [
    /(?<![\w@])\+?\d[\d\s().-]{6,}\d(?!\w)/g,
    '[phone]',
    // A bare run of digits is left for the ID rule below.
    (m) =>
      (m.match(/\d/g) || []).length >= 8 &&
      /\D/.test(m) &&
      !/^(?:19|20)\d\d[\s./-]+(?:19|20)\d\d$/.test(m),
  ],
  // Student or staff IDs: a few letters then five or more digits, or six or
  // more digits on their own. Five, not four, so a course code such as
  // COMP1511 survives: it is useful context and identifies nobody.
  [/\b[a-z]{1,4}[-/]?\d{5,}[a-z0-9]*\b/gi, '[id]'],
  [/\b\d{6,}\b/g, '[id]'],
  // @handles, but not the middle of an email (already gone) or a decorator.
  [/(?<![\w.@])@[a-z0-9_]{2,30}\b/gi, '[handle]'],
];

// "Professor Adams", "Dr. Okafor". The title stays, because "my professor" is
// useful and anonymous; only the name goes. The title may be any case but the
// name must be capitalised, or "my professor said" would lose the word "said".
// A lower-case name from speech-to-text is left to the classifier's spans.
const TITLED_NAME =
  /\b([Pp]rof(?:essor)?|[Dd]r|[Mm]rs?|[Mm]s|[Mm]iss|[Ss]ir|[Mm]adam)\.?\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)/gu;

// "my name is ...". Speech-to-text often returns lower case, so this cannot
// rely on a capital letter: it always takes the next word, and a second word
// only when that one is capitalised.
//
// No "i" flag: under it [A-Z] would match any letter, and the optional second
// word would swallow whatever followed the name ("Chidi and I ..." lost "and").
const SELF_NAME =
  /\b([Mm]y name is|[Mm]y name's|[Ii] am called|[Ii]'m called|[Tt]hey call me|[Cc]all me)\s+([\p{L}'-]+)(\s+[A-Z][\p{L}'-]+)?/gu;

export function redact(input) {
  let text = String(input || '');
  let count = 0;

  for (const [pattern, label, accept] of RULES) {
    text = text.replace(pattern, (match) => {
      if (accept && !accept(match)) return match;
      count += 1;
      return label;
    });
  }

  text = text.replace(TITLED_NAME, (_, title) => {
    count += 1;
    return `${title} [name]`;
  });

  text = text.replace(SELF_NAME, (_, lead) => {
    count += 1;
    return `${lead} [name]`;
  });

  return { text, count };
}

// Words the classifier sometimes returns as "names" that are nothing of the
// kind. Redacting "ChatGPT" out of an interview about AI tools would gut it.
const NOT_NAMES = new Set(
  [
    'chatgpt', 'gpt', 'claude', 'gemini', 'copilot', 'perplexity', 'grok', 'deepseek',
    'notebooklm', 'quizlet', 'chegg', 'grammarly', 'quillbot', 'turnitin', 'anki',
    'google', 'openai', 'microsoft', 'youtube', 'canvas', 'blackboard', 'moodle',
    'ai', 'i', 'me', 'my', 'lecturer', 'professor', 'teacher', 'tutor', 'friend',
  ].map((w) => w.toLowerCase()),
);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Apply name spans proposed by the classifier. A span is only honoured if it
// really occurs in the text, is a plausible length, and is not a tool name:
// the model's output is untrusted, and a span of "the" would blank the answer.
export function applySpans(input, spans) {
  let text = String(input || '');
  let count = 0;
  if (!Array.isArray(spans)) return { text, count };

  const seen = new Set();
  for (const raw of spans.slice(0, 12)) {
    const span = String(raw || '').trim();
    const key = span.toLowerCase();
    if (span.length < 2 || span.length > 60) continue;
    if (seen.has(key) || NOT_NAMES.has(key)) continue;
    if (!/\p{L}/u.test(span) || /^\[.*\]$/.test(span)) continue;
    seen.add(key);

    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(span)}(?![\\p{L}\\p{N}])`, 'giu');
    text = text.replace(pattern, () => {
      count += 1;
      return '[name]';
    });
  }
  return { text, count };
}
