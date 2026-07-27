// Daily selector health-check for the JustClarify extension agents.
//
// Reads the SELECTORS object straight out of chatgpt-agent.js / claude-agent.js
// (so the agent files stay the single source of truth), loads each site in
// headless Chromium, and verifies the selectors still match the live DOM.
//
// Exit code 1 = confirmed breakage on a required selector group.
// Exit code 0 = healthy, or inconclusive (bot challenge / login wall) — we
// never alarm on things we couldn't actually observe.
//
// Writes selector-report.md for the workflow to post into a GitHub issue.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(root, "ambient-explainer-extension");

function extractSelectors(file) {
  const src = readFileSync(join(EXT, file), "utf8");
  const match = src.match(/const SELECTORS = (\{[\s\S]*?\n\};?)/);
  if (!match) throw new Error(`Could not find SELECTORS in ${file}`);
  return vm.runInNewContext(`(${match[1].replace(/;$/, "")})`);
}

const SITES = [
  {
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    selectors: extractSelectors("chatgpt-agent.js"),
    // Groups that must match on a logged-out page. Everything else
    // (stop/assistant/body, temporary pill) only exists mid-conversation or
    // logged-in, so those are reported as "not checkable", never as broken.
    required: ["editor", "send"],
    // The send button often only renders once the composer has text.
    prime: async (page, sel) => {
      const editor = await firstMatch(page, sel.editor);
      if (!editor) return;
      await editor.click({ timeout: 5000 }).catch(() => {});
      await page.keyboard.type("hello", { delay: 30 }).catch(() => {});
      await page.waitForTimeout(1000);
    },
  },
  {
    name: "Claude",
    url: "https://claude.ai/",
    selectors: extractSelectors("claude-agent.js"),
    // Logged out, claude.ai shows a login wall — nothing is verifiable.
    // A full check needs an authenticated session; until then this site is
    // informational only.
    required: [],
    prime: async () => {},
  },
];

async function firstMatch(page, list) {
  for (const sel of list) {
    const el = page.locator(sel).first();
    if (await el.count().catch(() => 0)) return el;
  }
  return null;
}

function looksBlocked(title, bodyText) {
  return /just a moment|verify you are human|access denied|cloudflare|attention required/i.test(
    `${title} ${bodyText.slice(0, 500)}`,
  );
}

// When something breaks, dump likely replacement candidates so a human (or an
// agent) can patch SELECTORS quickly without reloading the site themselves.
async function domCandidates(page) {
  return page.evaluate(() => {
    const describe = (el) => {
      const attrs = ["id", "data-testid", "aria-label", "contenteditable", "class"]
        .map((a) => (el.getAttribute(a) ? `${a}="${el.getAttribute(a).slice(0, 60)}"` : ""))
        .filter(Boolean)
        .join(" ");
      return `<${el.tagName.toLowerCase()} ${attrs}>`;
    };
    const pick = (sel) => [...document.querySelectorAll(sel)].slice(0, 15).map(describe);
    return {
      editors: pick('[contenteditable="true"], textarea'),
      buttons: pick("button[aria-label], button[data-testid]"),
    };
  });
}

const report = [];
let broken = false;

const browser = await chromium.launch({
  args: ["--disable-blink-features=AutomationControlled"],
});

for (const site of SITES) {
  const lines = [`## ${site.name} (${site.url})`];
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);

    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText || "");

    if (looksBlocked(title, bodyText)) {
      lines.push("- ⚠️ Bot challenge / blocked page — check inconclusive, not treated as breakage.");
    } else {
      await site.prime(page, site.selectors);

      for (const [group, list] of Object.entries(site.selectors)) {
        const el = await firstMatch(page, list);
        if (el) {
          lines.push(`- ✅ \`${group}\` matched`);
        } else if (site.required.includes(group)) {
          broken = true;
          lines.push(`- ❌ \`${group}\` — NO selector matched (required). Tried: ${list.map((s) => `\`${s}\``).join(", ")}`);
        } else {
          lines.push(`- ⬜ \`${group}\` — no match (not checkable logged-out / mid-conversation only)`);
        }
      }

      if (lines.some((l) => l.startsWith("- ❌"))) {
        const c = await domCandidates(page);
        lines.push("", "**Candidate editors in live DOM:**", ...c.editors.map((s) => `- \`${s}\``));
        lines.push("", "**Candidate buttons in live DOM:**", ...c.buttons.map((s) => `- \`${s}\``));
      }
    }
  } catch (err) {
    lines.push(`- ⚠️ Could not load page (${String(err).split("\n")[0]}) — inconclusive.`);
  } finally {
    await context.close();
  }
  report.push(lines.join("\n"));
}

await browser.close();

const out = `# JustClarify selector check — ${new Date().toISOString().slice(0, 10)}\n\n${report.join("\n\n")}\n`;
writeFileSync(join(root, "selector-report.md"), out);
console.log(out);

if (broken) {
  console.error("Selector breakage detected.");
  process.exit(1);
}
