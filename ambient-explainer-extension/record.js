// The learning record: what the reader asked to have explained, whether they
// could answer a question about it afterwards, and when it is due again.
//
// WHERE IT LIVES, and why not chrome.storage.local like everything else:
//   content.js's jcStorageSet mirrors every key it writes into the HOST PAGE's
//   localStorage, so anything saved through that path is copied into every
//   site the reader uses the extension on. A record of what someone does not
//   understand is not something to hand to arbitrary websites. So the record
//   is an IndexedDB database in the extension's own origin, this worker is the
//   only thing that opens it, and every other surface reaches it by message.
//   tests/sidepanel.mjs fails if this file ever touches localStorage or
//   jcStorageSet.
//
// It never leaves the device. Nothing here makes a network request.
//
// Loaded by background.js through importScripts, so everything is a plain
// top-level function. The pure ones (no chrome, no indexedDB) come first and
// are what tests/record.mjs exercises.

const JC_RECORD_DB = 'jc-learning';
const JC_RECORD_STORE = 'items';
const JC_RECORD_MAX_ITEMS = 2000;
const JC_RECORD_MAX_CHECKS = 10;

// Review spacing, in days, by box. A right answer moves up a box; a wrong one
// goes back to the start. Deliberately simple and fixed: it is five numbers
// anyone can read, and it can be swapped for FSRS later without touching the
// stored items, because the schedule is a pure function of an item and a
// verdict.
const JC_RECORD_BOX_DAYS = [1, 3, 7, 16, 35];
const JC_RECORD_WRONG_MINUTES = 10;
const JC_RECORD_DAY_MS = 86_400_000;

// --- pure ---------------------------------------------------------------------

function recordTopicKey(topic) {
  return String(topic || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

// Origin and path only. The query string and fragment are dropped because that
// is where session tokens, search terms and tracking ids live, and none of
// them belong in a record that outlives the visit.
function recordUrlKey(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return '';
    return (u.protocol === 'file:' ? 'file://' : u.origin) + u.pathname;
  } catch (_) {
    return '';
  }
}

function recordNormalise(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// A small stable hash, so the same passage on the same page is the same item
// however many times it is explained.
function recordHash(text) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 + c, 2654435761);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function recordItemId(urlKey, selection) {
  return 'i' + recordHash(urlKey + '\n' + recordNormalise(selection).slice(0, 400));
}

function recordClip(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
}

// What happens to an item after a check. `verdict` is right | partial | wrong.
function recordSchedule(item, verdict, now) {
  const box = Math.max(0, Math.min(JC_RECORD_BOX_DAYS.length - 1, Number(item.box) || 0));
  if (verdict === 'right') {
    const next = Math.min(JC_RECORD_BOX_DAYS.length - 1, item.checked ? box + 1 : box);
    return { box: next, dueAt: now + JC_RECORD_BOX_DAYS[next] * JC_RECORD_DAY_MS };
  }
  if (verdict === 'partial') {
    // Same box, back tomorrow: not learned, but not lost either.
    return { box, dueAt: now + JC_RECORD_DAY_MS };
  }
  // Wrong: start again, and soon, while the explanation is still fresh.
  return { box: 0, dueAt: now + JC_RECORD_WRONG_MINUTES * 60_000 };
}

function recordNewItem(input, now) {
  const urlKey = recordUrlKey(input.url);
  const topic = recordClip(input.topic, 60) || recordClip(input.selection, 40);
  return {
    id: recordItemId(urlKey, input.selection),
    topic,
    topicKey: recordTopicKey(topic),
    selection: recordClip(input.selection, 600),
    gist: recordClip(input.answer, 700),
    mode: String(input.mode || 'default').slice(0, 20),
    urlKey,
    title: recordClip(input.title, 140),
    source: input.source && input.source.text
      ? { text: recordClip(input.source.text, 400), n: Number(input.source.n) || 0 }
      : null,
    asks: 1,
    checks: [],
    rightCount: 0,
    wrongCount: 0,
    checked: false,
    box: 0,
    // Explained but never checked: come back to it tomorrow.
    dueAt: now + JC_RECORD_DAY_MS,
    createdAt: now,
    updatedAt: now,
  };
}

// The same passage explained again (a different style, a follow-up). The
// newest explanation replaces the gist; the schedule is left alone, because
// re-reading an explanation is not evidence of having learned it.
function recordApplyAsk(item, input, now) {
  const next = { ...item, asks: (item.asks || 0) + 1, updatedAt: now };
  if (input.answer) next.gist = recordClip(input.answer, 700);
  if (input.source && input.source.text) {
    next.source = { text: recordClip(input.source.text, 400), n: Number(input.source.n) || 0 };
  }
  if (input.topic && !item.topic) {
    next.topic = recordClip(input.topic, 60);
    next.topicKey = recordTopicKey(next.topic);
  }
  return next;
}

function recordApplyCheck(item, check, now) {
  const verdict = ['right', 'partial', 'wrong'].includes(check.verdict) ? check.verdict : 'wrong';
  const schedule = recordSchedule(item, verdict, now);
  const entry = {
    at: now,
    q: recordClip(check.q, 300),
    verdict,
    missed: recordClip(check.missed, 200),
    self: !!check.self,
  };
  return {
    ...item,
    checks: [...(item.checks || []), entry].slice(-JC_RECORD_MAX_CHECKS),
    rightCount: (item.rightCount || 0) + (verdict === 'right' ? 1 : 0),
    wrongCount: (item.wrongCount || 0) + (verdict === 'wrong' ? 1 : 0),
    checked: true,
    box: schedule.box,
    dueAt: schedule.dueAt,
    updatedAt: now,
  };
}

// Where an item stands, in one word, for the panel.
function recordStanding(item, now) {
  if (!item.checked) return 'unchecked';
  const last = item.checks && item.checks[item.checks.length - 1];
  if (last && last.verdict === 'wrong') return 'missed';
  if (item.dueAt <= now) return 'due';
  return 'known';
}

// Everything the panel needs in one pass: what is due, and the items grouped
// by topic with the shakiest topics first.
function recordSummarise(items, now) {
  const groups = new Map();
  let due = 0;
  let checked = 0;
  let right = 0;
  let wrong = 0;
  for (const item of items) {
    const standing = recordStanding(item, now);
    const isDue = item.dueAt <= now;
    if (isDue) due += 1;
    if (item.checked) checked += 1;
    right += item.rightCount || 0;
    wrong += item.wrongCount || 0;
    const key = item.topicKey || 'other';
    const group = groups.get(key) || { key, topic: item.topic || 'Other', items: [], due: 0, missed: 0 };
    group.items.push({ ...item, standing, isDue });
    if (isDue) group.due += 1;
    if (standing === 'missed') group.missed += 1;
    groups.set(key, group);
  }
  const topics = [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => a.dueAt - b.dueAt),
      updatedAt: Math.max(...group.items.map((i) => i.updatedAt || 0)),
    }))
    .sort((a, b) => b.missed - a.missed || b.due - a.due || b.updatedAt - a.updatedAt);
  return { total: items.length, due, checked, right, wrong, topics };
}

// --- IndexedDB ------------------------------------------------------------------

let jcRecordDbPromise = null;

function recordOpen() {
  if (jcRecordDbPromise) return jcRecordDbPromise;
  jcRecordDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(JC_RECORD_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(JC_RECORD_STORE)) {
        const store = db.createObjectStore(JC_RECORD_STORE, { keyPath: 'id' });
        store.createIndex('dueAt', 'dueAt');
        store.createIndex('topicKey', 'topicKey');
        store.createIndex('urlKey', 'urlKey');
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      jcRecordDbPromise = null;
      reject(request.error || new Error('record-open-failed'));
    };
  });
  return jcRecordDbPromise;
}

function recordTx(mode, work) {
  return recordOpen().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(JC_RECORD_STORE, mode);
        const store = tx.objectStore(JC_RECORD_STORE);
        let result;
        const request = work(store);
        if (request) request.onsuccess = () => (result = request.result);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('record-tx-failed'));
        tx.onabort = () => reject(tx.error || new Error('record-tx-aborted'));
      }),
  );
}

const recordGet = (id) => recordTx('readonly', (store) => store.get(id));
const recordAll = () => recordTx('readonly', (store) => store.getAll()).then((rows) => rows || []);
const recordPut = (item) => recordTx('readwrite', (store) => store.put(item));
const recordRemove = (id) => recordTx('readwrite', (store) => store.delete(id));
const recordClear = () => recordTx('readwrite', (store) => store.clear());

// Tell the side panel, if it is open, that there is something new to show.
// A broadcast with a target, like the offscreen document's messages: every
// other extension page ignores it.
function recordAnnounce() {
  try {
    chrome.runtime.sendMessage({ target: 'sidepanel', type: 'JC_RECORD_CHANGED' }).catch(() => {});
  } catch (_) {}
}

async function recordAdd(input) {
  const selection = String(input.selection || '').trim();
  const answer = String(input.answer || '').trim();
  if (selection.length < 2 || !answer) return { ok: false, error: 'nothing-to-record' };
  const now = Date.now();
  const fresh = recordNewItem({ ...input, selection, answer }, now);
  const existing = await recordGet(fresh.id);
  const item = existing ? recordApplyAsk(existing, { ...input, answer }, now) : fresh;
  await recordPut(item);

  // Keep the database bounded: drop the least recently touched beyond the cap.
  if (!existing) {
    const all = await recordAll();
    if (all.length > JC_RECORD_MAX_ITEMS) {
      const extra = all.sort((a, b) => a.updatedAt - b.updatedAt).slice(0, all.length - JC_RECORD_MAX_ITEMS);
      for (const old of extra) await recordRemove(old.id);
    }
  }
  recordAnnounce();
  return { ok: true, id: item.id, isNew: !existing };
}

async function recordSaveCheck(id, check) {
  const item = await recordGet(String(id || ''));
  if (!item) return { ok: false, error: 'no-such-item' };
  const next = recordApplyCheck(item, check || {}, Date.now());
  await recordPut(next);
  recordAnnounce();
  return { ok: true, dueAt: next.dueAt, box: next.box, standing: recordStanding(next, Date.now()) };
}

// Returns true when the message was one of ours (and sendResponse will be
// called), so background.js can `return true` for it.
function recordHandleMessage(msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('JC_RECORD_')) return false;

  const reply = (work) => {
    Promise.resolve()
      .then(work)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message ? error.message : error).slice(0, 120) }));
    return true;
  };

  if (msg.type === 'JC_RECORD_ADD') {
    // A private window leaves no trace here either.
    if (sender && sender.tab && sender.tab.incognito) {
      sendResponse({ ok: false, error: 'incognito' });
      return true;
    }
    // From a page, the address comes from the tab, never from the message: the
    // content script shares its channel with the page it runs in. Only one of
    // our OWN pages (the study panel) may supply an address, because it is
    // reporting on a document it was handed, not on itself.
    const ownPage = !!(sender && sender.url && sender.url.startsWith(chrome.runtime.getURL('')));
    const fromTab = !ownPage && sender && sender.tab;
    return reply(() =>
      recordAdd({
        selection: msg.selection,
        answer: msg.answer,
        topic: msg.topic,
        mode: msg.mode,
        source: msg.source,
        url: fromTab ? sender.tab.url : msg.url,
        title: fromTab ? sender.tab.title : msg.title,
      }),
    );
  }

  if (msg.type === 'JC_RECORD_LIST') {
    return reply(async () => ({ ok: true, ...recordSummarise(await recordAll(), Date.now()) }));
  }
  if (msg.type === 'JC_RECORD_GET') {
    return reply(async () => ({ ok: true, item: (await recordGet(String(msg.id || ''))) || null }));
  }
  if (msg.type === 'JC_RECORD_CHECK_SAVE') {
    return reply(() => recordSaveCheck(msg.id, msg.check));
  }
  if (msg.type === 'JC_RECORD_DELETE') {
    return reply(async () => {
      await recordRemove(String(msg.id || ''));
      recordAnnounce();
      return { ok: true };
    });
  }
  if (msg.type === 'JC_RECORD_CLEAR') {
    return reply(async () => {
      await recordClear();
      recordAnnounce();
      return { ok: true };
    });
  }
  if (msg.type === 'JC_RECORD_EXPORT') {
    return reply(async () => ({ ok: true, exportedAt: new Date().toISOString(), items: await recordAll() }));
  }
  // JC_RECORD_CHANGED is the announcement above, echoed back to the worker.
  return false;
}
