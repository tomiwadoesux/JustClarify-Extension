// voice-frame.js — make push-to-talk work when focus is inside an iframe.
//
// THE BUG THIS EXISTS FOR: "sometimes I hold Shift+Z and nothing happens at all."
//
// voice.js listens for Shift+Z on the top document. A keydown is dispatched in the
// document that owns the focused element, so the moment focus sits inside any
// iframe — an embedded editor, a doc, a video player, a chat widget, a comment
// box — the event never reaches the top frame's listener. No chip, no timer, no
// microphone, and nothing to report: the gesture simply does not exist there.
//
// The obvious fix is `all_frames: true` on the main content script, and it is
// the wrong one. That would run gsap, content.js, commands.js and voice.js in
// EVERY frame of every page — including every ad iframe — each one mounting a
// chip, a mousemove listener, storage listeners, and a microphone-status probe
// that spins up an offscreen document in the worker. The cost is paid on every
// page load forever, to serve a gesture that fires occasionally.
//
// So: this file runs in all frames instead, and does nothing but notice Shift+Z
// and tell the top frame. Roughly thirty lines, two key listeners, no DOM, no
// storage, no styling. In the top frame it does not run at all.
//
// The hop goes through the WORKER rather than window.postMessage, and that is a
// security decision, not an implementation detail: any page can postMessage
// anything it likes to its own top frame, so a marker-based scheme would let a
// hostile site forge the gesture and open the microphone with no user action at
// all. chrome.runtime is reachable only from extension code, and the worker
// stamps the real frameId, so a page cannot fake this.

(function () {
  // The top frame already has the real voice.js. Only sub-frames need a relay.
  if (window.top === window) return;

  let armed = false;

  // Matches voice.js: the physical Z key, qualified by Shift.
  function isVoiceKey(e) {
    return e.code === "KeyZ" || e.key === "z" || e.key === "Z";
  }

  function tell(down) {
    try {
      chrome.runtime.sendMessage({ type: "JC_VOICE_FRAME_KEY", down });
    } catch (_) {
      // Extension reloaded out from under this frame. Nothing to do; the next
      // page load installs a fresh copy.
    }
  }

  // Capture phase, matching voice.js, so a frame that swallows key events in its
  // own handlers cannot eat the gesture before it is seen.
  document.addEventListener(
    "keydown",
    (e) => {
      if (!isVoiceKey(e) || e.repeat) return;
      if (!e.shiftKey) return;
      // Ctrl/Cmd/Alt+Shift+Z is redo, and must keep being redo.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Typing must never open a microphone. Checked here in
      // the frame that actually holds the focus, which is the whole point —
      // the top frame sees only `IFRAME` as its activeElement and cannot make
      // this judgement on the sub-frame's behalf.
      const el = document.activeElement;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (armed) return;
      armed = true;
      tell(true);
    },
    true,
  );

  document.addEventListener(
    "keyup",
    (e) => {
      // Either half of the chord ends the hold, in whatever order they lift.
      if ((!isVoiceKey(e) && e.key !== "Shift") || !armed) return;
      armed = false;
      tell(false);
    },
    true,
  );

  // Losing the frame must end the hold, or a live microphone outlives the
  // gesture that opened it.
  window.addEventListener("blur", () => {
    if (!armed) return;
    armed = false;
    tell(false);
  });
})();
