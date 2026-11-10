// What happens after an explanation lands: it is saved to the learning record,
// the part of the page it drew on is shown, and the reader is offered a quick
// check.
//
// This is the glue between content.js (which asks and renders), ground.js
// (which picks passages) and the worker's record.js and checkme.js. It is its
// own file so that content.js, already five thousand lines, gains three short
// calls and nothing else.
//
// THE RECORD NEVER GOES THROUGH jcStorageSet. That function mirrors what it
// saves into the host page's localStorage. Everything here goes to the worker
// by message and is stored in the extension's own IndexedDB (see record.js).
// tests/sidepanel.mjs fails if that ever changes.
//
// Loaded as a content script before content.js. It uses jcSend from content.js,
// but only inside functions that run long after every script has loaded.

// Modes that explain something. Translate, the dictionary, fact-check and the
// rewrite modes are not study material and are neither grounded nor recorded.
const JC_LEARN_MODES = new Set(['default', 'eli5', 'simpler', 'detailed', 'example', 'followup']);

function jcLearnSend(message) {
  return new Promise((resolve) => {
    try {
      const sent = jcSend(message, (response) => resolve(response || null), () => resolve(null));
      if (!sent) resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

// The grounding for one ask, or nothing. Never throws: grounding is an
// improvement to an explanation, never a condition of getting one.
function jcGroundFor(mode, data, question) {
  const none = { block: '', passages: [] };
  try {
    if (!data || data.standalone) return none;
    if (!JC_LEARN_MODES.has(mode || 'default')) return none;
    // Expand already reads a wide window of the page. Stacking more passages on
    // top would push a hosted request toward its size limit for little gain.
    if (mode === 'detailed' && String(data.contextWindowWide || '').length > 2500) return none;
    if (typeof groundForAsk !== 'function') return none;
    return groundForAsk(data, question);
  } catch (_) {
    return none;
  }
}

function jcLearnEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function jcLearnClip(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

// Add the source and the two actions under the answer. Built with textContent
// only: the passage is text from an arbitrary web page.
function jcLearnRender(popup, state) {
  const live = popup && popup.isConnected ? popup : document.getElementById('ambient-popup');
  if (!live) return;
  const body = live.querySelector('.explanation-body');
  if (!body) return;
  live.querySelectorAll('.jc-learn').forEach((old) => old.remove());

  const root = jcLearnEl('div', 'jc-learn');

  if (state.passage) {
    const source = jcLearnEl('div', 'jc-learn-source');
    source.appendChild(jcLearnEl('span', 'jc-learn-label', 'From this page'));
    source.appendChild(jcLearnEl('p', 'jc-learn-quote', jcLearnClip(state.passage.text, 260)));
    const show = jcLearnEl('button', 'jc-learn-link', 'Show on page');
    show.type = 'button';
    show.addEventListener('click', (event) => {
      event.stopPropagation();
      if (typeof groundShow === 'function') groundShow(state.passage);
    });
    source.appendChild(show);
    root.appendChild(source);
  }

  const actions = jcLearnEl('div', 'jc-learn-actions');
  const check = jcLearnEl('button', 'jc-learn-btn', 'Check me');
  check.type = 'button';
  const panel = jcLearnEl('button', 'jc-learn-btn', 'Study panel');
  panel.type = 'button';
  actions.appendChild(check);
  actions.appendChild(panel);
  root.appendChild(actions);

  const quiz = jcLearnEl('div', 'jc-learn-quiz jc-check');
  quiz.hidden = true;
  root.appendChild(quiz);

  check.addEventListener('click', (event) => {
    event.stopPropagation();
    check.disabled = true;
    jcCheckMount(quiz, {
      selection: state.selection,
      explanation: state.answer,
      source: state.passage ? state.passage.text : '',
      getId: () => state.id,
      send: jcLearnSend,
    });
  });
  panel.addEventListener('click', (event) => {
    event.stopPropagation();
    // The click is what lets the worker open the panel, so this is sent
    // straight away, with nothing awaited first.
    jcLearnSend({ type: 'JC_SP_OPEN' });
  });

  body.insertAdjacentElement('afterend', root);
}

// Called by content.js right after an answer is rendered.
function jcAfterAnswer(popup, info) {
  try {
    const mode = (info && info.mode) || 'default';
    if (!JC_LEARN_MODES.has(mode)) return;
    const result = (info && info.result) || {};
    const data = (info && info.data) || {};
    const selection = String(data.selectedText || '').trim();
    const answer = String(result.answer || '').trim();
    if (selection.length < 2 || !answer) return;

    const passages = (info.ground && info.ground.passages) || [];
    const passage = passages.find((p) => p.n === result.src) || null;
    const state = { id: null, selection, answer, passage };

    jcLearnSend({
      type: 'JC_RECORD_ADD',
      selection,
      answer,
      topic: result.topic || '',
      mode,
      source: passage ? { text: passage.text, n: passage.n } : null,
    }).then((response) => {
      if (response && response.ok) state.id = response.id;
    });

    jcLearnRender(popup, state);
  } catch (_) {
    // Never let study features break an explanation that already rendered.
  }
}
