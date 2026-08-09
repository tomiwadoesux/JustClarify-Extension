// hosted.js — the last tier of the engine chain: JustClarify's own model.
//
// Chrome's built-in model needs 16GB of RAM, 4GB of video memory and 22GB of
// free disk. Plenty of machines fail that, and their owners have no reason to
// go and get an API key. Before this tier existed, those users installed the
// extension and it simply did not work. Now they get answers out of the box.
//
// Order in askEngine(): on-device → the user's own Gateway key → here. It is
// last on purpose: it is the only tier that costs JustClarify money and the
// only one where the text leaves the user's machine to a JustClarify server.
//
// THE KEY IS NOT IN THIS FILE, and must never be. An extension bundle is a zip
// anyone can unpack; a key shipped inside one is a key being spent by strangers
// within days. justclarify.xyz/api/explain holds it server-side and proxies the
// stream back in the same SSE format the BYOK path already parses.
//
// Loaded by background.js AFTER gateway.js — reuses gatewayHistory /
// gatewaySaveHistory / gatewayReadStream / GATEWAY_SYSTEM_PROMPT so hosted
// answers share one per-tab conversation with every other engine.
//
// Exposes:
//   hostedAsk(prompt, reqId, tabId) -> { ok, answer, ... } | { ok:false, error }

const HOSTED_URL = "https://justclarify.xyz/api/explain";
const HOSTED_ENGINE = "justclarify";
const HOSTED_MODEL = "JustClarify hosted";

// An opaque per-install id so the server can rate-limit one installation
// without knowing anything about who it belongs to. Random, stored locally,
// never derived from anything about the user or the machine.
async function hostedInstallId() {
  const stored = await chrome.storage.local.get(["jcInstallId"]);
  if (stored.jcInstallId) return stored.jcInstallId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ jcInstallId: id });
  return id;
}

function hostedProgress(tabId, reqId, answer, done) {
  if (tabId == null) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: "CLAUDE_PROGRESS",
      reqId,
      thinking: "",
      answer,
      done,
      engine: HOSTED_ENGINE,
      model: HOSTED_MODEL,
    })
    .catch(() => {});
}

// Early access: the API is free until this date, so no ask should be met with
// a countdown. The meter machinery below stays intact and simply wakes up on
// its own the day the free period spins off — nothing to ship on the 28th.
const JC_FREE_UNTIL = Date.parse("2026-08-28T00:00:00");

function jcFreePeriod() {
  return Date.now() < JC_FREE_UNTIL;
}

// The server reports lifetime meter state on every metered response. Stored
// for the popup, and milestone crossings (10 used, 20, 2-left) get a one-time
// in-page nudge — telling people about the wall BEFORE they hit it.
async function hostedMeterNote(response, tabId) {
  try {
    const left = Number(response.headers.get("x-jc-free-left"));
    const total = Number(response.headers.get("x-jc-free-total"));
    if (!Number.isFinite(left) || !Number.isFinite(total) || total <= 0) return;
    const used = total - left;
    await chrome.storage.local.set({ jcMeterUsed: used, jcMeterTotal: total });

    // During early access the "X of 30 used" chip is a threat about a limit
    // that isn't being enforced. Count silently, say nothing.
    if (jcFreePeriod()) return;

    const milestones = [10, 20, total - 2];
    const { jcMeterShown } = await chrome.storage.local.get(["jcMeterShown"]);
    const shown = Array.isArray(jcMeterShown) ? jcMeterShown : [];
    const crossed = milestones.find((m) => m > 0 && used >= m && !shown.includes(m));
    if (crossed == null) return;

    shown.push(crossed);
    await chrome.storage.local.set({ jcMeterShown: shown });
    if (tabId != null) {
      chrome.tabs
        .sendMessage(tabId, { type: "JC_METER_NOTE", used, total })
        .catch(() => {});
    }
  } catch (_) {}
}

async function hostedAsk(prompt, reqId, tabId) {
  const { key: historyKey, messages: history } = await gatewayHistory(tabId ?? "global");
  const messages = [
    { role: "system", content: GATEWAY_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: prompt },
  ];

  let response;
  try {
    response = await jcFetchBounded(HOSTED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-jc-install": await hostedInstallId(),
      },
      body: JSON.stringify({ messages, reqId }),
    });
  } catch (_) {
    return {
      ok: false,
      error:
        "JustClarify couldn't reach its own AI service. Check your connection, " +
        "or add your own AI key in the popup to answer through that instead.",
    };
  }

  if (!response.ok) {
    // The server already writes these to be shown verbatim — it deliberately
    // never forwards the upstream provider's wording.
    let detail = "";
    try {
      detail = (await response.json())?.error || "";
    } catch (_) {}

    if (response.status === 429 || response.status === 402) {
      return { ok: false, needsKey: true, error: detail || "The free allowance is used up for now." };
    }
    return {
      ok: false,
      error:
        detail ||
        `JustClarify's AI service had a problem (HTTP ${response.status}). Try again shortly.`,
    };
  }

  hostedMeterNote(response, tabId);

  const stream = await gatewayReadStream(response, (partial) =>
    hostedProgress(tabId, reqId, partial, false),
  );
  if (stream.error && !stream.answer) {
    return { ok: false, error: `The answer was cut off (${stream.error}). Try again.` };
  }

  const answer = stream.answer.trim();
  if (!answer) return { ok: false, error: "The model returned an empty answer." };

  await gatewaySaveHistory(historyKey, [
    ...history,
    { role: "user", content: prompt },
    { role: "assistant", content: answer },
  ]);

  hostedProgress(tabId, reqId, answer, true);
  return {
    ok: true,
    answer,
    thinking: "",
    url: "",
    engine: HOSTED_ENGINE,
    model: HOSTED_MODEL,
  };
}

// --- Voice I/O ---------------------------------------------------------------
// Both live here rather than in the content script because of an MV3 rule that
// is easy to forget: a content script's fetch is bound by the PAGE's CORS
// policy, so it would reach justclarify.xyz as the page's origin and be turned
// away. Only the worker carries chrome-extension://<id>.

const HOSTED_TRANSCRIBE_URL = "https://justclarify.xyz/api/transcribe";
const HOSTED_SPEAK_URL = "https://justclarify.xyz/api/speak";

// Messaging can't carry a Blob or an ArrayBuffer intact, so audio crosses the
// boundary as base64 in both directions and is rebuilt on the other side.
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  // Chunked: a single spread of a megabyte-long array blows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function hostedTranscribe(audioBase64, mimeType, context) {
  if (!audioBase64) return { ok: false, error: "No audio." };
  try {
    const blob = new Blob([base64ToBytes(audioBase64)], { type: mimeType || "audio/webm" });
    const form = new FormData();
    form.append("audio", blob, "hold.webm");
    // Words the user is looking at are words they are likely to say.
    if (context) form.append("context", String(context).slice(0, 400));

    const response = await jcFetchBounded(HOSTED_TRANSCRIBE_URL, {
      method: "POST",
      headers: { "x-jc-install": await hostedInstallId() },
      body: form,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      return { ok: false, error: detail.error || `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { ok: true, text: (data.text || "").trim() };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 120) };
  }
}

async function hostedSpeak(text) {
  const value = String(text || "").trim();
  if (!value) return { ok: false, error: "Nothing to say." };
  try {
    const response = await jcFetchBounded(HOSTED_SPEAK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-jc-install": await hostedInstallId(),
      },
      body: JSON.stringify({ text: value.slice(0, 1200) }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      return { ok: false, error: detail.error || `HTTP ${response.status}` };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) return { ok: false, error: "No audio came back." };
    return {
      ok: true,
      audioBase64: bytesToBase64(bytes),
      mimeType: response.headers.get("content-type") || "audio/mpeg",
    };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 120) };
  }
}

// --- One-shot completion ------------------------------------------------------
// The non-streaming sibling of hostedAsk, for everything that wants one short
// answer rather than prose painted into a popup: voice intent classification,
// fact-check claim extraction, verdicts.
//
// It exists so that EVERY AI feature has a path that works without the user
// owning an API key. Before it, fact-checking called the Gateway directly with
// `if (!settings) return null` — which meant the whole feature silently did
// nothing for anyone who hadn't pasted a key in.
// WHY this failure is recorded rather than swallowed: hostedComplete returns
// null for every possible failure — 429, 500, offline, DNS, empty body — and
// callers turned that single null into "you need to add an API key". So a user
// who HAD a working key, and had simply asked enough questions in a row to be
// rate limited, was told their key wasn't connected. It was. Reported verbatim
// by the user: "it says my API is not connected, though it is connected... it
// does it after it has asked some questions, like it's overwhelmed".
//
// One shared slot is enough: these calls are short and the reason is read
// immediately after the null comes back.
let hostedLastFailure = null;

function hostedFailure() {
  return hostedLastFailure;
}

// Turn whatever went wrong into something true enough to show a person. Only
// the cases that are ACTUALLY about credentials or allowance may say so.
function hostedFailureMessage(fallback) {
  const f = hostedLastFailure;
  if (!f) return fallback;
  if (f.kind === "network") return "Couldn't reach JustClarify — check your connection and try again.";
  if (f.kind === "empty") return "JustClarify answered with nothing — try that again.";
  if (f.status === 429) return "That's a lot of questions at once — give it a few seconds and try again.";
  if (f.status === 402) return "You've used your free asks — $3.99/month or your own API key makes it unlimited.";
  if (f.status === 401 || f.status === 403) return fallback; // genuinely a credentials problem
  if (f.status >= 500) return "JustClarify's service is having a moment — try again shortly.";
  return `JustClarify returned HTTP ${f.status} — try again.`;
}

async function hostedComplete(messages, options = {}) {
  hostedLastFailure = null;
  try {
    const response = await jcFetchBounded(HOSTED_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-jc-install": await hostedInstallId(),
      },
      body: JSON.stringify({
        messages,
        stream: false,
        maxTokens: options.maxTokens || 700,
        json: options.json === true,
      }),
    });
    if (!response.ok) {
      hostedLastFailure = { kind: "http", status: response.status };
      return null;
    }
    hostedMeterNote(response, null);
    const data = await response.json();
    const text = (data.text || "").trim();
    if (!text) hostedLastFailure = { kind: "empty" };
    return text || null;
  } catch (_) {
    hostedLastFailure = { kind: "network" };
    return null;
  }
}

// The whole chain in one call, so no feature has to re-implement the order:
// the user's own key first when they have one, JustClarify's otherwise.
async function completeAnywhere(prompt, options = {}) {
  const settings = await providerGetSettings();
  if (settings) {
    const viaKey = await providerClassify(
      options.system || "You are a precise assistant. Follow the instructions exactly.",
      prompt,
    );
    if (viaKey) return viaKey;
  }
  const messages = options.system
    ? [{ role: "system", content: options.system }, { role: "user", content: prompt }]
    : [{ role: "user", content: prompt }];
  return hostedComplete(messages, options);
}
