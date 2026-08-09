# Provider marks

Drop a vendor's own logo here as `<slug>.svg` and the ambient panel's answer
card picks it up automatically — no code change. Until a file exists for a
slug, the card shows a lettered tile in that vendor's colour instead.

MANIFEST: adding the first SVG here means putting the `web_accessible_resources`
block back, or a content script can't load the file:

    "web_accessible_resources": [
      { "resources": ["icons/providers/*.svg"], "matches": ["<all_urls>"] }
    ]

It was removed because this directory ships empty, and a resources pattern that
matches no file is the likeliest reason the store's automated install test
rejected v0.6.0.

The slug is the part of the Gateway model id before the `/`
(`anthropic/claude-sonnet-4.5` → `anthropic`), plus `chrome` for Chrome's
built-in on-device model. Slugs the panel knows colours for:

    chrome  openai  anthropic  google  meta  mistral
    deepseek  alibaba  xai  cohere  perplexity

Square SVGs, ideally with a transparent background — they render at 20×20 with
`object-fit: contain`.

Use each vendor's official file from their own brand/press page rather than a
redrawn copy: the marks are trademarks, and showing them here is attribution of
which model produced an answer, so they should be the real thing, unmodified.
