// What the agent is allowed to be, per category of report.
//
// This file is the safety rail, and it is deliberately the smallest, dullest,
// most readable thing in the agent stack: everything else can be clever, this
// cannot. Two independent mechanisms live here.
//
//   1. CATEGORY -> AUTONOMY. A wording fix and a change to how keys are handled
//      are not the same risk and must not get the same freedom. Category is
//      decided by a model, so it is treated as a hint, never as permission.
//
//   2. FORBIDDEN PATHS. A hard list the agent may never write to, enforced in
//      code AFTER the model has spoken, so no amount of clever prompting can
//      talk its way past it. These are the files where a plausible-looking
//      diff is most dangerous: the ones that decide what the extension is
//      permitted to do, who may call the API, and what we promise users.
//
// Nothing here is the last line of defence. The agent only ever opens a pull
// request; a human merges. This exists so that the human is never reviewing a
// diff that should not have been written in the first place.

export const CATEGORIES = {
  copy: {
    label: 'Wording',
    autonomy: 'patch',
    blurb: 'Text a person reads. Lowest risk, cheapest to revert.',
  },
  ui: {
    label: 'Look and layout',
    autonomy: 'patch',
    // Visual changes cannot be judged from a diff, which is exactly where the
    // community verification vote earns its keep.
    needsPreview: true,
    blurb: 'Styling, spacing, layout. Judge it from a preview, not a diff.',
  },
  logic: {
    label: 'Behaviour',
    autonomy: 'patch',
    needsTests: true,
    blurb: 'How something works. A patch must keep the test suite green.',
  },
  sensitive: {
    label: 'Sensitive',
    autonomy: 'diagnose',
    blurb:
      'Permissions, keys, privacy, billing, the API gate. The agent may explain what it found. It may not write code.',
  },
  unclear: {
    label: 'Needs a human first',
    autonomy: 'diagnose',
    blurb: 'Not reproducible or not understood well enough to touch code.',
  },
};

// Written to, never. Matched against repo-relative paths.
//
// Every entry is here because a convincing-looking diff to it could hurt users
// even after review: the manifest decides what the extension may do to every
// page you visit, api-guard decides who may spend our model budget, the admin
// route is the lock on this whole system, and the privacy policy is a promise
// rather than code.
export const FORBIDDEN_PATHS = [
  'ambient-explainer-extension/manifest.json',
  'lib/api-guard.js',
  'lib/agent/policy.js', // it may not rewrite its own rules
  'app/api/tellme/admin/route.js',
  'app/privacy-policy/',
  'PRIVACY_POLICY.md',
  'scripts/package-extension.sh',
  '.github/',
  '.env',
  'package.json',
  'package-lock.json',
];

// Anything outside these roots is out of scope even when it is not forbidden:
// build output, dependencies and local caches are not the agent's business and
// a diff touching them is a bug in the agent, not a contribution.
export const WRITABLE_ROOTS = [
  'ambient-explainer-extension/',
  'app/',
  'components/',
  'lib/',
];

export function pathAllowed(path) {
  const clean = String(path || '').replace(/^\.\//, '').trim();
  if (!clean || clean.includes('..')) return { ok: false, why: 'path escapes the repo' };
  if (clean.startsWith('/')) return { ok: false, why: 'absolute paths are not repo paths' };
  for (const forbidden of FORBIDDEN_PATHS) {
    const hit = forbidden.endsWith('/') ? clean.startsWith(forbidden) : clean === forbidden;
    if (hit) return { ok: false, why: `${forbidden} is off limits to the agent` };
  }
  if (!WRITABLE_ROOTS.some((root) => clean.startsWith(root))) {
    return { ok: false, why: 'outside the parts of the repo the agent may edit' };
  }
  return { ok: true, why: '' };
}

// A patch that only touches the extension can be checked without installing a
// single dependency: the test suite is plain node and syntax is checkable with
// `node --check`. A patch that touches the site needs npm install and a real
// Next build. Knowing which one we are in is the difference between a run that
// finishes inside the function's time budget and one that does not.
export function verificationPlan(paths) {
  const touchesSite = paths.some(
    (p) => p.startsWith('app/') || p.startsWith('components/') || p.startsWith('lib/'),
  );
  return { needsInstall: touchesSite, needsNextBuild: touchesSite };
}

// Where a finished fix actually lands, which is a different question from how
// to verify it: a site fix reaches users minutes after merge, but an extension
// fix reaches nobody until a new version is packaged, uploaded and clears the
// store review. The board uses this to decide when "did this fix it?" is a
// fair question to ask.
export function fixTargetOf(paths) {
  const ext = paths.some((p) => p.startsWith('ambient-explainer-extension/'));
  const site = paths.some((p) => !p.startsWith('ambient-explainer-extension/'));
  if (ext && site) return 'mixed';
  return ext ? 'extension' : 'site';
}

export function categoryOf(name) {
  return CATEGORIES[name] ? name : 'unclear';
}

export function autonomyOf(name) {
  return CATEGORIES[categoryOf(name)].autonomy;
}
