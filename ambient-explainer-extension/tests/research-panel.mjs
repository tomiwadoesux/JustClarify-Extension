// The in-page half of the research briefing. Run with:  npm run test:research-panel
//
// WHAT THIS EXISTS TO PROTECT:
//
//  1. CONTAINMENT. This panel is the only surface in JustClarify that puts text
//     from OTHER TABS onto the current page. In the light DOM the host page
//     could read a joined briefing — someone's bank statement, a private doc —
//     straight out of its own document. It must live in a CLOSED shadow root,
//     which has no .shadowRoot for the page to reach through.
//  2. NO SCRIPTED SPENDING. A page that can find the offer chip can call
//     .click() on it. That would start a run nobody asked for, read the
//     reader's other tabs and bill a model call, all with no human involved.
//     Every control here must refuse an untrusted event.
//  3. NO INTERPOLATION OF OTHER PAGES' TEXT. Source titles, hosts and the
//     cluster label are written by whoever controls those tabs. They reach the
//     DOM through textContent, never through an HTML string.
//  4. THE CITATION LINKIFIER. The one piece of real logic in the UI, driven
//     here against a minimal DOM rather than eyeballed.

import fs from "node:fs";

const src = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");

function grab(name) {
  const start = src.search(new RegExp(`(?:async )?function ${name}\\(`));
  if (start < 0) throw new Error(`missing ${name}`);
  let depth = 0, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) {
    failures++;
    console.log(`FAIL  ${label}${detail ? `  <-- ${detail}` : ""}`);
  } else console.log(`PASS  ${label}`);
};

// The research block only — so a match somewhere else in this 5600-line file
// cannot make one of these guards look present when it is not.
const block = src.slice(src.indexOf("// --- Research: several tabs, one briefing"));
check("the research block was located", block.length > 2000);

// ---- 1. containment ------------------------------------------------------

check(
  "the panel and chip live in a CLOSED shadow root",
  /attachShadow\(\{\s*mode:\s*["']closed["']\s*\}\)/.test(block),
  (block.match(/attachShadow\([^)]*\)/) || ["none"])[0],
);
check(
  "nothing in the research block appends a bare panel to document.body",
  !/document\.body\)?\.appendChild\((?:panel|chip)\b/.test(block),
);
check(
  "the host element is pinned with !important so a page stylesheet cannot hide it",
  /setProperty\("position", "fixed", "important"\)/.test(block),
);

// ---- 2. no scripted spending --------------------------------------------

const jcRsReal = new Function(`${grab("jcRsReal")}; return jcRsReal;`)();
check("a real click is accepted", jcRsReal({ isTrusted: true }) === true);
check("a scripted click is refused", jcRsReal({ isTrusted: false }) === false);
check("a missing event is refused", jcRsReal(undefined) === false);
check("an event with no isTrusted is refused", jcRsReal({}) === false);

// Every listener that spends something, or moves the reader, must consult it.
for (const [what, re] of [
  ["the offer chip's start button", /\.go"\)\.addEventListener\("click", \(e\) => \{\s*\n(?:.*\n)*?\s*if \(!jcRsReal\(e\)\) return;/],
  ["the citation / source delegate", /panel\.addEventListener\("click", \(e\) => \{\s*\n\s*if \(!jcRsReal\(e\)\) return;/],
  ["the decline button", /\.no"\)\.addEventListener\("click", \(e\) => \{\s*\n\s*if \(!jcRsReal\(e\)\) return;/],
  ["the close button", /\.close"\)\.addEventListener\("click", \(e\) => \{\s*\n\s*if \(jcRsReal\(e\)\) jcRsClose\(\);/],
]) {
  check(`${what} refuses a scripted click`, re.test(block));
}

// ---- 3. other pages' text is never interpolated -------------------------

const renderSources = grab("jcRsRenderSources");
check(
  "source titles reach the DOM as textContent",
  /title\.textContent = s\.title/.test(renderSources),
);
check(
  "the source list builds nodes rather than an HTML string",
  !/innerHTML/.test(renderSources),
  "jcRsRenderSources still uses innerHTML",
);
check(
  "the cluster label reaches the DOM as textContent",
  /\.clabel"\)\.textContent = cluster\.label/.test(block),
);
check(
  "the panel subject reaches the DOM as textContent",
  /\.subject"\)\.textContent = label/.test(block),
);

// ---- 4. the citation linkifier, driven against a minimal DOM ------------
//
// No jsdom in this repo, so the handful of DOM calls jcRsLinkCitations makes
// are implemented here. Small enough to read, which is the point: if the
// linkifier starts needing more of the DOM than this, that is worth noticing.

const TEXT = 3;
function makeDom() {
  const mkText = (v) => ({
    nodeType: TEXT,
    nodeValue: v,
    parentNode: null,
    parentElement: null,
  });
  const mkEl = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      className: "",
      dataset: {},
      title: "",
      type: "",
      children: [],
      nodeType: 1,
      parentNode: null,
      parentElement: null,
      get textContent() {
        return el.children.map((c) => (c.nodeType === TEXT ? c.nodeValue : c.textContent)).join("");
      },
      set textContent(v) {
        el.children = v ? [mkText(v)] : [];
      },
      appendChild(child) {
        const kids = child.__frag ? child.children : [child];
        for (const k of kids) {
          k.parentNode = el;
          k.parentElement = el;
          el.children.push(k);
        }
        return child;
      },
      replaceChild(next, old) {
        const at = el.children.indexOf(old);
        const kids = next.__frag ? next.children : [next];
        for (const k of kids) {
          k.parentNode = el;
          k.parentElement = el;
        }
        el.children.splice(at, 1, ...kids);
      },
      closest(sel) {
        // Only the selectors the linkifier actually passes.
        const wants = sel.split(",").map((s) => s.trim());
        let node = el;
        while (node) {
          for (const w of wants) {
            if (w.startsWith(".") && String(node.className).split(/\s+/).includes(w.slice(1))) {
              return node;
            }
            if (!w.startsWith(".") && node.tagName === w.toUpperCase()) return node;
          }
          node = node.parentElement;
        }
        return null;
      },
    };
    return el;
  };

  const document = {
    createElement: mkEl,
    createTextNode: mkText,
    createDocumentFragment() {
      const f = mkEl("#fragment");
      f.__frag = true;
      return f;
    },
    // Depth-first walk over text nodes, snapshotted up front — which is what
    // the real TreeWalker gives the linkifier, and why collecting before
    // mutating is safe.
    createTreeWalker(root) {
      const out = [];
      (function visit(n) {
        for (const c of n.children || []) {
          if (c.nodeType === TEXT) out.push(c);
          else visit(c);
        }
      })(root);
      let i = -1;
      return {
        currentNode: null,
        nextNode() {
          i++;
          this.currentNode = out[i] || null;
          return this.currentNode;
        },
      };
    },
  };
  return { document, mkEl, mkText };
}

function linkify(html, sources) {
  const { document, mkEl, mkText } = makeDom();
  const root = mkEl("div");
  // html here is a tiny builder spec: strings are text, ["code", "..."] is a
  // <code> child.
  for (const part of html) {
    if (typeof part === "string") root.appendChild(mkText(part));
    else {
      const el = mkEl(part[0]);
      el.appendChild(mkText(part[1]));
      root.appendChild(el);
    }
  }
  const fn = new Function(
    "document", "NodeFilter", "jcRsSources",
    `${grab("jcRsLinkCitations")}; return jcRsLinkCitations;`,
  )(document, { SHOW_TEXT: 4 }, sources);
  fn(root);
  return root;
}

const SOURCES = [
  { n: 1, id: 11, title: "The Verge", host: "theverge.com" },
  { n: 2, id: 12, title: "Reuters", host: "reuters.com" },
];

{
  const root = linkify(["The budget was cut by 20 percent [2]."], SOURCES);
  const cites = root.children.filter((c) => c.className === "cite");
  check("a citation becomes one clickable chip", cites.length === 1, String(cites.length));
  check("the chip points at the source's tab", cites[0] && cites[0].dataset.jcTab === "12");
  check("the chip shows the citation number", cites[0] && cites[0].textContent === "2");
  check(
    "the surrounding prose survives intact",
    root.textContent === "The budget was cut by 20 percent 2.",
    root.textContent,
  );
}

{
  const root = linkify(["Both agree [1][2] on the date."], SOURCES);
  const cites = root.children.filter((c) => c.className === "cite");
  check("adjacent citations both become chips", cites.length === 2, String(cites.length));
  check(
    "they point at different tabs",
    cites.length === 2 && cites[0].dataset.jcTab === "11" && cites[1].dataset.jcTab === "12",
  );
}

{
  // A number with no source must stay literal: the reader should see that the
  // briefing cited something the panel cannot show, not have it silently eaten.
  const root = linkify(["Claimed by [9] and confirmed by [1]."], SOURCES);
  const cites = root.children.filter((c) => c.className === "cite");
  check("an unknown citation number is not linked", cites.length === 1, String(cites.length));
  check(
    "and the unknown marker is left as visible text",
    root.textContent === "Claimed by [9] and confirmed by 1.",
    root.textContent,
  );
}

{
  const root = linkify(["Claimed by [9] only."], SOURCES);
  check(
    "a paragraph whose only marker is unknown is left completely alone",
    root.textContent === "Claimed by [9] only." &&
      !root.children.some((c) => c.className === "cite"),
    root.textContent,
  );
}

{
  // Array indexing inside a code block is not a citation.
  const root = linkify(["See ", ["code", "arr[1]"], " and [2]."], SOURCES);
  const cites = root.children.filter((c) => c.className === "cite");
  check("a bracket inside <code> is never turned into a citation", cites.length === 1);
  check(
    "the code block is untouched",
    root.children.some((c) => c.tagName === "CODE" && c.textContent === "arr[1]"),
  );
}

{
  const root = linkify(["[1] leads the paragraph."], SOURCES);
  check(
    "a citation at position zero does not eat the sentence",
    root.textContent === "1 leads the paragraph.",
    root.textContent,
  );
}

// ---- 5. the unread notes ------------------------------------------------

const note = new Function(`${grab("jcRsUnreadNote")}; return jcRsUnreadNote;`)();
for (const state of ["asleep", "thin", "blocked"]) {
  check(`an unread source (${state}) is explained to the reader`, note(state).length > 0);
}
check("a source that was read carries no note", note(null) === "");
check("an unknown state carries no note", note("weird") === "");

// ---- 6. the streaming render -------------------------------------------
//
// Running the block formatter on every chunk destroyed the reader's selection
// and swallowed citation clicks. It must run once, on done.

const renderBody = grab("jcRsRenderBody");
check(
  "the formatter only runs when the answer is complete",
  /if \(!done\) \{[\s\S]*?return;\s*\}\s*body\.innerHTML = formatExplanation/.test(renderBody),
);
check(
  "while streaming, the text goes in as textContent",
  /live\.textContent = text/.test(renderBody),
);
check("citations are linked only after the final render", /done[\s\S]*jcRsLinkCitations/.test(renderBody));

// ---- 7. the passive scan never nags an orphaned page --------------------

check(
  "the unprompted scan checks the extension context before sending",
  /if \(!jcContextAlive\(\)\) return;\s*\n\s*jcRsLastScan = Date\.now\(\);/.test(block),
);

console.log(failures ? `\n${failures} failing` : "\nall good");
process.exit(failures ? 1 : 0);
