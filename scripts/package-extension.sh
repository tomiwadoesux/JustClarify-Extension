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

# Excludes: macOS cruft, editor leftovers, and the spec/notes files that have no
# business shipping to users.
(
  cd "$SRC"
  zip -r -q "../$OUT" . \
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
