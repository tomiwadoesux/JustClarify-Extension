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
    script["exclude_matches"] = [
        "*://justclarify.xyz/dev*",
        "*://localhost/dev*",
        "*://localhost:3000/dev*",
        "*://127.0.0.1/dev*",
    ]
with open(path, "w") as f:
    json.dump(m, f, indent=2)
    f.write("\n")
print("  patched manifest: content scripts excluded from /dev")
PY

# Excludes: macOS cruft, editor leftovers, and the spec/notes files that have no
# business shipping to users.
(
  cd "$STAGE"
  zip -r -q "$OLDPWD/$OUT" . \
    -x "*.DS_Store" \
    -x "__MACOSX/*" \
    -x "*.md" \
    -x "*.map" \
    -x "*.zip"
)

echo "Built $OUT"
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
