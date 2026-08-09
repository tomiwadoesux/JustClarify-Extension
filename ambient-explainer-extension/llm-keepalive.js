// llm-keepalive.js — makes a hidden chat tab keep painting.
//
// Runs in the MAIN world at document_start on the provider hosts, and is INERT
// until the worker stamps data-jc-drive="1" on <html>. That stamp only ever
// lands on the temp tab JustClarify opened itself, so a user's own ChatGPT tab
// is never touched.
//
// THE BUG THIS EXISTS FOR: "it sends, but I have to open the LLM tab before the
// answer comes back."
//
// Chrome gives a hidden tab no animation frames at all. Chat UIs buffer the
// tokens arriving over SSE and flush them to the DOM inside
// requestAnimationFrame, because painting every token individually is wasteful.
// So in a background tab the network stream runs perfectly, the tokens pile up
// in a buffer, and NOTHING is ever written to the page. We poll the DOM from
// the service worker, so we read an empty conversation and wait. Focus the tab
// and frames resume, the buffer flushes, and the whole answer appears at once.
//
// Two patches, both scoped to the stamped tab and both no-ops while visible:
//   1. requestAnimationFrame falls back to a timer when hidden, so buffered
//      renders actually flush. Background timers are clamped to ~1s, which is
//      far finer than the "never" it replaces.
//   2. The page is told it is visible, so anything that pauses its own work
//      while backgrounded carries on instead.
//
// Deliberately generic: no provider-specific stream parsing, nothing to break
// when ChatGPT or Claude change their SSE format or their DOM.

(() => {
  const html = document.documentElement;
  // Read at call time, never cached: the stamp arrives a moment after this
  // script runs, and the patches must be installed BEFORE page scripts grab
  // their own reference to requestAnimationFrame.
  const driving = () => html && html.dataset && html.dataset.jcDrive === "1";

  // The TRUE visibility, captured before patch 2 starts lying about it.
  // Without this the two patches defeat each other: patch 2 reports "visible",
  // patch 1 reads that and concludes it does not need the timer fallback, and
  // the tab silently goes back to never painting. Patch 1 has to see reality.
  const realVisibility = (() => {
    try {
      const descriptor =
        Object.getOwnPropertyDescriptor(document, "visibilityState") ||
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document) || {}, "visibilityState");
      if (descriptor && descriptor.get) return () => descriptor.get.call(document);
    } catch (_) {}
    return () => "visible";
  })();

  // --- 1. frames while hidden ------------------------------------------------

  const rawRaf = window.requestAnimationFrame;
  const rawCancel = window.cancelAnimationFrame;
  if (typeof rawRaf === "function") {
    // Timer ids and frame ids come from different sequences and could collide,
    // so track which ids we minted to cancel them correctly.
    const faked = new Set();

    window.requestAnimationFrame = function (callback) {
      if (driving() && realVisibility() === "hidden") {
        const id = setTimeout(() => {
          faked.delete(id);
          try {
            callback(performance.now());
          } catch (_) {
            // A throwing frame callback is the page's problem, not ours.
          }
        }, 32);
        faked.add(id);
        return id;
      }
      return rawRaf.call(window, callback);
    };

    window.cancelAnimationFrame = function (id) {
      if (faked.has(id)) {
        faked.delete(id);
        return clearTimeout(id);
      }
      return typeof rawCancel === "function" ? rawCancel.call(window, id) : undefined;
    };
  }

  // --- 2. "you are visible" --------------------------------------------------

  const define = (object, property, getter) => {
    try {
      const original =
        Object.getOwnPropertyDescriptor(object, property) ||
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(object) || {}, property);
      if (!original || !original.configurable) return;
      Object.defineProperty(object, property, {
        configurable: true,
        get() {
          if (driving()) return getter();
          return original.get ? original.get.call(this) : original.value;
        },
      });
    } catch (_) {
      // A locked-down property is not worth failing the whole script over.
    }
  };

  define(document, "visibilityState", () => "visible");
  define(document, "hidden", () => false);

  // An app that already believes it is visible must not then be told otherwise.
  // Capture phase so this runs before the page's own listeners.
  window.addEventListener(
    "visibilitychange",
    (event) => {
      if (!driving()) return;
      event.stopImmediatePropagation();
    },
    true,
  );
})();
