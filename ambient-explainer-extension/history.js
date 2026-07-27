// JustClarify history page.
// Full-tab view of every saved conversation — the questions you asked and how
// JustClarify changed the page layout. Opened from the toolbar popup.
// Everything here is read from chrome.storage.local, where the content script
// saves it. Each topic carries an "i" that pops up its full exchange.

const JC_THREADS_KEY = "jcThreads";
const JC_CONVID_KEY = "jcDockConvId";
const JC_LAYOUT_KEY = "jcLayoutEvents";

let store = { threads: [], convId: null, layout: [] };
const jcThreadById = new Map(); // popover id -> thread, for the info popups

const listEl = document.getElementById("jc-pop-list");

function escapeHTML(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hueFromString(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function threadHue(t) {
  return typeof t.hue === "number" ? t.hue : hueFromString(t.id || "");
}

function load() {
  chrome.storage.local.get([JC_THREADS_KEY, JC_CONVID_KEY, JC_LAYOUT_KEY], (res) => {
    store.threads = Array.isArray(res[JC_THREADS_KEY]) ? res[JC_THREADS_KEY] : [];
    store.convId = res[JC_CONVID_KEY] || null;
    store.layout = Array.isArray(res[JC_LAYOUT_KEY]) ? res[JC_LAYOUT_KEY] : [];
    render();
  });
}

// Group threads + layout events by conversation id, newest conversation first.
function buildConversations() {
  const byId = new Map();
  const ensure = (id) => {
    if (!byId.has(id)) byId.set(id, { id, threads: [], layout: [], updated: 0 });
    return byId.get(id);
  };
  for (const t of store.threads) {
    const conv = ensure(t.convId || "default");
    conv.threads.push(t);
    conv.updated = Math.max(conv.updated, t.updated || 0);
  }
  for (const ev of store.layout) {
    const conv = ensure(ev.convId || "default");
    conv.layout.push(ev);
    conv.updated = Math.max(conv.updated, ev.time || 0);
  }
  const convs = [...byId.values()];
  convs.forEach((c) => c.layout.sort((a, b) => (b.time || 0) - (a.time || 0)));
  convs.sort((a, b) => b.updated - a.updated);
  return convs;
}

function convTitle(conv) {
  const newest = conv.threads[0];
  if (newest && newest.topic) return newest.topic;
  if (conv.layout[0] && conv.layout[0].title) return conv.layout[0].title;
  if (conv.id && conv.id !== "default") return "Conversation " + String(conv.id).slice(0, 6);
  return "Conversation";
}

function renderConv(conv, ci) {
  const isCurrent = conv.id === store.convId;
  const threadsHTML = conv.threads
    .slice()
    .reverse() // oldest-first within a conversation, like a transcript
    .map((t, ti) => {
      const id = `${ci}-${ti}`;
      jcThreadById.set(id, t);
      return (
        `<div class="jc-topic" style="--jc-tag-hue:${threadHue(t)};">` +
        `<span class="jc-topic-dot" aria-hidden="true"></span>` +
        `<span class="jc-topic-name">${escapeHTML(t.topic || "Topic")}</span>` +
        `<button class="jc-info" type="button" data-topic="${id}" aria-label="Show this exchange">i</button>` +
        `</div>`
      );
    })
    .join("");

  const layoutHTML = conv.layout.length
    ? `<div class="jc-layout"><div class="jc-layout-title">Page changes</div>` +
      conv.layout
        .map((ev) => {
          const where = ev.title ? ` on “${escapeHTML(ev.title)}”` : "";
          const gists = ev.gists && ev.gists.length ? ` — ${escapeHTML(ev.gists.join(", "))}` : "";
          const n = ev.count || (ev.gists ? ev.gists.length : 1);
          return `<div class="jc-layout-line">Folded ${n} ${n === 1 ? "section" : "sections"}${where}${gists}</div>`;
        })
        .join("") +
      `</div>`
    : "";

  const meta =
    `${conv.threads.length} topic${conv.threads.length === 1 ? "" : "s"}` +
    (conv.layout.length ? ` · ${conv.layout.length} change${conv.layout.length === 1 ? "" : "s"}` : "") +
    (isCurrent ? " · active" : "");

  return (
    `<section class="jc-conv">` +
    `<div class="jc-conv-head"><span class="jc-conv-title">${escapeHTML(convTitle(conv))}</span>` +
    `<span class="jc-conv-meta">${meta}</span></div>` +
    `<div class="jc-conv-body">${threadsHTML}${layoutHTML}</div>` +
    `</section>`
  );
}

function render() {
  jcThreadById.clear();
  jcCloseInfo();
  const convs = buildConversations();
  if (!convs.length) {
    listEl.innerHTML =
      `<div class="jc-empty"><strong>No conversations yet</strong>` +
      `Highlight text and ask JustClarify — your topics and page changes show up here.</div>`;
    return;
  }
  listEl.innerHTML = convs.map((c, i) => renderConv(c, i)).join("");
}

// --- Info popover: "what is this topic?" ------------------------------------
let jcInfoPop = null;

function jcCloseInfo() {
  if (jcInfoPop) {
    jcInfoPop.remove();
    jcInfoPop = null;
    document.removeEventListener("mousedown", jcOnInfoAway, true);
    document.removeEventListener("keydown", jcOnInfoEsc, true);
  }
}
function jcOnInfoAway(e) {
  if (jcInfoPop && !jcInfoPop.contains(e.target) && !e.target.closest(".jc-info")) jcCloseInfo();
}
function jcOnInfoEsc(e) {
  if (e.key === "Escape") jcCloseInfo();
}

function jcOpenInfo(btn) {
  const t = jcThreadById.get(btn.dataset.topic);
  jcCloseInfo();
  if (!t) return;

  const msgs = (t.messages || [])
    .map(
      (m) =>
        `<div class="jc-msg ${m.role === "user" ? "user" : "assistant"}">` +
        `<span class="jc-msg-role">${m.role === "user" ? "You" : "JustClarify"}</span>` +
        `${escapeHTML(m.text)}</div>`,
    )
    .join("");

  const pop = document.createElement("div");
  pop.className = "jc-info-pop";
  pop.innerHTML =
    `<div class="jc-info-pop-head">${escapeHTML(t.topic || "Topic")}</div>` +
    `<div class="jc-info-pop-body">${msgs || '<div class="jc-note">No messages saved for this topic.</div>'}</div>`;
  document.body.appendChild(pop);
  jcInfoPop = pop;

  // Anchor to the right of the "i", flipping left/up if it would overflow.
  const r = btn.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = r.right + 10 + window.scrollX;
  if (left + pr.width > window.scrollX + window.innerWidth - 12) {
    left = r.left - pr.width - 10 + window.scrollX;
  }
  if (left < window.scrollX + 12) left = window.scrollX + 12;
  let top = r.top + window.scrollY - 6;
  if (top + pr.height > window.scrollY + window.innerHeight - 12) {
    top = window.scrollY + window.innerHeight - pr.height - 12;
  }
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(window.scrollY + 12, top)}px`;

  setTimeout(() => {
    document.addEventListener("mousedown", jcOnInfoAway, true);
    document.addEventListener("keydown", jcOnInfoEsc, true);
  }, 0);
}

listEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".jc-info");
  if (btn) jcOpenInfo(btn);
});

// Live-refresh while the page is open if storage changes underneath it.
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[JC_THREADS_KEY] || changes[JC_CONVID_KEY] || changes[JC_LAYOUT_KEY]) load();
  });
}

// Paint this page with the shared random accent, then load.
try {
  if (typeof jcInitBrand === "function") jcInitBrand();
} catch (_) {}

load();
