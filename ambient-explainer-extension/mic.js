// mic.js — the one-time microphone grant, and the only place it can happen.
//
// Chrome binds a microphone grant to an ORIGIN. voice.js runs as a content
// script, so its origin is whatever site the user is on — which is why the mic
// works on one site and is dead on the next: a page sending
// `Permissions-Policy: microphone=()`, any plain http:// page, and any site the
// user once clicked Block on all refuse, and there is nothing the extension can
// do about it from inside that page.
//
// The extension's own chrome-extension:// origin can hold ONE grant that works
// everywhere. The offscreen document shares that origin and can then capture on
// any site at all — but an offscreen document is invisible, so it has no way to
// show a permission prompt. Hence this page: a real tab, with a real user
// gesture, whose only job is to collect that grant once.

const grantButton = document.getElementById("grant");
const statusBox = document.getElementById("status");

function show(kind, text) {
  statusBox.hidden = false;
  statusBox.className = `status ${kind}`;
  statusBox.textContent = text;
}

async function alreadyGranted() {
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    return status.state === "granted";
  } catch (_) {
    return false;
  }
}

async function request() {
  grantButton.disabled = true;
  show("", "Waiting for Chrome…");

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    grantButton.disabled = false;
    const name = (error && error.name) || "";
    if (name === "NotAllowedError") {
      show(
        "bad",
        "Chrome blocked the microphone. Click the camera icon in the address bar, " +
          "allow the microphone, then reload this page.",
      );
    } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      show("bad", "No microphone found. Plug one in, then try again.");
    } else {
      show("bad", `The microphone couldn't start (${name || "unknown error"}).`);
    }
    return;
  }

  // The grant is what we came for; the stream itself is not wanted. Releasing
  // it immediately means Chrome's recording indicator never lingers on a tab
  // that is about to close.
  stream.getTracks().forEach((track) => {
    try { track.stop(); } catch (_) {}
  });

  try {
    await chrome.storage.local.set({ jcMicGranted: true });
  } catch (_) {}

  show("ok", "Done. Hold Shift on any page and JustClarify will hear you.");
  grantButton.hidden = true;

  setTimeout(() => {
    // Close the tab we opened. Harmless if the user already navigated away.
    chrome.tabs.getCurrent().then(
      (tab) => { if (tab) chrome.tabs.remove(tab.id).catch(() => {}); },
      () => {},
    );
  }, 1800);
}

grantButton.addEventListener("click", request);

alreadyGranted().then((granted) => {
  if (!granted) return;
  chrome.storage.local.set({ jcMicGranted: true }).catch(() => {});
  show("ok", "The microphone is already allowed. Hold Shift on any page to talk.");
  grantButton.textContent = "Check again";
});
