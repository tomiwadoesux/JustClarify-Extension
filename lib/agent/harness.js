// Render the design harness inside the run's sandbox, before and after the
// patch, and put both images where the board can show them.
//
// Why this works at all: layout-harness.html at the repo root renders the
// extension's REAL stylesheet and the REAL popup.html on one canvas — it is a
// visual test, not a mock-up (its own words). So a screenshot of it before the
// patch and after, from identical fixture state, differ only by the fix. That
// pair is what the board's "which one is right?" vote judges.
//
// Cost honesty: Chromium is not in the sandbox image, so the first thing this
// does is install it (~40-70s). That is why it only runs for UI-category
// patches — a wording fix has nothing to photograph. When this gets frequent,
// the upgrade is a browser-ready container image (remote-agent-browser's
// approach), which removes the install entirely; nothing here would change
// except Sandbox.create's image option.

// System libraries Chromium needs on the sandbox's Amazon Linux (from the
// documented agent-browser + Vercel Sandbox pattern).
const CHROMIUM_DEPS =
  'nss nspr libxkbcommon atk at-spi2-atk at-spi2-core libXcomposite libXdamage libXrandr ' +
  'libXfixes libXcursor libXi libXtst libXScrnSaver libXext mesa-libgbm libdrm mesa-libGL ' +
  'mesa-libEGL cups-libs alsa-lib pango cairo gtk3 dbus-libs';

export async function harnessInstallBrowser(sandbox, log) {
  await log.say('installing a browser for the before/after pictures (the slow part)');
  const deps = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', `sudo dnf install -y --skip-broken ${CHROMIUM_DEPS} >/dev/null 2>&1 && sudo ldconfig`],
    timeoutMs: 180_000,
  });
  if (deps.exitCode !== 0) return false;
  const cli = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', 'npm install -g agent-browser >/dev/null 2>&1 && agent-browser install >/dev/null 2>&1'],
    timeoutMs: 180_000,
  });
  return cli.exitCode === 0;
}

// Which harness frame a report is most likely about. Word-matching on
// purpose: it is free, deterministic, and the frames are few. Wrong guesses
// still produce a truthful pair — just of a less relevant component.
export function harnessFrameFor(reportText) {
  const text = String(reportText || '').toLowerCase();
  if (/popup|setting|toggle|switch|api key|engine|model|save/.test(text)) return 'Toolbar popup';
  if (/fact|claim|verdict|check/.test(text)) return 'Step 4 · Fact-check';
  if (/bar|action|menu|highlight/.test(text)) return 'Step 1 · The bar';
  // The ambient panel is where answers render — the most complained-about
  // surface, and the right default.
  return 'Ambient panel';
}

// One screenshot of the harness as the working tree currently stands, zoomed
// to ONE frame. The full canvas at fit-zoom renders every component at
// thumbnail size, which is useless for judging a spacing fix — the harness's
// own jump buttons centre a frame at readable scale, so we press one.
export async function harnessShoot(sandbox, repoDir, outName, frame) {
  const open = await sandbox.runCommand({
    cmd: 'agent-browser',
    args: ['open', `file://${repoDir}/layout-harness.html`],
    timeoutMs: 60_000,
  });
  if (open.exitCode !== 0) return null;

  await sandbox.runCommand({
    cmd: 'agent-browser',
    args: ['set', 'viewport', '1400', '1100'],
    timeoutMs: 30_000,
  });
  // Give the popup iframe and fonts a moment to settle — a race here shows up
  // as a half-painted "before" that the vote would wrongly blame on the code.
  await sandbox.runCommand({
    cmd: 'agent-browser',
    args: ['wait', '--load', 'networkidle'],
    timeoutMs: 30_000,
  });

  if (frame) {
    // The exact jump button, not a text search: `find text` matches the
    // frame's LABEL first (same words, earlier in the DOM), and clicking a
    // label pans nothing. The harness's focusFrame applies instantly, so no
    // settle time is needed beyond the click itself.
    const js = `(() => { for (const b of document.querySelectorAll('#jumps button')) { if (b.textContent.trim() === ${JSON.stringify(frame)}) { b.click(); return 'jumped'; } } return 'no-such-frame'; })()`;
    await sandbox
      .runCommand({ cmd: 'agent-browser', args: ['eval', js], timeoutMs: 20_000 })
      .catch(() => {});
  }

  const shot = await sandbox.runCommand({
    cmd: 'agent-browser',
    args: ['screenshot', `/tmp/${outName}.png`],
    timeoutMs: 60_000,
  });
  await sandbox.runCommand({ cmd: 'agent-browser', args: ['close'], timeoutMs: 20_000 }).catch(() => {});
  if (shot.exitCode !== 0) return null;

  const bytes = await sandbox.readFileToBuffer({ path: `/tmp/${outName}.png` });
  return bytes && bytes.length ? bytes : null;
}

// Into the same public bucket the reporters' screenshots use, under runs/.
export async function harnessUpload(runId, label, bytes) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !bytes) return null;
  const name = `runs/${runId}-${label}.png`;
  const stored = await fetch(`${url}/storage/v1/object/tellme/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: bytes,
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!stored || !stored.ok) return null;
  return `${url}/storage/v1/object/public/tellme/${name}`;
}
