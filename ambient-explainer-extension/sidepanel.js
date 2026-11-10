// The study panel: a side panel that stays open while the reader moves between
// tabs, showing what they asked to have explained and what is due again.
//
// It holds no data of its own. The learning record lives in the worker's
// IndexedDB (record.js) and this page asks for it by message, then redraws
// whenever the worker announces a change. So an explanation on any tab shows
// up here a moment later without the panel doing anything.
//
// MESSAGES. chrome.runtime.sendMessage is a broadcast: this page also hears the
// offscreen document's audio traffic and every other extension message. The
// listener below acts only on messages addressed to target "sidepanel" and
// returns false for everything else, so it never holds another message's
// response channel open. tests/sidepanel.mjs checks that.
//
// Everything is built with createElement and textContent. Selections, page
// titles and explanations all come from arbitrary web pages and models.

const SP_STANDING = {
  unchecked: 'Not checked yet',
  due: 'Due',
  missed: 'Missed last time',
  known: 'Known',
};

function spEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function spSend(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        void chrome.runtime.lastError;
        resolve(response || null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

// "[[TOPIC]] Title" off the end of a streamed explanation. The same tag the
// answer card uses (content.js splitTopic), parsed here because a panel page
// cannot load the content script.
function spSplitTopic(text) {
  const value = String(text || '');
  const match = /\[\[\s*TOPIC\s*\]\]/i.exec(value);
  if (!match) return { body: value.trim(), topic: '' };
  const topic = value
    .slice(match.index + match[0].length)
    .replace(/[\r\n][\s\S]*$/, '')
    .trim();
  return { body: value.slice(0, match.index).trim(), topic };
}

function spStripForDisplay(text) {
  const value = String(text || '');
  const match = /\[\[\s*TOPIC/i.exec(value);
  return (match ? value.slice(0, match.index) : value).trimEnd();
}

// A link back to where it was read. A text fragment makes Chrome scroll to and
// highlight the passage, when the page still contains it.
function spPageLink(item) {
  if (!item.urlKey || !/^https?:/.test(item.urlKey)) return '';
  const words = String(item.selection || '').replace(/…$/, '').split(/\s+/).filter(Boolean);
  if (words.length < 2) return item.urlKey;
  const fragment =
    words.length <= 8
      ? encodeURIComponent(words.join(' '))
      : `${encodeURIComponent(words.slice(0, 4).join(' '))},${encodeURIComponent(words.slice(-4).join(' '))}`;
  return `${item.urlKey}#:~:text=${fragment.replace(/-/g, '%2D')}`;
}

// --- one item -------------------------------------------------------------------

function spItemCard(item) {
  const card = spEl('article', `sp-item sp-${item.standing}`);

  const head = spEl('div', 'sp-item-head');
  head.appendChild(spEl('span', `sp-pill sp-pill-${item.standing}`, SP_STANDING[item.standing] || ''));
  if (item.checked && !item.isDue) {
    head.appendChild(spEl('span', 'sp-when', `Review ${jcCheckWhen(item.dueAt, Date.now())}`));
  }
  card.appendChild(head);

  card.appendChild(spEl('p', 'sp-selection', item.selection));
  // Long explanations are folded to a few lines; a click opens them.
  const gist = spEl('p', 'sp-gist sp-fold', item.gist);
  gist.addEventListener('click', () => gist.classList.toggle('sp-fold'));
  card.appendChild(gist);

  if (item.source && item.source.text) {
    const source = spEl('p', 'sp-source');
    source.appendChild(spEl('span', 'sp-label', 'From the page'));
    source.appendChild(document.createTextNode(` ${item.source.text}`));
    card.appendChild(source);
  }

  const meta = spEl('div', 'sp-meta');
  const href = spPageLink(item);
  if (href) {
    const link = spEl('a', 'sp-page', item.title || item.urlKey);
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    meta.appendChild(link);
  } else if (item.title) {
    meta.appendChild(spEl('span', 'sp-page', item.title));
  }
  if (item.rightCount || item.wrongCount) {
    meta.appendChild(spEl('span', 'sp-score', `${item.rightCount || 0} right, ${item.wrongCount || 0} missed`));
  }
  card.appendChild(meta);

  const actions = spEl('div', 'sp-actions');
  const check = spEl('button', 'sp-btn', 'Check me');
  check.type = 'button';
  const remove = spEl('button', 'sp-link sp-danger', 'Remove');
  remove.type = 'button';
  actions.appendChild(check);
  actions.appendChild(remove);
  card.appendChild(actions);

  const quiz = spEl('div', 'jc-check');
  quiz.hidden = true;
  card.appendChild(quiz);

  check.addEventListener('click', () => {
    check.disabled = true;
    // While a check is open, an incoming "record changed" must not redraw the
    // list out from under the answer being typed.
    spChecking += 1;
    jcCheckMount(quiz, {
      selection: item.selection,
      explanation: item.gist,
      source: item.source ? item.source.text : '',
      getId: () => item.id,
      send: spSend,
      onDone: () => {
        spChecking = Math.max(0, spChecking - 1);
        spStale = true;
      },
    });
  });
  remove.addEventListener('click', async () => {
    await spSend({ type: 'JC_RECORD_DELETE', id: item.id });
    spRefresh(true);
  });
  return card;
}

// --- the list -------------------------------------------------------------------

let spChecking = 0;
let spStale = false;

function spRender(data) {
  const stats = document.getElementById('sp-stats');
  const list = document.getElementById('sp-list');
  while (stats.firstChild) stats.removeChild(stats.firstChild);
  while (list.firstChild) list.removeChild(list.firstChild);

  if (!data || !data.total) {
    const empty = spEl('div', 'sp-empty');
    empty.appendChild(spEl('p', 'sp-empty-title', 'Nothing here yet.'));
    empty.appendChild(
      spEl('p', 'sp-empty-text', 'Highlight something on a page and ask JustClarify to explain it. It will appear here, with a quick question to check you understood it.'),
    );
    list.appendChild(empty);
    return;
  }

  for (const [value, label] of [
    [data.due, 'due now'],
    [data.total, data.total === 1 ? 'item' : 'items'],
    [data.checked ? `${data.right}/${data.right + data.wrong || data.checked}` : '0', 'answered right'],
  ]) {
    const cell = spEl('div', 'sp-stat');
    cell.appendChild(spEl('span', 'sp-stat-value', String(value)));
    cell.appendChild(spEl('span', 'sp-stat-label', label));
    stats.appendChild(cell);
  }

  const due = data.topics.flatMap((topic) => topic.items.filter((item) => item.isDue));
  if (due.length) {
    const section = spEl('section', 'sp-group sp-group-due');
    section.appendChild(spEl('h2', 'sp-group-title', `Due now (${due.length})`));
    for (const item of due.sort((a, b) => a.dueAt - b.dueAt).slice(0, 30)) section.appendChild(spItemCard(item));
    list.appendChild(section);
  }

  for (const topic of data.topics) {
    const rest = topic.items.filter((item) => !item.isDue);
    if (!rest.length) continue;
    const section = spEl('details', 'sp-group');
    const summary = spEl('summary', 'sp-group-title');
    summary.appendChild(spEl('span', 'sp-topic', topic.topic));
    summary.appendChild(spEl('span', 'sp-count', String(rest.length)));
    section.appendChild(summary);
    for (const item of rest) section.appendChild(spItemCard(item));
    list.appendChild(section);
  }
}

async function spRefresh(force) {
  if (spChecking > 0 && !force) {
    spStale = true;
    return;
  }
  spStale = false;
  spRender(await spSend({ type: 'JC_RECORD_LIST' }));
}

// --- a selection sent from a PDF ------------------------------------------------

async function spTakePending() {
  const response = await spSend({ type: 'JC_SP_TAKE_PENDING' });
  const pending = response && response.pending;
  if (!pending || !pending.selection) return;

  const slot = document.getElementById('sp-live');
  while (slot.firstChild) slot.removeChild(slot.firstChild);
  slot.hidden = false;
  slot.appendChild(spEl('p', 'sp-selection', pending.selection.slice(0, 600)));
  if (pending.note === 'pdf') {
    slot.appendChild(
      spEl('p', 'sp-hint', 'This is from a PDF, so the explanation uses only the text you selected, not the rest of the document.'),
    );
  }
  const answer = spEl('p', 'sp-gist sp-streaming', 'Thinking');
  answer.setAttribute('role', 'status');
  slot.appendChild(answer);

  let port;
  try {
    port = chrome.runtime.connect({ name: 'jc-sp-ask' });
  } catch (_) {
    answer.textContent = "JustClarify couldn't start. Reload the extension and try again.";
    return;
  }
  port.onMessage.addListener(async (message) => {
    if (!message) return;
    if (message.type === 'grow') {
      answer.textContent = spStripForDisplay(message.answer);
      return;
    }
    if (message.type !== 'done') return;
    try {
      port.disconnect();
    } catch (_) {}
    answer.classList.remove('sp-streaming');
    if (!message.ok) {
      answer.textContent = message.error || "JustClarify couldn't get an answer. Try again.";
      return;
    }
    const { body, topic } = spSplitTopic(message.answer);
    answer.textContent = body;
    // Saved like any other explanation. The panel is not the page being read,
    // so it supplies the address the worker stashed for it.
    const saved = await spSend({
      type: 'JC_RECORD_ADD',
      selection: pending.selection,
      answer: body,
      topic,
      mode: 'default',
      url: pending.url,
      title: pending.title,
    });
    if (saved && saved.ok) slot.appendChild(spEl('p', 'sp-hint', 'Saved below, with a question to check it later.'));
  });
  port.postMessage({ type: 'explain', selection: pending.selection });
}

// --- footer ---------------------------------------------------------------------

async function spExport() {
  const data = await spSend({ type: 'JC_RECORD_EXPORT' });
  if (!data || !data.ok) return;
  const blob = new Blob([JSON.stringify({ exportedAt: data.exportedAt, items: data.items }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `justclarify-study-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function spWireFooter() {
  const confirm = document.getElementById('sp-confirm');
  document.getElementById('sp-export').addEventListener('click', spExport);
  document.getElementById('sp-clear').addEventListener('click', () => {
    confirm.hidden = false;
  });
  document.getElementById('sp-clear-no').addEventListener('click', () => {
    confirm.hidden = true;
  });
  document.getElementById('sp-clear-yes').addEventListener('click', async () => {
    confirm.hidden = true;
    await spSend({ type: 'JC_RECORD_CLEAR' });
    spRefresh(true);
  });
}

// --- start ----------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  // Not ours: say nothing and hold nothing open.
  if (!message || message.target !== 'sidepanel') return false;
  if (message.type === 'JC_RECORD_CHANGED') spRefresh(false);
  if (message.type === 'JC_SP_PENDING') spTakePending();
  return false;
});

// A check that finished while the list was held still: redraw once it is safe.
setInterval(() => {
  if (spStale && spChecking === 0) spRefresh(false);
}, 1500);

// Due items change with the clock, not only with new data.
setInterval(() => spRefresh(false), 60_000);

if (typeof jcInitBrand === 'function') jcInitBrand();
spWireFooter();
spRefresh(true);
spTakePending();
