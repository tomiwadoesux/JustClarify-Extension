# Scenarios

Whole situations, start to finish, rather than a feature list. Every line in
the "said" columns is a phrase the shipped grammar or verb table already
handles (`ambient-explainer-extension/commands.js`). Where a scenario leans on
a browser-wide verb, see `tabs.md` for how the tab strip half works.

---

## 1. The dense page you didn't choose to read

A nurse opens a benefits PDF the HR portal linked to. Nine paragraphs of
"coinsurance applies after the deductible is satisfied, except where §4(b)".

| Said | What runs |
| --- | --- |
| "what is this page" | `pageOverview` — the whole document as the subject, not a selection |
| "explain this" (after highlighting) | `explain` on the resolved target |
| "explain it like I'm five" | `simplify` — same target, different style |
| "give me an example" | `example` |
| "what does coinsurance mean" | `define` with the word as the argument |
| "read it to me" | `read` — speech, with `undo` wired to stop it |

The point of the scenario: **the target is resolved once and re-styled**.
Nobody re-highlights between "explain this" and "like I'm five" — reference
resolution picks the most recent thing the reader could mean, so the second
sentence names no object and still lands on the first one's text.

---

## 2. Reading with your hands somewhere else

Someone cooking, someone on a treadmill, someone with a tremor. The page is
long and the mouse is not an option.

| Said | What runs |
| --- | --- |
| "keep scrolling" | `keepScrolling` — auto-scroll at reading speed |
| "faster" / "slower" | `faster` / `slower` |
| "wait" | `waitHere` — stops and drops a mark |
| "back to where I was" | `backToMark` |
| "scroll down a bit" | `scrollABit` |
| "top" / "bottom" | `scrollToEdge` |
| "stop" | `stop` — kills speech and auto-scroll together |

This is the scenario that justifies the grammar running before any model.
"Scroll down" through an LLM is ~400ms and a fraction of a cent to decide
something a regex settles in microseconds. At auto-scroll speed, a 400ms
"faster" is a different sentence by the time it lands.

---

## 3. "Wait, is that true?"

A video is playing. The host says a number. The claim is in the audio, not on
the page, so there is nothing to highlight.

| Said | What runs |
| --- | --- |
| "is that true" | `factcheck` on the resolved target — with live listening on, the target is the last thing the tab *said* |
| "fact check this" (highlighted) | `factcheck` on the selection |
| "pause" | `pause` — the media, not the page |

The `heard` buffer exists for exactly this sentence. "That" is the video.
Without it, the most natural fact-check phrasing in the language has no
referent.

---

## 4. Eleven tabs on one subject

A grad student has been reading about a treatment for two days. Eleven tabs,
four of them the same study, one of them a forum thread.

| Said | What runs |
| --- | --- |
| "research these tabs" | `tabsResearch` — clusters, reads, returns one cited briefing |
| "research these tabs on dosage" | same, with the subject named instead of inferred |
| "find the tab where I was reading about the trial" | `tabsFind` — local scoring first, model ranking only if the words appear nowhere |
| "tidy up my tabs" | `tabsTidy` — the model invents the buckets and names them |
| "close the tabs I haven't looked at today" | `tabsCloseStale` |
| "undo" | the closed set is recreated in place |

The briefing cites. A synthesis across eleven sources that cannot be traced
back to which source said what is worse than the eleven tabs.

---

## 5. A site you have to use and don't understand

A government portal, a bank, a school system. The information is there; the
navigation is the obstacle.

| Said | What runs |
| --- | --- |
| "where do I renew my licence" | `searchSite` — the site's own search, then explained |
| "find where it says the fee" | `searchPage` |
| "click the one that says continue" | `click` — by description, not selector |
| "type my email" | `type` |
| "submit" | `submit` |
| "go back" | `back` |

Note what is *not* here: no verb navigates off the site on the model's
initiative. `site` checks the destination against the user's own words first,
and asks when it wasn't named. Leaving for a different website is the one
action where a model acting on its own and a model obeying look identical from
the outside, so it gets treated like a destructive click.

---

## 6. A second language

Someone reading in English who thinks in another language, or the reverse.

| Said | What runs |
| --- | --- |
| "translate this" | `translate` on the resolved target |
| "what does that word mean" | `define` |
| "say it again" | `read` |
| "simpler" | `simplify` |

Translation is a style over the same resolved target as everything else, which
is why "translate this, now simpler" works without re-selecting.

---

## 7. Typing instead of talking

An open-plan office, a library, a shared room. Double-tap Shift for the ask
box — the same grammar, a different mouth.

| Typed | What happens |
| --- | --- |
| "clos the githb tabs" | corrected against the grammar's own vocabulary, then run through the real rules |
| "tab" | browse mode — every tab command, as completions to keep typing into |
| anything matching nothing | the list becomes a filter over the rule set, which is the only way the rules are discoverable |

The correction runs *before* matching, and a suggestion is only offered because
the corrected sentence genuinely matched that rule. Nothing scores a rule by
resemblance and then executes something else.

---

## What ties them together

- **One target, many styles.** Explain, simplify, example, define, translate,
  fact-check and read are the same resolved reference under different
  instructions. That is why follow-ups never re-select.
- **Grammar first, model last.** The model is the fallback for phrasings the
  rules did not anticipate, never the path.
- **Voice and click share a floor.** Nearly every verb ends in the function the
  mouse already reaches, so the two input paths cannot drift apart.
- **The page chooses subjects, never actions.** It says which tabs, which text,
  which element — never what happens to them, and never by id.
