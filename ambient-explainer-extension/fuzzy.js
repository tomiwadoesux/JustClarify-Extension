// fuzzy.js — turning a mistyped command into the command that was meant.
//
// WHY THIS IS NOT A SPELL CHECKER: a general dictionary offers "research",
// "resent" and "reserve" for "reserch" and makes you pick. The vocabulary here
// is harvested FROM THE GRAMMAR ITSELF (commands.js), so it holds about a
// hundred and fifty words and a correction can only ever produce a word some
// rule already knows. That constraint is what makes the guess safe enough to
// act on.
//
// WHY IT IS NOT background.js's closeEnough: that pair is tuned for SPEECH and
// says so in its own comment —
//
//     // The first letter has to survive. Speech mangles vowels and endings,
//     // not leading consonants
//
// which is correct for a transcript and wrong for a keyboard. Typing slips land
// on the front of a word constantly: "hwere" for "where", "teh" for "the",
// "ant" for "want". Every one of those is a single edit away and every one of
// them is rejected by that guard before the distance is even measured. Same
// algorithm, different gate, so the two live side by side on purpose.
//
// Loaded as a content script BEFORE commands.js (it reads the grammar) and in
// the worker, which shares the distance function.
//
// Exposes:
//   jcEditDistance(a, b)              -> optimal string alignment distance
//   jcTypoNear(typed, candidate)      -> is this within a typist's slip
//   jcBuildVocabulary(rules)          -> Set of every word the grammar knows
//   jcBestWord(word, vocab)           -> the one word meant, or null
//   jcCorrectPhrase(phrase, vocab)    -> { text, changed: [[from, to], …] }
//   jcCanonicalPhrase(regexSource)    -> a readable "research tabs" for a rule

// Optimal string alignment: Levenshtein plus transposition as ONE edit, because
// "teh" is one slip of the fingers rather than two. Capped on length difference
// first, since the only question ever asked here is "within a couple of typos".
function jcEditDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// The typist's gate. No first-letter rule — that is the whole difference from
// the spoken twin — but short words are held tight, because at three letters a
// single edit is a different word ("tab" / "tap" / "tag") and guessing between
// them is worse than leaving the text alone.
function jcTypoNear(typed, candidate) {
  const a = String(typed || "").toLowerCase();
  const b = String(candidate || "").toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  // Under four letters, only a transposition counts: "teh" -> "the" is a
  // certainty, "tap" -> "tab" is a coin flip and must not be taken.
  if (a.length < 4 || b.length < 4) {
    return a.length === b.length && jcEditDistance(a, b) === 1 && jcIsSwap(a, b);
  }
  const allowed = a.length >= 8 ? 2 : 1;
  return jcEditDistance(a, b) <= allowed;
}

// Exactly one adjacent pair swapped, nothing else.
function jcIsSwap(a, b) {
  if (a.length !== b.length) return false;
  const diff = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
}

// --- The vocabulary ---------------------------------------------------------
//
// Every literal word appearing in the grammar's own regexes. Harvested rather
// than hand-written so a rule added tomorrow teaches the corrector its words
// for free, and so the two can never drift apart.

const JC_REGEX_NOISE = /\\[a-z]|\[[^\]]*\]|\{\d+(?:,\d+)?\}|\(\?:|\(\?=|\(\?!|[()?*+|^$\/]/g;

function jcBuildVocabulary(regexSources) {
  const vocab = new Set();
  for (const source of regexSources || []) {
    String(source)
      .replace(JC_REGEX_NOISE, " ")
      .toLowerCase()
      .split(/[^a-z]+/)
      .forEach((word) => {
        // Two letters and under are articles and fragments of character
        // classes; they carry no signal and match everything.
        if (word.length > 2) vocab.add(word);
      });
  }
  return vocab;
}

// --- Correcting a typed phrase ----------------------------------------------

// Words that must never be corrected, because they are the reader's own and
// not the grammar's. Everything after one of these is an ARGUMENT: a subject,
// a site, a search term. "research my tabs about klimate polisy" gets its
// command skeleton fixed and its subject left exactly as typed, because the
// subject is matched later by tabsSelect against real tab titles and a
// "correction" there would quietly change which tabs are chosen.
const JC_ARGUMENT_GATES = new Set([
  "about", "on", "for", "covering", "called", "named", "saying", "titled",
  "to", "into", "search", "google", "find",
]);

// The one word the grammar knows that this was meant to be, or null.
//
// TOLERANCE IS A FUNCTION OF AMBIGUITY, not just of length, and that is the
// whole idea here. The danger in a generous threshold is never the distance, it
// is picking the WRONG word out of several. So:
//
//   - a confident match (jcTypoNear) wins outright, unless something else is
//     equally close, in which case we do not actually know and nothing changes;
//   - a further match is allowed only when it is the ONLY candidate in the
//     entire closed vocabulary. "compair" is two edits from "compare" and two
//     edits from nothing else, so there is no wrong answer available to pick.
//     "joing" is one edit from "join", "going" AND "doing", so it stays as
//     typed however close those are.
//
// A blanket "allow two edits" would have taken compair and also mangled joing.
function jcBestWord(word, vocab) {
  // Short words never widen: at three letters every neighbour is a real word.
  if (word.length < 4) {
    const swaps = [];
    for (const candidate of vocab) if (jcTypoNear(word, candidate)) swaps.push(candidate);
    return swaps.length === 1 ? swaps[0] : null;
  }

  let best = null;
  let bestScore = 99;
  let tied = false;
  for (const candidate of vocab) {
    if (!jcTypoNear(word, candidate)) continue;
    const score = jcEditDistance(word, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
      tied = false;
    } else if (score === bestScore && candidate !== best) {
      tied = true;
    }
  }
  if (best && !tied) return best;
  if (best && tied) return null; // equally close, so genuinely unknown

  // Nothing confident. One candidate at all, or nothing.
  const wider = [];
  for (const candidate of vocab) {
    if (Math.abs(word.length - candidate.length) > 2) continue;
    if (jcEditDistance(word, candidate) <= 2) wider.push(candidate);
    if (wider.length > 1) return null;
  }
  return wider.length === 1 ? wider[0] : null;
}

function jcCorrectPhrase(phrase, vocab) {
  const words = String(phrase || "").toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  const changed = [];
  let inArgument = false;

  for (const word of words) {
    if (inArgument) {
      out.push(word);
      continue;
    }
    if (JC_ARGUMENT_GATES.has(word)) {
      out.push(word);
      inArgument = true;
      continue;
    }
    if (vocab.has(word)) {
      out.push(word);
      continue;
    }

    const fixed = jcBestWord(word, vocab);
    if (fixed) {
      out.push(fixed);
      changed.push([word, fixed]);
    } else {
      out.push(word);
    }
  }

  return { text: out.join(" "), changed };
}

// --- A readable name for a rule ---------------------------------------------
//
// The grammar is 104 regexes and, until something renders them, entirely
// invisible: the only way to discover "compare these tabs" is to guess it. This
// turns a rule back into the shortest sentence that matches it, by taking the
// first branch of every alternation and dropping everything optional.

function jcCanonicalPhrase(regexSource) {
  let s = String(regexSource || "");
  s = s.replace(/^\/|\/[a-z]*$/g, "").replace(/^\^/, "").replace(/\$$/, "");

  // Optional groups go first, innermost out: "(?:my |the )?" contributes
  // nothing to the shortest matching sentence.
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/\((?:\?:)?[^()]*\)\?/g, "");
    if (next === s) break;
    s = next;
  }
  // Required groups keep their first branch: "(?:research|join|merge)" is
  // spoken as "research".
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/\((?:\?:)?([^()]*)\)/g, (_, inner) => inner.split("|")[0]);
    if (next === s) break;
    s = next;
  }
  s = s
    .replace(/\[([^\]]*)\]/g, (_, set) => set[0] || "")
    .replace(/\\([.\-/])/g, "$1")
    .replace(/[?*+]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}
