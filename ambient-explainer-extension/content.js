let blobEl = null;
let popupEl = null;
let blobShowTimer = null;
let blobDismissTimer = null;
const API_BASE_URL = "http://localhost:8000";
const ACCESS_EMAIL_KEY = "justclarifyAccessEmail";

// --- Semantic Window Extraction ---

// Helper: Detect background, text colors, and font from the context
function getThemeColors(element) {
  let el = element;
  let bg = "rgb(250, 250, 250)"; // Default fallback (close to white)
  let text = "rgb(0, 0, 0)"; // Default fallback (black)
  let font = "Inter, -apple-system, BlinkMacSystemFont, sans-serif"; // Default fallback

  // 1. Get Text Color and Font (from immediate parent, as they inherit)
  if (el) {
    const style = window.getComputedStyle(el);
    if (style.color) text = style.color;
    if (style.fontFamily) font = style.fontFamily;
  }

  // 2. Get Background Color (traverse up until non-transparent)
  while (el) {
    const style = window.getComputedStyle(el);
    const bgColor = style.backgroundColor;

    // Check for transparency (keyword or alpha=0)
    if (
      bgColor &&
      bgColor !== "transparent" &&
      !bgColor.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/)
    ) {
      bg = bgColor;
      break;
    }
    el = el.parentElement;
  }

  return { bg, text, font };
}

function extractSemanticWindow(fullText, selectionStart, selectionEnd) {
  const MAX_RADIUS = 500; // fallback safety

  let start = selectionStart;
  let end = selectionEnd;

  // ---- Backward scan (2 sentences)
  let backwardMatches = 0;
  for (let i = selectionStart; i >= 0; i--) {
    if (fullText[i] === "." && fullText[i + 1] === " ") {
      backwardMatches++;
      if (backwardMatches === 2) {
        start = i + 2;
        break;
      }
    }
  }

  // ---- Forward scan (2 sentences)
  let forwardMatches = 0;
  for (let i = selectionEnd; i < fullText.length; i++) {
    if (fullText[i] === "." && fullText[i + 1] === " ") {
      forwardMatches++;
      if (forwardMatches === 2) {
        end = i + 1;
        break;
      }
    }
  }

  // ---- Fallback if too small
  if (end - start < 50) {
    start = Math.max(0, selectionStart - MAX_RADIUS);
    end = Math.min(fullText.length, selectionEnd + MAX_RADIUS);
  }

  return fullText.slice(start, end).trim();
}

// Helper: Expand partial word selections to full words
function expandToFullWord(text, start, end) {
  // Word characters (letters, numbers, hyphens, apostrophes)
  const isWordChar = (char) => /[\w'-]/i.test(char);

  let expandedStart = start;
  let expandedEnd = end;

  // Expand backward to find word start
  while (expandedStart > 0 && isWordChar(text[expandedStart - 1])) {
    expandedStart--;
  }

  // Expand forward to find word end
  while (expandedEnd < text.length && isWordChar(text[expandedEnd])) {
    expandedEnd++;
  }

  return {
    start: expandedStart,
    end: expandedEnd,
    fullWord: text.slice(expandedStart, expandedEnd),
  };
}

// --- Selection & Blob Logic ---

let selectionTimeout = null;

document.addEventListener("selectionchange", () => {
  // Clear the existing timer if the user is still highlighting
  if (selectionTimeout) {
    clearTimeout(selectionTimeout);
    selectionTimeout = null;
  }

  // Hide the blob immediately while they are making a new selection
  removeBlob(false);

  const selection = window.getSelection();
  if (!selection || selection.toString().trim() === "") {
    return;
  }

  // Set a 1-second timer before showing the blob
  selectionTimeout = setTimeout(() => {
    // Re-fetch the selection just in case it changed right at the end
    const currentSelection = window.getSelection();
    if (!currentSelection || currentSelection.toString().trim() === "") {
      return;
    }

    const range = currentSelection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    // Get readable text
    const fullText =
      container.nodeType === Node.TEXT_NODE
        ? container.textContent
        : container.innerText || "";

    const selectionStart = range.startOffset;
    const selectionEnd = range.endOffset;

    // Get the raw selected text
    let selectedText = currentSelection.toString().trim();

    // If it looks like a partial word (no spaces), try to expand it
    if (!selectedText.includes(" ") && fullText) {
      const expanded = expandToFullWord(fullText, selectionStart, selectionEnd);

      // Only use expanded word if it's different and makes sense
      if (expanded.fullWord && expanded.fullWord.length > selectedText.length) {
        console.log("EXPANDED:", selectedText, "→", expanded.fullWord);
        selectedText = expanded.fullWord;
      }
    }

    const contextWindow = extractSemanticWindow(
      fullText,
      selectionStart,
      selectionEnd,
    );

    // Debug log to verify context window
    console.log("CONTEXT WINDOW:", contextWindow);
    console.log("SELECTED TEXT:", selectedText);

    const rect = range.getBoundingClientRect();
    showBlob(rect, {
      selectedText,
      contextWindow,
    });
  }, 500); // 0.5-second delay
});

// Handle clicking outside to close popup
document.addEventListener("mousedown", (e) => {
  if (e.target.closest("#ambient-popup") || e.target.closest("#ambient-blob")) {
    return;
  }
  removePopup();
});

// Handle ESC key to close popup
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    removePopup();
    removeBlob(false);
  }
});

function showBlob(rect, data) {
  // Clear any pending show/dismiss timers
  clearTimeout(blobShowTimer);
  clearTimeout(blobDismissTimer);

  // Remove existing blob immediately (no animation for replacement)
  if (blobEl) {
    blobEl.remove();
    blobEl = null;
  }

  blobEl = document.createElement("div");
  blobEl.id = "ambient-blob";

  blobEl.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g clip-path="url(#clip0_6_53)">
          <path d="M0 0H16.64C25.1231 0 32 6.87692 32 15.36V32H16C7.16346 32 0 24.8365 0 16V0Z" fill="#4447A9"/>
          <path d="M26.88 26.88H15.9802C9.98225 26.88 5.12001 22.0079 5.12001 16.0099C5.12001 10.001 9.99116 5.12001 16 5.12001C22.0088 5.12001 26.88 9.99116 26.88 16V26.88Z" fill="black"/>
          <path d="M24.4364 24.4364H15.9846C11.3338 24.4364 7.56364 20.6585 7.56364 16.0077C7.56364 11.3484 11.3407 7.56364 16 7.56364C20.6593 7.56364 24.4364 11.3407 24.4364 16V24.4364Z" fill="#F0F0F0"/>
        </g>
        <defs>
          <clipPath id="clip0_6_53">
            <rect width="32" height="32" fill="white"/>
          </clipPath>
        </defs>
      </svg>
    `;

  blobEl.style.left = `${rect.right + window.scrollX + 6}px`;
  blobEl.style.top = `${rect.bottom + window.scrollY + 2}px`;

  blobEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearTimeout(blobDismissTimer);
    openPopupAtSelection(rect, data);
  });

  document.body.appendChild(blobEl);

  // Auto-dismiss after 6 seconds of no interaction
  blobDismissTimer = setTimeout(() => {
    removeBlob(true);
  }, 6000);
}

function removeBlob(animate) {
  clearTimeout(blobShowTimer);
  clearTimeout(blobDismissTimer);

  if (blobEl) {
    if (animate) {
      blobEl.classList.add("blob-exit");
      blobEl.addEventListener(
        "animationend",
        () => {
          if (blobEl) {
            blobEl.remove();
            blobEl = null;
          }
        },
        { once: true },
      );
    } else {
      blobEl.remove();
      blobEl = null;
    }
  }
}

// --- Popup & Fetch Logic ---

let currentExplainData = null;

function getStoredAccessEmail() {
  return new Promise((resolve) => {
    chrome.storage.local.get([ACCESS_EMAIL_KEY], (result) => {
      resolve(result[ACCESS_EMAIL_KEY] || "");
    });
  });
}

function saveAccessEmail(email) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [ACCESS_EMAIL_KEY]: email }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }

      resolve();
    });
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function openPopupAtSelection(rect, data) {
  removePopup();
  currentExplainData = data;

  const popup = document.createElement("div");
  popup.id = "ambient-popup";
  popup.classList.add("is-loading");

  popup.innerHTML = `
    <div class="popup-content loading">
      <div class="loader"></div>
    </div>
  `;

  const padding = 12;
  popup.style.top = `${rect.bottom + window.scrollY + padding}px`;
  popup.style.left = `${rect.left + window.scrollX}px`;

  // Detect theme context and apply colors
  const range = window.getSelection().getRangeAt(0);
  const container =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;

  const { bg, text } = getThemeColors(container);

  // Hydrate popup with detected colors, force accent
  popup.style.setProperty("--surface-color", bg);
  popup.style.setProperty("--bg-color", bg);
  popup.style.setProperty("--text-primary", text);
  popup.style.setProperty("--text-secondary", text);
  popup.style.setProperty("--accent", "#4447a9");

  // Border color matches text color as requested
  popup.style.setProperty("--border-color", text);

  document.body.appendChild(popup);
  popupEl = popup;

  // Force a frame, then reveal
  requestAnimationFrame(() => {
    popup.classList.add("visible");
  });

  const storedEmail = await getStoredAccessEmail();
  if (!storedEmail) {
    renderEmailGate(popup);
    return;
  }

  fetchExplanation("default");
}

function renderEmailGate(popup) {
  popup.classList.remove("is-loading");
  popup.classList.add("is-loaded");

  const content = popup.querySelector(".popup-content");
  content.classList.remove("loading");
  content.classList.add("ready");
  content.innerHTML = `
    <div class="popup-header">
      <h1 class="header-name">Unlock JustClarify</h1>
    </div>
    <div class="popup-divider"></div>

    <div class="email-gate">
      <img class="gate-logo" src="${chrome.runtime.getURL("icons/icon-96.png")}" alt="JustClarify logo" />
      <span class="content-label">EARLY ACCESS</span>
      <p class="gate-copy">Enter your email once to start using the extension and receive product updates.</p>
      <form id="ambient-email-form" class="email-form">
        <input id="ambient-email-input" class="email-input" type="email" placeholder="you@example.com" autocomplete="email" required />
        <button type="submit" class="email-submit">Continue</button>
      </form>
      <p id="ambient-email-error" class="email-error" hidden>Please enter a valid email.</p>
    </div>

    <div class="popup-footer">
      <span class="footer-meta">© 2026 JustClarify</span>
    </div>
  `;

  const form = content.querySelector("#ambient-email-form");
  const input = content.querySelector("#ambient-email-input");
  const errorEl = content.querySelector("#ambient-email-error");

  input.focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = input.value.trim().toLowerCase();
    if (!isValidEmail(email)) {
      errorEl.hidden = false;
      return;
    }

    errorEl.hidden = true;
    input.disabled = true;
    form.querySelector("button").disabled = true;

    try {
      await saveAccessEmail(email);
      popup.classList.remove("is-loaded");
      popup.classList.add("is-loading");
      content.classList.remove("ready");
      content.classList.add("loading");
      content.innerHTML = `
        <div class="loader"></div>
      `;
      fetchExplanation("default");
    } catch {
      input.disabled = false;
      form.querySelector("button").disabled = false;
      errorEl.textContent = "Could not save your email. Try again.";
      errorEl.hidden = false;
    }
  });
}

function removePopup() {
  const popup = document.getElementById("ambient-popup");
  if (popup) popup.remove();
  popupEl = null;
}

function fetchExplanation(mode) {
  const popup = document.getElementById("ambient-popup");
  if (!popup || !currentExplainData) return;

  const { selectedText, contextWindow } = currentExplainData;

  console.log("SELECTION SENT:", selectedText);
  console.log("CONTEXT SENT:", contextWindow);
  console.log("MODE:", mode);

  if (!selectedText || selectedText.trim() === "") {
    popup.querySelector(".popup-content").innerText = "No text selected.";
    return;
  }

  // Set loading state
  const content = popup.querySelector(".popup-content");
  content.classList.remove("ready");
  content.classList.add("loading");
  content.innerHTML = `
    <div class="loader"></div>
  `;
  popup.classList.remove("is-loaded");
  popup.classList.add("is-loading");

  fetch(`${API_BASE_URL}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      highlighted_text: selectedText,
      context_window: contextWindow,
      mode: mode,
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      console.log("API RESPONSE:", data);
      console.log("SUGGESTED QUESTIONS:", data.suggested_questions);

      const explanationHTML = formatExplanation(data.explanation);

      // Morph: switch from compact loader to full-width content
      popup.classList.remove("is-loading");
      popup.classList.add("is-loaded");

      content.classList.remove("loading");
      content.classList.add("ready");
      content.innerHTML = `
        <div class="popup-header">
          <h1 class="header-name">"${currentExplainData.selectedText}"</h1>
        </div>
        <div class="popup-divider"></div>

        <div class="explanation-body">
           ${data.source === "dictionary" ? '<span class="source-tag">Dictionary</span>' : ""}
           <span class="content-label">${data.source === "dictionary" ? "DEFINITION" : "EXPLANATION"}</span>
           <h2 class="explanation">${explanationHTML}</h2>
        </div>

        <div class="buttons primary">
          ${data.source === "dictionary" ? '<button data-mode="default-ai">AI Explanation</button>' : ""}
          <button data-mode="simpler">Simplify</button>
          <button data-mode="detailed">Expand</button>
          <button data-mode="example">Example</button>
        </div>

        ${
          data.suggested_questions?.length
            ? `
              <div class="suggested">
                <span class="suggested-title">You might ask</span>
                <div class="buttons secondary">
                  ${data.suggested_questions
                    .map(
                      (q) => `<button data-mode="followup" data-question="${q}">
                              ${q}
                            </button>`,
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }

        <div class="popup-footer">
          <span class="footer-meta">© 2026 JustClarify</span>
        </div>
      `;

      wireFollowUpButtons();
    })
    .catch(() => {
      popup.querySelector(".popup-content").innerText = "Something went wrong.";
    });
}

function wireFollowUpButtons() {
  document.querySelectorAll("#ambient-popup button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-mode");

      if (mode === "followup") {
        const question = btn.getAttribute("data-question");
        fetchFollowUpQuestion(question);
      } else {
        fetchExplanation(mode);
      }
    });
  });
}

function fetchFollowUpQuestion(question) {
  const popup = document.getElementById("ambient-popup");
  const content = popup.querySelector(".popup-content");

  content.classList.remove("ready");
  content.classList.add("loading");
  content.innerHTML = `
    <div class="loader"></div>
  `;
  popup.classList.remove("is-loaded");
  popup.classList.add("is-loading");

  fetch(`${API_BASE_URL}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      highlighted_text: currentExplainData.selectedText,
      context_window: currentExplainData.contextWindow,
      mode: "followup",
      followup_question: question,
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      const explanationHTML = formatExplanation(data.explanation);

      popup.classList.remove("is-loading");
      popup.classList.add("is-loaded");
      content.classList.remove("loading");
      content.classList.add("ready");
      content.innerHTML = `
        <div class="popup-header">
          <h1 class="header-name">"${currentExplainData.selectedText}"</h1>
        </div>
        <div class="popup-divider"></div>

        <div class="explanation-body">
           <span class="content-label">ANSWER</span>
           <h2 class="explanation">${explanationHTML}</h2>
        </div>

        <div class="buttons primary">
          <button data-mode="simpler">Simplify</button>
          <button data-mode="detailed">Expand</button>
          <button data-mode="example">Example</button>
        </div>

        <div class="popup-footer">
          <span class="footer-meta">© 2026 JustClarify</span>
        </div>
      `;

      wireFollowUpButtons();
    });
}

// Helper to format explanation text
function formatExplanation(text) {
  // Check if it already has numbered list format
  if (text.match(/^\d+\./m)) {
    return text
      .split(/\n+/)
      .map((line) => {
        const match = line.match(/^(\d+)\.\s*(.*)/);
        if (match) {
          return `<div class="expl-item"><span class="expl-num">${match[1]}</span><span class="expl-text">${match[2]}</span></div>`;
        }
        return `<p>${line}</p>`;
      })
      .join("");
  }

  // Attempt to split by sentences if it looks like multiple distinct definitions?
  // For now, if just text, return it.
  // If the user specificially wants "1, 2" for words with >1 explanation,
  // usually the API should provide that. We'll simply wrap generic text.
  return `<div class="expl-text">${text}</div>`;
}

// listener for context menu message
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "EXPLAIN_SELECTION") {
    const selection = window.getSelection();
    const text = selection ? selection.toString() : "";
    removeBlob(false);
    openPopupAtSelection(selection.getRangeAt(0).getBoundingClientRect(), {
      selectedText: text,
      contextWindow: text,
    });
  }
});
