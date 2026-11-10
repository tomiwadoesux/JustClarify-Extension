// Reicon outline, baked from the Iconify API so the page stays self-contained
// and offline. Each entry is the exact path Reicon publishes, not a redraw.
//
// One rule governs which icon each slot gets, and it is not just meaning:
// Reicon draws some of its outline icons as real 1.5 strokes and others as
// filled paths expanded from a 1.5 stroke. The two are nominally the same
// weight and visibly are not. Fill-expanded glyphs with closed contours (the
// open book, the chat bubble, the CPU) read as much heavier at 22px, which is
// what made the first pass look thick. Every slot below is a real stroke
// drawing except the two noted, which have no stroke version in the family and
// carry extra optical inset instead.

export const ICON_INSET = 1.1;

export const REICON = {
  explain: { n: "message-text", w: 24, h: 24, b: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M16 2H8Q2 2 2 8v13c0 .55.45 1 1 1h13q6 0 6-6V8q0-6-6-6\"/><path stroke-miterlimit=\"10\" d=\"M7 9.5h10m-10 5h7\"/></g>" },
  expand: { n: "add", w: 24, h: 24, b: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\" d=\"M6 12h12m-6 6V6\"/>" },
  define: { n: "book2", w: 24, h: 24, b: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\" d=\"M22 16.74V4.67c0-1.2-.98-2.09-2.17-1.99h-.06c-2.1.18-5.29 1.25-7.07 2.37l-.17.11c-.29.18-.77.18-1.06 0l-.25-.15C9.44 3.9 6.26 2.84 4.16 2.67C2.97 2.57 2 3.47 2 4.66v12.08c0 .96.78 1.86 1.74 1.98l.29.04c2.17.29 5.52 1.39 7.44 2.44l.04.02c.27.15.7.15.96 0c1.92-1.06 5.28-2.17 7.46-2.46l.33-.04c.96-.12 1.74-1.02 1.74-1.98M12 5.49v15m-4.25-12H5.5m3 3h-3\"/>" },
  factcheck: { n: "verify", w: 24, h: 24, b: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"m8.38 12l2.41 2.42l4.83-4.84\"/><path d=\"M10.75 2.45c.69-.59 1.82-.59 2.52 0l1.58 1.36c.3.26.86.47 1.26.47h1.7c1.06 0 1.93.87 1.93 1.93v1.7c0 .39.21.96.47 1.26l1.36 1.58c.59.69.59 1.82 0 2.52l-1.36 1.58c-.26.3-.47.86-.47 1.26v1.7c0 1.06-.87 1.93-1.93 1.93h-1.7c-.39 0-.96.21-1.26.47l-1.58 1.36c-.69.59-1.82.59-2.52 0l-1.58-1.36c-.3-.26-.86-.47-1.26-.47H6.18c-1.06 0-1.93-.87-1.93-1.93V16.1c0-.39-.21-.95-.46-1.25l-1.35-1.59c-.58-.69-.58-1.81 0-2.5l1.35-1.59c.25-.3.46-.86.46-1.25V6.2c0-1.06.87-1.93 1.93-1.93h1.73c.39 0 .96-.21 1.26-.47z\"/></g>" },
  textarea: { n: "note-text", w: 24, h: 24, b: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-miterlimit=\"10\" stroke-width=\"1.5\" d=\"M8 2v3m8-3v3m5 3.5V17c0 3-1.5 5-5 5H8c-3.5 0-5-2-5-5V8.5c0-3 1.5-5 5-5h8c3.5 0 5 2 5 5M8 11h8m-8 5h4\"/>" },
  translate: { n: "global", w: 24, h: 24, b: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10\"/><path d=\"M8 3h1a28.42 28.42 0 0 0 0 18H8m7-18a28.42 28.42 0 0 1 0 18\"/><path d=\"M3 16v-1a28.42 28.42 0 0 0 18 0v1M3 9a28.42 28.42 0 0 1 18 0\"/></g>" },
  summarize: { n: "text-block", w: 24, h: 24, b: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M9 22h6c5 0 7-2 7-7V9c0-5-2-7-7-7H9C4 2 2 4 2 9v6c0 5 2 7 7 7\"/><path d=\"M7 8.89c3.15-1.57 6.85-1.57 10 0m-5 7.41V7.93\"/></g>" },
  example: { n: "lightbulb", w: 24, h: 24, b: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\" d=\"M12 1v1.333m7.779 1.888l-.943.943M23 12h-1.333M4.221 4.221l.943.943M1 12h1.333m16 0a6.34 6.34 0 0 0-7.704-6.19c-2.496.525-4.468 2.612-4.876 5.13a6.33 6.33 0 0 0 3.914 6.936v2.457a2 2 0 0 0 2 2h.666a2 2 0 0 0 2-2v-2.457c2.34-.93 4-3.204 4-5.876m-9.137 5.667h5.608\"/>" },
  humanize: { n: "emoji-normal", w: 24, h: 24, b: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M9 22h6c5 0 7-2 7-7V9c0-5-2-7-7-7H9C4 2 2 4 2 9v6c0 5 2 7 7 7\"/><path stroke-miterlimit=\"10\" d=\"M7 8.25c1 1 2.63 1 3.64 0m2.72 0c1 1 2.63 1 3.64 0M8.4 13h7.2c.5 0 .9.4.9.9c0 2.49-2.01 4.5-4.5 4.5s-4.5-2.01-4.5-4.5c0-.5.4-.9.9-.9\"/></g>" },
  shorten: { n: "scale", w: 24, h: 24, pad: 2.6, b: "<g fill=\"currentColor\"><path d=\"M11.001 2.75A.75.75 0 0 0 11 1.25c-2.016.004-3.622.029-4.898.235c-1.3.21-2.338.62-3.167 1.449c-.895.894-1.3 2.034-1.494 3.48c-.19 1.41-.19 3.22-.19 5.528v.115c0 2.308 0 4.117.19 5.529c.194 1.445.6 2.585 1.494 3.48c.895.894 2.035 1.3 3.48 1.494c1.411.19 3.22.19 5.529.19h.114c2.309 0 4.118 0 5.53-.19c1.444-.195 2.584-.6 3.479-1.495c.828-.828 1.238-1.867 1.448-3.166c.207-1.277.232-2.883.235-4.898a.75.75 0 1 0-1.5-.003c-.003 2.04-.031 3.523-.216 4.661c-.18 1.116-.5 1.817-1.028 2.346c-.57.57-1.34.896-2.619 1.068c-1.3.175-3.008.176-5.386.176s-4.086-.001-5.386-.176c-1.279-.172-2.05-.499-2.62-1.068c-.569-.57-.896-1.34-1.068-2.62c-.174-1.3-.176-3.007-.176-5.386s.002-4.086.176-5.386c.172-1.278.5-2.05 1.069-2.619c.528-.528 1.23-.847 2.345-1.028c1.138-.184 2.621-.212 4.661-.216\"/><path d=\"M15.906 2c0 .414.336.75.75.75h3.533l-7.439 7.44V8a.75.75 0 0 0-1.5 0v4c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-2.19l7.44-7.44v3.534a.75.75 0 0 0 1.5 0V2a.75.75 0 0 0-.75-.75h-5.344a.75.75 0 0 0-.75.75\"/></g>" },
  ondevice: { n: "cpu3", w: 24, h: 24, b: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M9.6 20h4.8c4 0 5.6-1.6 5.6-5.6V9.6c0-4-1.6-5.6-5.6-5.6H9.6C5.6 4 4 5.6 4 9.6v4.8c0 4 1.6 5.6 5.6 5.6\"/><path d=\"M10.5 17h3c2.5 0 3.5-1 3.5-3.5v-3C17 8 16 7 13.5 7h-3C8 7 7 8 7 10.5v3C7 16 8 17 10.5 17M8.01 4V2M12 4V2m4 2V2m4 6h2m-2 4h2m-2 4h2m-6 4v2m-3.99-2v2m-4-2v2M2 8h2m-2 4h2m-2 4h2\"/></g>" },
  copy: { n: "files", w: 24, h: 24, b: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M8.333 14.333h-4A1.334 1.334 0 0 1 3 13V3.667c0-.736.597-1.334 1.333-1.334h5.334L12.333 5v1.333\"/><path d=\"M9 2.333V5h2.667M21 12.333v8c0 .736-.597 1.334-1.333 1.334H13a1.334 1.334 0 0 1-1.333-1.334V11c0-.736.597-1.333 1.333-1.333h5.333z\"/><path d=\"M18.333 9.667v2.666H21\"/></g>" },
  download: { n: "import2", w: 24, h: 24, b: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"m22 2l-8.2 8.2M13 6.17V11h4.83\"/><path d=\"M11 2H9C4 2 2 4 2 9v6c0 5 2 7 7 7h6c5 0 7-2 7-7v-2\"/></g>" },
  alignJustify: { n: "menu2", w: 24, h: 24, b: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-miterlimit=\"10\" stroke-width=\"1.5\" d=\"M17.54 8.31a2.46 2.46 0 1 0 0-4.92a2.46 2.46 0 0 0 0 4.92m-11.08 0a2.46 2.46 0 1 0 0-4.92a2.46 2.46 0 0 0 0 4.92m11.08 12.3a2.46 2.46 0 1 0 0-4.92a2.46 2.46 0 0 0 0 4.92m-11.08 0a2.46 2.46 0 1 0 0-4.92a2.46 2.46 0 0 0 0 4.92\"/>" },
  alignLeft: { n: "align-left3", w: 24, h: 24, b: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\" d=\"M5.1 19.25h11.8c1.5 0 2.1-.64 2.1-2.23v-1.04c0-1.59-.6-2.23-2.1-2.23H5.1m0-8.5h6.8c1.5 0 2.1.64 2.1 2.23v1.04c0 1.59-.6 2.23-2.1 2.23H5.1M5 1.99v20\"/>" },
  alignCenter: { n: "align-3-horizontal", w: 24, h: 24, b: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><rect width=\"6\" height=\"16.667\" x=\"9\" y=\"9\" rx=\"2\" ry=\"2\" transform=\"rotate(-90 12 17.333)\"/><rect width=\"6\" height=\"8.667\" x=\"9\" y=\"2.333\" rx=\"2\" ry=\"2\" transform=\"rotate(-90 12 6.667)\"/></g>" },
  alignRight: { n: "align-right3", w: 24, h: 24, b: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\" d=\"M18.9 19.25H7.1c-1.5 0-2.1-.64-2.1-2.23v-1.04c0-1.59.6-2.23 2.1-2.23h11.8m0-8.5h-6.8c-1.5 0-2.1.64-2.1 2.23v1.04c0 1.59.6 2.23 2.1 2.23h6.8m.1-8.76v20\"/>" },
  expandFull: { n: "maximize2", w: 24, h: 24, b: "<g fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\"><path d=\"M2 9.98V9c0-5 2-7 7-7h6c5 0 7 2 7 7v6c0 5-2 7-7 7h-1\"/><path d=\"m13 11l5.01-5.02H14m4.01 0v4.01M11 16.15v2.7C11 21.1 10.1 22 7.85 22h-2.7C2.9 22 2 21.1 2 18.85v-2.7C2 13.9 2.9 13 5.15 13h2.7c2.25 0 3.15.9 3.15 3.15\"/></g>" },
  contract: { n: "minimize", w: 24, h: 24, pad: 2.6, b: "<path fill=\"currentColor\" d=\"M20.857 9.75a.75.75 0 1 0 0-1.5h-4.046l5.72-5.72a.75.75 0 0 0-1.061-1.06l-5.72 5.72V3.142a.75.75 0 0 0-1.5 0V9c0 .414.336.75.75.75zm-17.714 4.5a.75.75 0 0 0 0 1.5h4.046l-5.72 5.72a.75.75 0 1 0 1.061 1.06l5.72-5.72v4.047a.75.75 0 1 0 1.5 0V15a.75.75 0 0 0-.75-.75z\"/>" },
  minimize: { n: "minus3", w: 24, h: 24, b: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"1.5\" d=\"M6 12h12\"/>" },
  close: { n: "x", w: 24, h: 24, b: "<path fill=\"currentColor\" d=\"M18.47 19.53a.75.75 0 1 0 1.06-1.06L13.06 12l6.47-6.47a.75.75 0 0 0-1.06-1.06L12 10.94L5.53 4.47a.75.75 0 0 0-1.06 1.06L10.94 12l-6.47 6.47a.75.75 0 1 0 1.06 1.06L12 13.06z\"/>" },
  chevronLeft: { n: "arrow-left2", w: 24, h: 24, b: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-miterlimit=\"10\" stroke-width=\"1.5\" d=\"M15 19.92L8.48 13.4c-.77-.77-.77-2.03 0-2.8L15 4.08\"/>" },
  chevronRight: { n: "arrow-right2", w: 24, h: 24, b: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-miterlimit=\"10\" stroke-width=\"1.5\" d=\"m8.91 19.92l6.52-6.52c.77-.77.77-2.03 0-2.8L8.91 4.08\"/>" },
};

// What each action actually does, and therefore what its icon has to say.
// The "was" column is the pick this replaced and why it was the wrong word or
// the wrong weight.
export const SLOT_MEANING = [
  ["explain", "Rewrite the selection in plain language", "a speech bubble with lines: someone telling you what it means", "a magnifying glass, which says search"],
  ["expand", "Pull the wider passage and answer at length", "a bare plus: more of what is already there", "resize arrows, which says window control"],
  ["define", "Dictionary lookup on a single word", "an open book", "the fill-expanded book, whose double contour read as a solid block"],
  ["factcheck", "Run the evidence pipeline and return a verdict", "a badge with a check: something was certified", "a bare double check, which says read, not verified"],
  ["textarea", "Open the scratch editor over the page", "a page with text lines: a surface you write on", "a full notepad, the busiest drawing in the set"],
  ["translate", "Translate the selection into a language", "a globe, since Reicon ships no translate glyph", "unchanged"],
  ["summarize", "Compress a long selection to its gist", "a block of short lines", "a list with a resize arrow beside it, which said sort"],
  ["example", "Give one vivid real-world example", "a lightbulb", "nothing at all: the slot had no icon and fell back to explain"],
  ["humanize", "Rewrite machine prose to sound human", "a face", "a user silhouette, which says account"],
  ["shorten", "Make the text shorter without losing meaning", "a scale: the same thing, smaller", "no stroke drawing exists, so this one is inset further to match"],
  ["ondevice", "The local model, downloading or running", "a CPU", "the fill-expanded CPU, dense enough to smear at 15px"],
  ["copy", "Copy the result", "two stacked sheets", "unchanged"],
  ["download", "Save the result to a file", "an arrow into a container", "unchanged"],
  ["alignJustify", "Justify the editor text", "four equal-length lines", "compromise: Reicon has no text-align family"],
  ["alignLeft", "Left-align the editor text", "lines pushed to a left rail", "compromise: object alignment doing a text job"],
  ["alignCenter", "Centre the editor text", "lines pushed to a centre rail", "compromise: object alignment doing a text job"],
  ["alignRight", "Right-align the editor text", "lines pushed to a right rail", "compromise: object alignment doing a text job"],
  ["expandFull", "Grow the text area to full screen", "corners pushing outward", "unchanged"],
  ["contract", "Return the text area to its default size", "corners pulling inward", "no stroke drawing exists, so this one is inset further to match"],
  ["minimize", "Collapse the text area to its bubble", "a bare minus", "a boxed minus, heavier than the action beside it"],
  ["close", "Dismiss the surface", "a bare x", "a boxed x, louder than dismissing deserves"],
  ["chevronLeft", "Previous page of actions", "a chevron pointing left", "unchanged"],
  ["chevronRight", "Next page of actions", "a chevron pointing right", "unchanged"],
];
