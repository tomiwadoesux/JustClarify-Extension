// Proves the background-tab insertion fix: execCommand no-ops when the
// document isn't focused (exactly what Chrome does in a hidden tab), so the
// composer must still fill via paste / beforeinput.
import fs from "node:fs";

const src = fs.readFileSync(new URL("../llm.js", import.meta.url), "utf8");

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0, i = src.indexOf("{", start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

function makeEnv({ docFocused, handlesPaste, handlesBeforeInput }) {
  const editor = {
    isContentEditable: true,
    innerText: "",
    getClientRects: () => [1],
    getAttribute: (a) => (a === "contenteditable" ? "true" : null),
    focus() {},
    dispatchEvent(ev) {
      if (ev.type === "paste" && handlesPaste) {
        editor.innerText = ev.clipboardData.getData("text/plain");
      }
      if (ev.type === "beforeinput" && handlesBeforeInput) {
        editor.innerText = ev.data;
      }
      return true;
    },
  };
  const document = {
    querySelector: (sel) => (sel === "#prompt-textarea" ? editor : null),
    querySelectorAll: () => [],
    createRange: () => ({ selectNodeContents() {} }),
    // The real Chrome behaviour: no document focus, no execCommand.
    execCommand: (cmd, _arg, val) => {
      if (!docFocused) return false;
      if (cmd === "insertText") editor.innerText = val;
      return true;
    },
  };
  const window = { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) };
  class DataTransfer {
    constructor() { this.d = {}; }
    setData(k, v) { this.d[k] = v; }
    getData(k) { return this.d[k]; }
  }
  class ClipboardEvent {
    constructor(t, i) { this.type = t; this.clipboardData = i.clipboardData; }
  }
  class InputEvent {
    constructor(t, i) { this.type = t; this.data = i.data; this.inputType = i.inputType; }
  }
  return { editor, document, window, DataTransfer, ClipboardEvent, InputEvent };
}

const selectors = { editor: ["#prompt-textarea"], send: [], reply: ["assistant"], busy: [] };
const TEXT = "What does he mean by front end engineer at Yolat?";
const body = grab("pageSubmit");

const scenarios = [
  ["ask #1  tab ACTIVE, site takes paste   ", { docFocused: true,  handlesPaste: true,  handlesBeforeInput: false }],
  ["ask #2  tab HIDDEN, site takes paste   ", { docFocused: false, handlesPaste: true,  handlesBeforeInput: false }],
  ["ask #2  tab HIDDEN, only beforeinput   ", { docFocused: false, handlesPaste: false, handlesBeforeInput: true  }],
  ["ask #2  tab HIDDEN, neither works      ", { docFocused: false, handlesPaste: false, handlesBeforeInput: false }],
  ["ask #1  tab ACTIVE, neither works      ", { docFocused: true,  handlesPaste: false, handlesBeforeInput: false }],
];

console.log("scenario                                  method          landed");
console.log("-".repeat(68));
let failures = 0;
for (const [label, cfg] of scenarios) {
  const env = makeEnv(cfg);
  const fn = new Function(
    "selectors", "text", "document", "window",
    "DataTransfer", "ClipboardEvent", "InputEvent",
    "HTMLTextAreaElement", "HTMLInputElement",
    `${body}\nreturn pageSubmit(selectors, text);`,
  );
  const r = fn(
    selectors, TEXT, env.document, env.window,
    env.DataTransfer, env.ClipboardEvent, env.InputEvent,
    class {}, class {},
  );
  const landed = env.editor.innerText.trim() === TEXT;
  // "neither works" scenarios legitimately fall through to technique 4
  // (textContent), which our stub editor does not model — so a clean
  // insert-failed there is the correct, honest answer.
  const expected = cfg.handlesPaste || cfg.handlesBeforeInput || cfg.docFocused;
  const good = landed === expected;
  if (!good) failures++;
  console.log(
    label,
    String(r.method || r.reason).padEnd(15),
    (landed ? "YES" : "no").padEnd(4),
    good ? "" : "  <-- UNEXPECTED",
  );
}

console.log();
console.log(
  failures === 0
    ? "PASS — the hidden tab now fills the composer; before this it only ever worked focused."
    : `FAIL — ${failures} scenario(s) behaved unexpectedly`,
);
process.exit(failures === 0 ? 0 : 1);
