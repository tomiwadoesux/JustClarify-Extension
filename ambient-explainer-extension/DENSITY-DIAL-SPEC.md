# JustClarify — Density Dial (Collapse + Expand) build spec

> Status: **design, not implemented.** This is the agreed behavior + architecture
> to build against. Confirmed with the user (answers A–D below).

## One-liner

Turn JustClarify from "explain in a popup" into a **density dial for any web page**:
highlight your point of interest, then **Collapse** the surrounding context to save
space, or **Expand** the highlight itself to understand it better — both rendered
*in place* on the page, both reversible.

Collapse = **less** (hide surrounding context). Expand = **more** (elaborate the
highlight). They are not inverses of the same text — they are two directions of one
density control.

## Confirmed behavior (A–D)

- **A.** "Context around" = the **semantic span** Hugging Face identifies (the
  neighboring content that belongs to the highlight's point), not a fixed paragraph.
- **B.** Expand **inserts** the elaboration next to the highlight; the original text
  stays and the insertion is removable.
- **C.** Engine split: **Hugging Face = collapse/understanding** (fast, no chat);
  **browser LLM tab = expand** (rich). Both actions reversible.
- **D.** Collapsed regions show a **one-line gist** next to the arrow (HF already
  read the folded text), so you know what's hidden without un-collapsing.

## Two engines, by job

| Job | Engine | Path | Why |
|---|---|---|---|
| Understand + plan the collapse | **Hugging Face** | content.js → existing FastAPI backend (`call_huggingface`) → new `/collapse-plan` endpoint | One API round-trip (~hundreds of ms) = feels instant; token stays server-side. |
| Expand / clarify / ELI5 | **Browser LLM tab** | content.js → background → provider agent (`chatgpt-agent.js`, later `claude`/`gemini`) | Uses the user's subscription (free), higher quality, slower is fine here. |

The HF token must NOT live in the extension. Reuse the existing backend
(`ambient-explainer-backend`) and add one endpoint — same pattern as `/explain`.

## Collapse — detailed design

**Trigger:** highlight the text to keep in focus → blob → click → **Collapse**.

**1. Gather candidate blocks (content.js).** Find the highlight's containing block,
then collect its neighboring block-level siblings (prev/next paragraphs within the
same section). Give each a stable id and its text.

**2. Plan via Hugging Face (`POST /collapse-plan`).**
- Request: `{ highlighted_text, blocks: [{id, text}] }`
- HF returns strict JSON (reuse `extract_json`): which neighboring blocks are
  *foldable context* vs *keep*, plus a 3–6 word gist per folded block:
  `{ fold: [{id, gist}], keep: [id, ...] }`
- Index/id-based mapping (not fuzzy text matching) is what makes model→DOM reliable.

**3. Fold in place (content.js DOM layer).** For each `fold` block: **hide, don't
destroy** — wrap/flag the original with `display:none` and insert a thin **marker
bar** in its place: `▸  <gist>` with a **red rectangle outline / left border** so
it's findable when scrolling. Result on a long article:

```
▸ context: funding history (3 sentences)      ← folded, red marker, click to open
[ your highlighted paragraph — fully visible ]
▸ context: regulatory pushback                 ← folded
```

**4. Restore.** Clicking the arrow toggles the original block's `display` back. No
data loss because nothing was removed.

**v1 scope cut:** operate at the **block level** (fold neighboring paragraphs).
Folding individual sentences *inside* the highlight's own paragraph needs text-node
splitting and is **v2** — block-level is the difference between shippable and a DOM
nightmare. State this to the user; it's a deliberate simplification of "A".

## Expand — detailed design

**Trigger:** highlight text to elaborate → blob → click → **Expand** → choose
*Clearer* or *ELI5*.

**1. Ask the browser LLM** (existing agent infra). Prompt includes the highlight +
surrounding text + mode, asking for an elaboration in a voice and length that fit
inline. Streams back (existing `CLAUDE_PROGRESS` channel).

**2. Insert in place.** Add the elaboration in a wrapper right after the selection:
- **Typography matched** to the highlight's computed styles (font, size, color) so
  it blends.
- **Colored background** marker so it's clearly AI-added.
- A small ✕ / toggle to remove it (reversible per B).

## DOM editing principles (the hard part)

1. **Hide, never destroy.** All collapse/expand mutations are reversible because we
   only toggle visibility or add removable wrappers — originals are never deleted.
2. **Restrict v1 to clean selections** (within a single block). Degrade gracefully
   (fall back to popup-only) on selections spanning wild DOM.
3. **Anchor markers in flow** so they ride the scroll naturally; the red outline is
   the "don't miss it" cue.
4. **Persistence:** v1 is **session-only** (until reload). v2 = persist per-URL via
   `chrome.storage` with text-quote/XPath anchors.
5. **SPA risk:** React/Vue pages may re-render and wipe injected DOM. v1 targets
   static/article pages; note the limitation.

## Multi-provider + tab group

- Engine tabs (ChatGPT today; Claude, Gemini next) live in an extension-made
  **tab group** ("JustClarify") in the background — needs the `tabGroups` permission
  plus `tabs.group()`.
- A **provider registry** in background maps an open engine tab → its agent. Each
  agent exposes the same `ask(prompt, reqId)` contract; only SELECTORS + insertion
  differ. `claude-agent.js` / `chatgpt-agent.js` already follow this shape.
- Engine runs in **temporary-chat mode** so speculative/expand calls don't pollute
  history.

## On the Vercel AI SDK

Free + open-source (true), but it targets Node/React backends, not content scripts,
and still needs a paid/limited inference provider behind it. For "connect to Hugging
Face," calling the **HF Inference API from the existing FastAPI backend** is simpler
and keeps the token server-side. Only reach for the Vercel SDK if everything gets
routed through the Next.js app.

## Phased build plan

- **Phase 1 — Collapse (block-level), the demoable core.**
  Action menu in the popup → gather neighbor blocks → `/collapse-plan` (HF) → fold
  with marker + gist → click to restore. Session-only.
- **Phase 2 — Expand (inline).**
  Wire the existing agent → insert blended elaboration with colored bg + remove.
- **Phase 3 — Multi-provider + tab group.**
  `tabGroups`, provider registry, add `gemini-agent.js`.
- **Phase 4 — Polish/robustness.**
  Sentence-level folding (v2), per-URL persistence, SPA resilience, scroll-rail
  minimap of markers.

## Backend change needed

New endpoint in `ambient-explainer-backend/app/main.py`, mirroring `/explain`:
`POST /collapse-plan` → builds a prompt from `{highlighted_text, blocks}` → calls
`call_huggingface` → returns `{fold:[{id,gist}], keep:[...]}` via `extract_json`.

## Open question for the build

- **Provider to start:** Phase 1–2 on **ChatGPT only** (current engine), add
  Claude/Gemini in Phase 3 — assumed yes unless you want all three wired now.
