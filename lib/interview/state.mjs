// The interview's state machine. Pure functions, no clock and no storage of
// its own: everything it needs is passed in.
//
// The rule this file exists to enforce: the model writes the wording, the code
// decides everything else. Which topic comes next, when the interview ends and
// whether a student raised something "unprompted" are all computed here from
// turn numbers, never taken from a model's say-so.

import { TOPIC_KEYS, LIMITS } from './config.mjs';

// Deterministic safety floor. It runs on every student message before the
// classifier and its verdict cannot be overruled by the model: if the
// classifier is down, slow or wrong, an explicit statement still stops the
// script.
//
// It is deliberately narrow. "This module is killing me" and "I'm dying over
// this exam" are how students talk, and showing a crisis message to someone
// complaining about a deadline would be both wrong and insulting. Only first
// person, explicit statements match.
const DISTRESS = [
  /\b(?:kill(?:ing)?|hurt(?:ing)?|harm(?:ing)?|cut(?:ting)?)\s+myself\b/i,
  /\bsuicid(?:e|al)\b/i,
  /\bself[\s-]?harm/i,
  /\b(?:end|ending|take|taking)\s+my\s+(?:own\s+)?life\b/i,
  /\b(?:want|wanted|wanting)\s+to\s+die\b/i,
  /\bdon'?t\s+want\s+to\s+(?:live|be\s+alive|be\s+here\s+any\s?more)\b/i,
  /\b(?:better\s+off\s+dead|no\s+reason\s+to\s+live)\b/i,
];

const UNITS = '(?:\\s*(?:min|mins|minutes|hours|hrs|days|weeks|months|percent|%|pages|credits|marks|points|modules|units|k\\b))';
const MINOR = [
  // "I'm 16", "I am 17 years old", but not "I'm 15 minutes late".
  new RegExp(`\\b(?:i\\s+am|i'm|im)\\s+(?:only\\s+|just\\s+)?1[0-7](?!\\d)(?!${UNITS})`, 'i'),
  /\b(?:i\s+am|i'm|im)\s+(?:only\s+)?(?:under\s*18|not\s+(?:yet\s+)?18)\b/i,
  /\b(?:i\s+am|i'm|im)\s+(?:still\s+)?(?:a|an|in)\s+(?:high|secondary|middle)\s+school\b/i,
  /\b(?:i\s+am|i'm|im)\s+in\s+(?:year|grade)\s+(?:[7-9]|1[01])\b/i,
];

export function safetyFloor(text) {
  const value = String(text || '');
  if (DISTRESS.some((pattern) => pattern.test(value))) return 'distress';
  if (MINOR.some((pattern) => pattern.test(value))) return 'minor';
  return null;
}

// Floor first, then the classifier. A missing classifier result means the call
// failed, which is recorded as "degraded" so the board can show how often the
// floor was the only check that ran.
export function decideSafety(floor, classified) {
  const label = floor || classified?.label || 'ok';
  return { label, degraded: !classified };
}

// Which topic the next question is about. Breadth first: anything the student
// has neither been asked nor raised themselves. Once those run out, go back to
// what they raised unprompted, because that is where their own words are.
export function nextTopic(asked = {}, mentioned = {}) {
  const untouched = TOPIC_KEYS.find((key) => asked[key] == null && mentioned[key] == null);
  if (untouched) return untouched;
  return TOPIC_KEYS.find((key) => asked[key] == null) || null;
}

// Record the first turn each topic was mentioned at. Later mentions never
// overwrite an earlier one.
export function withMentions(mentioned = {}, topics = [], turn) {
  const next = { ...mentioned };
  for (const topic of topics) {
    if (TOPIC_KEYS.includes(topic) && next[topic] == null) next[topic] = turn;
  }
  return next;
}

// `asked[topic]` is the turn whose question was about the topic, so the
// student answers it AT that turn. A mention in an earlier turn was therefore
// volunteered; a mention at that turn or later was prompted.
export function isUnprompted(topic, asked = {}, mentionTurn) {
  if (mentionTurn == null) return false;
  return asked[topic] == null || mentionTurn < asked[topic];
}

// Is this answer still in time to be taken at all?
export function tooLate(now, deadlineAt, graceMs = LIMITS.graceMs) {
  return now > new Date(deadlineAt).getTime() + graceMs;
}

// After taking the answer for `turn`: carry on, or stop and why.
export function afterAnswer({ turn, now, deadlineAt, maxTurns = LIMITS.maxTurns }) {
  if (turn >= maxTurns) return { done: true, reason: 'turns' };
  if (now > new Date(deadlineAt).getTime()) return { done: true, reason: 'time' };
  return { done: false, reason: null };
}

export function remainingMs(now, deadlineAt) {
  return Math.max(0, new Date(deadlineAt).getTime() - now);
}
