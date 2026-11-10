// The shapes the models must return, and the code that refuses to trust them.
//
// Model output is untrusted text. Three things here keep it honest:
//   parseLoose      survives fences, prose around the JSON and wrong shapes
//   checkQuestion   a question the student will read has to pass hard rules
//   findQuote       a "quote" only counts if the student really said it
//
// Schemas are kept to the lowest common denominator on purpose: strings, enums
// and arrays, every field required. Optional and nullable fields, and numeric
// ranges, are exactly where open-weight models and structured-output providers
// disagree, so severity is the enum '1' | '2' | '3' rather than a number.

import { z } from 'zod';
import { TOPIC_KEYS, LIMITS } from './config.mjs';
import { BANNED_IN_QUESTIONS } from './copy.mjs';

export const QuestionOut = z.object({
  question: z.string(),
  mentions: z.array(
    z.object({
      topic: z.enum(TOPIC_KEYS),
      evidence: z.string(),
    }),
  ),
});

export const SafetyOut = z.object({
  label: z.enum(['ok', 'distress', 'minor', 'abuse']),
  pii: z.array(z.string()),
});

export const SummaryOut = z.object({
  topics: z.array(
    z.object({
      topic: z.enum(TOPIC_KEYS),
      quote: z.string(),
      severity: z.enum(['1', '2', '3']),
      note: z.string(),
    }),
  ),
  other: z.array(
    z.object({
      problem: z.string(),
      quote: z.string(),
    }),
  ),
  tools: z.array(z.string()),
  level: z.enum(['undergraduate', 'masters', 'phd', 'other', 'unknown']),
  gist: z.string(),
});

// The same convention the extension uses (factCheckParse): find the outermost
// braces, parse, validate. Returns the parsed value or null. Never throws.
export function parseLoose(text, schema) {
  if (typeof text !== 'string' || !text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let value;
  try {
    value = JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
  const result = schema.safeParse(value);
  return result.success ? result.data : null;
}

// Model-written prose that a person will read (a gist, a note). Long dashes
// become commas and the non-breaking hyphen becomes a plain one, so nothing the
// models write can put a dash on a page that the house style keeps free of them.
export function plain(input, max = 300) {
  return String(input || '')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/[\u2010\u2011]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Returns the cleaned question, or null if it breaks a rule. A null sends the
// engine to the scripted question for that topic.
export function checkQuestion(input) {
  if (typeof input !== 'string') return null;
  let q = input
    .replace(/[\u2014\u2013]/g, ', ') // no em or en dashes reach a student
    .replace(/[\u2010\u2011]/g, '-') // models like the non-breaking hyphen
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
  // A model that wraps its question in quotes means the question, not the quotes.
  q = q.replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').trim();

  if (q.length < 12 || q.length > LIMITS.questionMaxChars) return null;
  if (!q.endsWith('?')) return null;
  // Exactly one question. Two question marks is two questions, and a student
  // answers only the last one.
  if ((q.match(/\?/g) || []).length !== 1) return null;
  if (/https?:\/\/|www\./i.test(q)) return null;
  if (/[<>{}\[\]`]/.test(q)) return null;

  const lower = q.toLowerCase();
  if (BANNED_IN_QUESTIONS.some((term) => lower.includes(term))) return null;
  return q;
}

// --- quote verification ------------------------------------------------------
//
// Normalise for comparison (case, curly quotes, runs of whitespace, unicode
// compatibility forms) while remembering where each normalised character came
// from, so a match can be cut out of the ORIGINAL text. What gets stored is
// always the student's own characters, never the model's retyping of them.

const QUOTE_MAP = {
  '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'",
  '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u201f': '"',
  '\u2013': '-', '\u2014': '-',
};

function normalise(text) {
  const out = [];
  const map = [];
  let lastWasSpace = true; // drops leading whitespace
  const source = String(text || '');
  for (let i = 0; i < source.length; i += 1) {
    const original = source[i];
    const mapped = QUOTE_MAP[original] ?? original;
    for (const ch of mapped.normalize('NFKC').toLowerCase()) {
      if (/\s/.test(ch)) {
        if (!lastWasSpace) {
          out.push(' ');
          map.push(i);
          lastWasSpace = true;
        }
      } else {
        out.push(ch);
        map.push(i);
        lastWasSpace = false;
      }
    }
  }
  while (out.length && out[out.length - 1] === ' ') {
    out.pop();
    map.pop();
  }
  return { text: out.join(''), map };
}

// Is `needle` really inside `haystack`? Returns the exact original slice, or
// null. `min` guards against "quotes" too short to mean anything.
export function findInText(needle, haystack, min = 3) {
  const n = normalise(needle).text.replace(/^["']+|["']+$/g, '').replace(/[.\u2026]+$/g, '').trim();
  if (n.length < min) return null;
  const h = normalise(haystack);
  const at = h.text.indexOf(n);
  if (at < 0) return null;
  const start = h.map[at];
  const end = h.map[at + n.length - 1] + 1;
  return String(haystack).slice(start, end);
}

// Search the student's answers, and only their answers, for a quote. Returns
// { turn, text } with the original wording, or null.
export function findQuote(quote, turns, min = 8) {
  for (const turn of turns || []) {
    const found = findInText(quote, turn.answer, min);
    if (found) return { turn: turn.idx, text: found };
  }
  return null;
}
