#!/usr/bin/env bash
# Package the extension for the Chrome Web Store.
#
#   npm run package
#
# Writes JustClarify-extension-v<version>.zip at the repo root, named from the
# version in manifest.json so a stale zip can never be mistaken for a fresh one.
# Chrome wants the manifest at the ARCHIVE ROOT, so this zips the contents of
# the extension directory, not the directory itself.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="ambient-explainer-extension"

VERSION=$(python3 -c "import json;print(json.load(open('$SRC/manifest.json'))['version'])")
OUT="JustClarify-extension-v${VERSION}.zip"

# Any older build of this same version would otherwise be silently kept by zip.
rm -f "$OUT"

# Staged in a temp copy so the store build can differ from the source tree in
# exactly one way: it does not inject into the test bench at /dev.
#
# The bench is a real http page, so without this the STORE extension and the
# unpacked dev build would both inject there and fight over the same selection.
# Excluding it here — rather than in the source manifest — keeps the unpacked
# build (which is what you load at chrome://extensions) working on /dev, which
# is the entire point of the page.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R "$SRC/." "$STAGE/"

python3 - "$STAGE/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path) as f:
    m = json.load(f)
for script in m.get("content_scripts", []):
    # NO PORTS. A match pattern has no port component at all, so "localhost:3000"
    # is not a narrower localhost — it is an invalid pattern, and Chrome refuses
    # to install the whole extension over it ("Invalid port"). Because this list
    # is injected only at package time, the source tree loaded unpacked was fine
    # and only the store upload failed. "*://localhost/dev*" already covers every
    # port, which is what the :3000 entry was reaching for.
    script["exclude_matches"] = [
        "*://justclarify.xyz/dev*",
        "*://localhost/dev*",
        "*://127.0.0.1/dev*",
    ]
with open(path, "w") as f:
    json.dump(m, f, indent=2)
    f.write("\n")
print("  patched manifest: content scripts excluded from /dev")
PY

# Excludes: macOS cruft, editor leftovers, and the spec/notes files that have no
# business shipping to users. The node test suite and any Next.js build trace
# that wandered into the directory go too — they are a third of the archive, a
# reviewer reads them as shipped code, and a trace file carries local paths.
(
  cd "$STAGE"
  zip -r -q "$OLDPWD/$OUT" . \
    -x "*.DS_Store" \
    -x "__MACOSX/*" \
    -x "*.md" \
    -x "*.map" \
    -x "*.zip" \
    -x "tests/*" \
    -x ".next/*"

  # A directory whose only file was excluded above (icons/providers/, which
  # holds just a README) survives as an empty entry in the archive. Chrome's
  # installer has no use for one and the store's automated install test is
  # fussier than a local unpacked load, so drop them.
  zip -q -d "$OLDPWD/$OUT" "*/" 2>/dev/null || true
)

echo "Built $OUT"

# Hand the ARCHIVE's contents to Chrome and make it build a real .crx. This is
# the only check that catches what the store's automated install test catches,
# because the two failure modes that matter here exist ONLY in the packaged
# build: the exclude_matches patched in above, and any file the excludes dropped.
# A source tree that loads perfectly unpacked is no evidence at all.
#
# The cost of skipping it is a review round trip measured in days, so this runs
# on every package. If Chrome isn't installed the build still succeeds, loudly.
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -x "$CHROME" ]; then
  VERIFY=$(mktemp -d)
  trap 'rm -rf "$STAGE" "$VERIFY"' EXIT
  unzip -q "$OUT" -d "$VERIFY/ext"
  CRX_ERR=$("$CHROME" --pack-extension="$VERIFY/ext" --no-message-box 2>&1 \
    | grep -iE "error|invalid" || true)
  if [ -n "$CRX_ERR" ]; then
    echo
    echo "REJECTED by Chrome — the store will reject it too:"
    echo "$CRX_ERR" | sed 's/^.*ERROR:[^ ]* /  /'
    exit 1
  fi
  echo "  Chrome installs the packed build cleanly."
else
  echo "  WARNING: Chrome not found, packed build UNVERIFIED."
fi

echo
echo "Sanity check — these must match the source you just edited:"
unzip -p "$OUT" manifest.json | python3 -c "
import sys, json
m = json.load(sys.stdin)
print('  version          ', m['version'])
print('  host_permissions ')
for h in m['host_permissions']:
    print('   -', h)
"
echo
echo "Files: $(unzip -l "$OUT" | tail -1 | awk '{print $2}')  ·  Size: $(du -h "$OUT" | cut -f1)"
