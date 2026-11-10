// The learning record. Run with:  npm run test:record
//
// WHAT MUST NOT REGRESS:
//
//   1. IT STAYS IN THE EXTENSION. A record of what someone did not understand
//      must never be written through content.js's jcStorageSet (which copies
//      into the host page's localStorage) and must never touch the network.
//   2. THE PAGE DOES NOT GET TO SAY WHERE IT IS. A content script shares its
//      message channel with the page. The address stored with an item comes
//      from the tab Chrome reports, not from the message.
//   3. A PRIVATE WINDOW LEAVES NO TRACE.
//   4. THE SCHEDULE IS HONEST. Re-reading an explanation is not evidence of
//      learning and must not move a review date. Only a check does.
//   5. ADDRESSES ARE TRIMMED. Query strings and fragments (session tokens,
//      search terms) are not kept.

import fs from "node:fs";
import vm from "node:vm";

const dir = new URL("../", import.meta.url);
const source = fs.readFileSync(new URL("record.js", dir), "utf8");

let failures = 0;
const check = (label, cond, detail) => {
  if (!cond) {
    failures++;
    console.log(`FAIL  ${label}${detail ? `  <-- ${detail}` : ""}`);
  } else console.log(`PASS  ${label}`);
};

// ---------------------------------------------------------------- harness

// Enough of IndexedDB for one object store: requests that succeed on a later
// tick, and transactions that complete after their requests.
function fakeIndexedDB() {
  const rows = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const request = (compute) => {
    const req = {};
    later(() => {
      req.result = compute();
      if (req.onsuccess) req.onsuccess();
    });
    return req;
  };
  const store = {
    get: (id) => request(() => (rows.has(id) ? structuredClone(rows.get(id)) : undefined)),
    getAll: () => request(() => [...rows.values()].map((r) => structuredClone(r))),
    put: (item) => request(() => void rows.set(item.id, structuredClone(item))),
    delete: (id) => request(() => void rows.delete(id)),
    clear: () => request(() => void rows.clear()),
    createIndex() {},
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => store,
    transaction() {
      const tx = { objectStore: () => store };
      setTimeout(() => tx.oncomplete && tx.oncomplete(), 5);
      return tx;
    },
  };
  return {
    rows,
    open() {
      const req = { result: db };
      later(() => req.onsuccess && req.onsuccess());
      return req;
    },
  };
}

function load() {
  const idb = fakeIndexedDB();
  const sent = [];
  const net = [];
  const ctx = vm.createContext({
    console, URL, Math, Date, Promise, Set, Map, Number, String, Array, Object, JSON,
    setTimeout, clearTimeout, structuredClone,
    indexedDB: idb,
    fetch: (...args) => {
      net.push(args);
      return Promise.reject(new Error("no network in the record"));
    },
    chrome: {
      runtime: {
        getURL: (path) => `chrome-extension://abcdefghijklmnop/${path}`,
        sendMessage: (message) => {
          sent.push(message);
          return Promise.resolve();
        },
      },
    },
  });
  vm.runInContext(
    `${source}\n;globalThis.api = { recordTopicKey, recordUrlKey, recordItemId, recordSchedule, recordNewItem, recordApplyAsk, recordApplyCheck, recordStanding, recordSummarise, recordHandleMessage, JC_RECORD_BOX_DAYS, JC_RECORD_MAX_CHECKS };`,
    ctx,
  );
  const ask = (msg, sender = {}) =>
    new Promise((resolve) => {
      const handled = ctx.api.recordHandleMessage(msg, sender, resolve);
      if (!handled) resolve("__unhandled__");
    });
  return { api: ctx.api, idb, sent, net, ask };
}

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-10T12:00:00Z");

// ---------------------------------------------------------------- pure

{
  const { api } = load();

  check("topic key ignores case and punctuation", api.recordTopicKey("  Enzyme Kinetics! ") === "enzyme-kinetics");
  check("topic key keeps non-Latin letters", api.recordTopicKey("Équilibre chimique") === "équilibre-chimique");

  check(
    "address keeps origin and path only",
    api.recordUrlKey("https://uni.example.org/course/bio201/week7?session=SECRET&utm=x#notes") ===
      "https://uni.example.org/course/bio201/week7",
  );
  check("address refuses non-web schemes", api.recordUrlKey("chrome://settings") === "" && api.recordUrlKey("javascript:alert(1)") === "");
  check("address survives junk", api.recordUrlKey("") === "" && api.recordUrlKey(null) === "" && api.recordUrlKey("not a url") === "");

  const a = api.recordItemId("https://a.example/p", "Michaelis constant");
  check("same passage, same page, same item", a === api.recordItemId("https://a.example/p", "  michaelis   CONSTANT "));
  check("a different page is a different item", a !== api.recordItemId("https://a.example/q", "Michaelis constant"));
  check("a different passage is a different item", a !== api.recordItemId("https://a.example/p", "Maximum velocity"));

  const fresh = api.recordNewItem(
    { selection: "Km", answer: "The substrate concentration at half Vmax.", topic: "Enzyme kinetics", url: "https://a.example/p?x=1", title: "Week 7" },
    T0,
  );
  check("a new item is due tomorrow and unchecked", fresh.dueAt === T0 + DAY && fresh.checked === false && fresh.box === 0);
  check("a new item stores the trimmed address", fresh.urlKey === "https://a.example/p");
  check("long text is clipped", api.recordNewItem({ selection: "x".repeat(5000), answer: "y".repeat(5000), url: "https://a.example/" }, T0).gist.length <= 700);

  // The schedule: right answers climb the boxes.
  let item = fresh;
  const dues = [];
  for (let i = 0; i < 7; i += 1) {
    item = api.recordApplyCheck(item, { q: "q?", verdict: "right" }, T0);
    dues.push(Math.round((item.dueAt - T0) / DAY));
  }
  check("right answers space out: 1, 3, 7, 16, 35, then hold", dues.join(",") === "1,3,7,16,35,35,35", dues.join(","));
  check("right answers are counted", item.rightCount === 7 && item.wrongCount === 0);
  check("only the last ten checks are kept", api.recordApplyCheck({ ...item, checks: new Array(10).fill({ verdict: "right" }) }, { verdict: "right" }, T0).checks.length === api.JC_RECORD_MAX_CHECKS);

  const missed = api.recordApplyCheck(item, { q: "q?", verdict: "wrong", missed: "the half-maximum part" }, T0);
  check("a wrong answer goes back to the start, due in ten minutes", missed.box === 0 && missed.dueAt === T0 + 10 * 60_000);
  check("a wrong answer is counted and remembered", missed.wrongCount === 1 && missed.checks.at(-1).missed === "the half-maximum part");

  const partial = api.recordApplyCheck({ ...fresh, box: 2, checked: true }, { verdict: "partial" }, T0);
  check("a partial answer keeps its box and returns tomorrow", partial.box === 2 && partial.dueAt === T0 + DAY);
  check("an unknown verdict is treated as wrong, never as right", api.recordApplyCheck(fresh, { verdict: "excellent" }, T0).box === 0);

  // Re-reading is not learning.
  const reread = api.recordApplyAsk({ ...fresh, box: 3, dueAt: T0 + 16 * DAY, checked: true }, { answer: "A newer explanation." }, T0 + 5);
  check("asking again updates the explanation", reread.gist === "A newer explanation." && reread.asks === 2);
  check("asking again does NOT move the review date", reread.dueAt === T0 + 16 * DAY && reread.box === 3);

  check("standing: never checked", api.recordStanding(fresh, T0) === "unchecked");
  check("standing: missed last time", api.recordStanding(missed, T0) === "missed");
  check("standing: known until due", api.recordStanding(item, T0) === "known" && api.recordStanding(item, T0 + 40 * DAY) === "due");

  const summary = api.recordSummarise(
    [
      { ...fresh, id: "a", topic: "Enzymes", topicKey: "enzymes", dueAt: T0 - 1 },
      { ...missed, id: "b", topic: "Statistics", topicKey: "statistics" },
      { ...item, id: "c", topic: "Enzymes", topicKey: "enzymes" },
    ],
    T0,
  );
  check("summary counts what is due", summary.total === 3 && summary.due === 1);
  check("topics with a missed item come first", summary.topics[0].key === "statistics");
  check("items are grouped by topic", summary.topics.find((t) => t.key === "enzymes").items.length === 2);
  check("summary of nothing is empty, not an error", api.recordSummarise([], T0).total === 0);
}

// ---------------------------------------------------------------- messages

{
  const { api, idb, sent, net, ask } = load();
  const tab = { id: 7, url: "https://real.example/reading?token=abc", title: "The real page", incognito: false };

  const added = await ask(
    { type: "JC_RECORD_ADD", selection: "Lineweaver-Burk plot", answer: "A double reciprocal plot.", topic: "Enzyme kinetics", mode: "default", url: "https://evil.example/claimed", title: "Claimed" },
    { tab },
  );
  check("an explanation is recorded", added.ok === true && added.isNew === true);
  const stored = [...idb.rows.values()][0];
  check("the address comes from the TAB, not the message", stored.urlKey === "https://real.example/reading" && stored.title === "The real page");
  check("the query string is not stored", !JSON.stringify(stored).includes("token=abc"));
  check("the side panel is told", sent.some((m) => m.target === "sidepanel" && m.type === "JC_RECORD_CHANGED"));

  const again = await ask({ type: "JC_RECORD_ADD", selection: "lineweaver-burk  PLOT", answer: "Explained again.", mode: "eli5" }, { tab });
  check("the same passage again is the same item", again.ok && again.isNew === false && idb.rows.size === 1);
  check("and counts as a second ask", [...idb.rows.values()][0].asks === 2);

  const priv = await ask({ type: "JC_RECORD_ADD", selection: "Private thing", answer: "x" }, { tab: { ...tab, incognito: true } });
  check("a private window records nothing", priv.ok === false && idb.rows.size === 1);

  const empty = await ask({ type: "JC_RECORD_ADD", selection: " ", answer: "" }, { tab });
  check("nothing to record is refused", empty.ok === false && idb.rows.size === 1);

  // The study panel is one of our own pages, so it may say which document an
  // explanation was about. It has no tab when docked, and a tab when opened as
  // a page; either way it is recognised by its own address.
  const fromPanel = await ask(
    { type: "JC_RECORD_ADD", selection: "From a PDF", answer: "Explained.", url: "https://files.example/paper.pdf?dl=1", title: "paper.pdf" },
    { url: "chrome-extension://abcdefghijklmnop/sidepanel.html" },
  );
  check("the panel may supply an address", fromPanel.ok && [...idb.rows.values()].some((r) => r.urlKey === "https://files.example/paper.pdf"));
  const panelAsTab = await ask(
    { type: "JC_RECORD_ADD", selection: "From a PDF, panel in a tab", answer: "Explained.", url: "https://files.example/other.pdf", title: "other.pdf" },
    { url: "chrome-extension://abcdefghijklmnop/sidepanel.html", tab: { id: 2, url: "chrome-extension://abcdefghijklmnop/sidepanel.html", title: "JustClarify study panel" } },
  );
  check("and still may when it is open as a tab", panelAsTab.ok && [...idb.rows.values()].some((r) => r.urlKey === "https://files.example/other.pdf" && r.title === "other.pdf"));
  const spoof = await ask(
    { type: "JC_RECORD_ADD", selection: "A page pretending", answer: "Explained.", url: "https://evil.example/claimed", title: "Claimed" },
    { url: "https://real.example/reading", tab },
  );
  check("a web page cannot do the same", spoof.ok && ![...idb.rows.values()].some((r) => r.urlKey.includes("evil.example")));

  const before = [...idb.rows.values()].find((r) => r.id === added.id).dueAt;
  const saved = await ask({ type: "JC_RECORD_CHECK_SAVE", id: added.id, check: { q: "What is plotted?", verdict: "wrong", missed: "the reciprocals" } });
  check("a check is saved and moves the review", saved.ok && saved.dueAt < before && saved.standing === "missed");
  check("a check on a missing item fails softly", (await ask({ type: "JC_RECORD_CHECK_SAVE", id: "nope", check: { verdict: "right" } })).ok === false);

  const list = await ask({ type: "JC_RECORD_LIST" });
  check("the list reports totals and topics", list.ok && list.total === 4 && Array.isArray(list.topics));

  const exported = await ask({ type: "JC_RECORD_EXPORT" });
  check("export returns every item", exported.ok && exported.items.length === 4);

  await ask({ type: "JC_RECORD_DELETE", id: added.id });
  check("one item can be removed", idb.rows.size === 3);
  await ask({ type: "JC_RECORD_CLEAR" });
  check("everything can be deleted", idb.rows.size === 0);

  check("other messages are left alone", (await ask({ type: "ASK_CLAUDE" })) === "__unhandled__");
  check("the announcement itself is left alone", (await ask({ type: "JC_RECORD_CHANGED", target: "sidepanel" })) === "__unhandled__");
  check("junk messages are left alone", api.recordHandleMessage(null, {}, () => {}) === false && api.recordHandleMessage({}, {}, () => {}) === false);
  check("THE RECORD NEVER TOUCHES THE NETWORK", net.length === 0);
}

// ---------------------------------------------------------------- source

{
  const code = source.replace(/^\s*\/\/.*$/gm, "");
  check("record.js never uses localStorage", !/localStorage/.test(code));
  check("record.js never uses jcStorageSet", !/jcStorageSet\s*\(/.test(code));
  check("record.js never uses chrome.storage", !/chrome\.storage/.test(code));
  check("record.js makes no network request", !/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(code));
}

console.log(failures ? `\n${failures} record test(s) FAILED` : "\nall record tests passed");
process.exit(failures ? 1 : 0);
