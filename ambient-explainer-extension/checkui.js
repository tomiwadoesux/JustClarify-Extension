// The "Check me" interface: a question, a box to answer in, and a verdict.
//
// ONE implementation, two homes. It is loaded as a content script (the answer
// card on a page) and by sidepanel.html (the study panel), so a check looks and
// behaves the same wherever it starts. The only thing that differs is how a
// message reaches the worker, so the caller passes that in as `send`.
//
// Everything is built with createElement and textContent. The question and the
// feedback are model output, and the answer card lives inside someone else's
// web page: nothing here is ever assigned as HTML.
//
// A check ALWAYS ends in a recorded result. If the question cannot be written
// the reader is told and can retry; if the grade cannot be produced they see
// the model answer and mark themselves. There is no state that spins forever.

const JC_CHECK_VERDICTS = {
  right: 'Right',
  partial: 'Partly right',
  wrong: 'Not quite',
};

// "tomorrow", "in 3 days", "in 10 minutes". Pure, tested in tests/checkme.mjs.
function jcCheckWhen(dueAt, now) {
  const ms = Math.max(0, Number(dueAt) - Number(now));
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 20) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  if (days <= 1) return 'tomorrow';
  return `in ${days} days`;
}

function jcCheckEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

// Mount a check into `root`.
//
//   input.selection, input.explanation, input.source   what to ask about
//   input.getId()   the learning-record item id, or null if it was not saved
//   input.send(message) -> Promise<response | null>
//   input.onDone()  called after a result is shown (optional)
function jcCheckMount(root, input) {
  const send = (message) =>
    Promise.resolve()
      .then(() => input.send(message))
      .catch(() => null);
  let question = null;

  function clear() {
    while (root.firstChild) root.removeChild(root.firstChild);
    root.hidden = false;
  }

  function status(text) {
    clear();
    const line = jcCheckEl('p', 'jc-check-status', text);
    line.setAttribute('role', 'status');
    root.appendChild(line);
  }

  function failed() {
    clear();
    root.appendChild(jcCheckEl('p', 'jc-check-status', 'Could not write a question just now.'));
    const retry = jcCheckEl('button', 'jc-check-btn', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', ask);
    root.appendChild(retry);
  }

  async function save(verdict, missed, self) {
    const id = input.getId ? input.getId() : null;
    if (!id) return null;
    return send({
      type: 'JC_RECORD_CHECK_SAVE',
      id,
      check: { q: question.q, verdict, missed: missed || '', self: !!self },
    });
  }

  async function showResult(verdict, feedback, missed, answer, self) {
    const saved = await save(verdict, missed, self);
    clear();
    const head = jcCheckEl('p', `jc-check-verdict jc-check-${verdict}`, JC_CHECK_VERDICTS[verdict] || '');
    head.setAttribute('role', 'status');
    root.appendChild(head);
    if (feedback) root.appendChild(jcCheckEl('p', 'jc-check-text', feedback));
    if (missed && verdict !== 'right') {
      root.appendChild(jcCheckEl('p', 'jc-check-text', `What was missing: ${missed}`));
    }
    if (answer && verdict !== 'right') {
      const model = jcCheckEl('p', 'jc-check-answer');
      model.appendChild(jcCheckEl('span', 'jc-check-label', 'Model answer'));
      model.appendChild(document.createTextNode(` ${answer}`));
      root.appendChild(model);
    }
    if (saved && saved.ok && saved.dueAt) {
      root.appendChild(jcCheckEl('p', 'jc-check-due', `Back for review ${jcCheckWhen(saved.dueAt, Date.now())}.`));
    }
    if (input.onDone) input.onDone(verdict);
  }

  // The grade could not be produced. Show the answer and let them decide.
  function selfGrade(answer) {
    clear();
    root.appendChild(
      jcCheckEl('p', 'jc-check-status', 'That could not be graded automatically. Compare your answer with this one and mark it yourself.'),
    );
    const model = jcCheckEl('p', 'jc-check-answer');
    model.appendChild(jcCheckEl('span', 'jc-check-label', 'Model answer'));
    model.appendChild(document.createTextNode(` ${answer}`));
    root.appendChild(model);
    const row = jcCheckEl('div', 'jc-check-row');
    for (const [verdict, label] of [['right', 'Got it'], ['partial', 'Partly'], ['wrong', 'Missed it']]) {
      const button = jcCheckEl('button', 'jc-check-btn', label);
      button.type = 'button';
      button.addEventListener('click', () => showResult(verdict, '', '', '', true));
      row.appendChild(button);
    }
    root.appendChild(row);
  }

  function showQuestion() {
    clear();
    root.appendChild(jcCheckEl('p', 'jc-check-q', question.q));
    const box = jcCheckEl('textarea', 'jc-check-input');
    box.rows = 3;
    box.maxLength = 800;
    box.placeholder = 'Answer in your own words';
    box.setAttribute('aria-label', 'Your answer');
    root.appendChild(box);
    const row = jcCheckEl('div', 'jc-check-row');
    const submit = jcCheckEl('button', 'jc-check-btn jc-check-primary', 'Submit');
    submit.type = 'button';
    const unsure = jcCheckEl('button', 'jc-check-btn', 'I do not know');
    unsure.type = 'button';
    row.appendChild(submit);
    row.appendChild(unsure);
    root.appendChild(row);

    const grade = async (reply) => {
      status('Checking your answer');
      const result = await send({
        type: 'JC_CHECK_GRADE',
        q: question.q,
        answer: question.answer,
        keys: question.keys,
        reply,
      });
      if (result && result.ok) {
        return showResult(result.verdict, result.feedback, result.missed, result.answer || question.answer, false);
      }
      return selfGrade((result && result.answer) || question.answer);
    };
    submit.addEventListener('click', () => {
      const reply = box.value.trim();
      if (!reply) {
        box.focus();
        return;
      }
      grade(reply);
    });
    unsure.addEventListener('click', () => grade(''));
    // Keys typed here must not reach the page's own shortcuts.
    box.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit.click();
    });
    box.addEventListener('keyup', (event) => event.stopPropagation());
    box.addEventListener('keypress', (event) => event.stopPropagation());
    try {
      box.focus({ preventScroll: true });
    } catch (_) {}
  }

  async function ask() {
    status('Writing a question');
    const result = await send({
      type: 'JC_CHECK_QUESTION',
      selection: input.selection,
      explanation: input.explanation,
      source: input.source || '',
    });
    if (!result || !result.ok || !result.q) return failed();
    question = { q: result.q, answer: result.answer, keys: result.keys || [] };
    showQuestion();
  }

  ask();
}
