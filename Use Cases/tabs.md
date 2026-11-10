# Browser-level use cases: the tab strip

What Just Clarify can do to the *browser itself*, rather than inside a single
website. All of it rides permissions the extension already holds (`tabs`,
`tabGroups`, `history`, `sessions`, `scripting`, `<all_urls>`), so none of it
adds an install warning.

Built in `ambient-explainer-extension/background.js` (`JC_VOICE_TABS`) and
`ambient-explainer-extension/commands.js` (grammar + `tabs*` verbs).
Covered by `ambient-explainer-extension/tests/tab-strip.mjs`.

## The shape

The older tab verbs act on ONE tab, named directly, almost always the active
one: `new`, `close`, `next`, `prev`, `duplicate`, `pin`, `mute`, `closeOthers`,
`detach`, `zoom`, `reopen`. Adding a command meant adding a `case`.

These act on a SET, chosen by a description. A predicate plus a verb:

    "close the tabs I haven't looked at today"
     ^ verb              ^ predicate

One message type carries all of them. The caller says which tabs; the fixed
action list says what happens to them.

## Shipped

| Said out loud | What runs |
| --- | --- |
| "find the tab where I was reading about MCP" | `find` — local title/host/url scoring, model ranking when the words appear nowhere |
| "close the tabs I haven't looked at today" | `close` with `staleHours`, from `tab.lastAccessed` |
| "close the GitHub tabs" | `close` with a query |
| "close old tabs" | `close` with a 12 hour default |
| "group my AI tabs" | `group` — one named group from a filter |
| "tidy up my tabs" / "organize my tabs" | `autoGroup` — the model invents the buckets and names them |
| "ungroup my tabs" | `ungroup` |
| "mute the tab that's playing audio" | `mute` on `audible: true` |
| "which tab is playing audio" | `find` on `audible: true` |
| "unmute all tabs" | `unmute` |
| "move the GitHub tabs to a new window" | `toWindow` |
| "reopen my last five closed tabs" | `reopen` with a count, oldest first |
| "how many tabs do I have" | `list` |
| "what tab is using the most memory" | `list`, answered from a weighting heuristic |
| "free up some memory" | `discardHeavy` — sleeps tabs instead of closing them |
| "undo" after a bulk close | the closed set is remembered and recreated in place |

Spoken numbers are handled ("reopen my last five tabs"), and so are the vague
time words: today, in a while, since yesterday, a few hours, last week.

## Keeping page tabs and browser tabs apart

This was the real design problem. A web page can contain something called a tab.
"The Billing tab" is a control on the page; "my billing tabs" is the browser.
Both are reached by sentences starting with the same three words.

The rule the code holds:

| Phrasing | Reading |
| --- | --- |
| singular, plus a name | the page — click, jump, or search |
| plural | the tab strip |
| singular, plus a property only the browser knows | the tab strip |

"Playing audio", "haven't used today", "closed", "pinned", "in this window" are
properties no page control has. That is why they are safe to claim.

Three things enforce it:

1. **Rule order.** The tab-strip rules sit above the semantic jump rule, because
   that rule owns "find" and "go to" and would otherwise read "find the tab
   where I was reading about MCP" as a search for that phrase inside the page.
   They are all plural or property-based, so they cannot swallow a page phrase.
2. **The ambiguous one is left to the page.** "Switch to the settings tab" sits
   *below* every page rule. Reaching it means the page search, the semantic jump
   and click-by-description all declined, so the tab strip is what is left.
3. **Plural verb names, plus a prompt rule.** The model reads a page snapshot
   next to the verb list. A verb called `closeTab` beside a snapshot element
   labelled "Billing tab" is an invitation to confuse them, so every browser-wide
   verb is plural (`tabsClose`, `tabsFind`, `tabsGroup`) and the system prompt
   states the distinction outright.

The test file asserts both directions. "Click the billing tab" and "go to the
pricing tab" must stay on the page; "close the github tabs" and "mute the tab
that's playing audio" must reach the strip.

## Safety rails

- A bulk close never touches a pinned tab or the tab you are looking at.
- The closed set is held in the worker so undo can put it back in place, which
  `chrome.sessions` cannot do for a set.
- The page picks which tabs, never what happens to them, and never by id.
- Only http(s) tabs are ever selected. A `chrome://` page is not what someone
  means by "my tabs" and half of them cannot be grouped or restored anyway.
- Every filter field a page can send is clamped before it is used.
- A model asked to rank tabs sometimes returns all of them to be helpful.
  Everything is not an answer, and for a destructive verb it is a dangerous one,
  so the ranking is capped.

## Not built, needs one new permission each

Both show an install warning, so they belong behind an opt-in toggle rather than
in the base manifest.

| Example | Permission |
| --- | --- |
| "save every tab in this window as bookmarks" | `bookmarks` |
| "download the files from the tabs I have open" | `downloads` |
| "clear the cookies for this site" | `browsingData` |

## Out of reach

| Example | Why |
| --- | --- |
| "open DevTools and check this error" | needs `debugger`, which puts a permanent "is debugging this browser" banner on the window |
| "change my search engine / startup page" | no extension API exists |
| "switch browser profiles" | no extension API exists |
| "turn off notifications for this site" | `contentSettings` is read-only under MV3 |
| exact per-tab memory | `chrome.processes` is dev-channel only, hence the heuristic |
