#!/usr/bin/env bash
# Put the environment variables /tellme and the agent need into Vercel
# production, then prove the API actually accepts the extension afterwards.
#
#   bash scripts/setup-production-env.sh
#
# Safe to re-run: each variable is removed and re-added, so this is the fix for
# a value that is already wrong as well as one that is missing. Values are read
# from .env.local so nothing secret is typed into a terminal or pasted into a
# chat.
#
# Why this script exists at all: JC_EXTENSION_IDS is stored Sensitive, which
# means it cannot be read back afterwards, by anyone, ever. A typo in it is
# invisible and turns every hosted answer into "This endpoint only serves the
# JustClarify extension." That is exactly what happened, and it is why the last
# step here is a live check rather than a hopeful "done".
set -euo pipefail

cd "$(dirname "$0")/.."

# Both ids, because there are genuinely two builds: the one from the Chrome Web
# Store, and any copy loaded unpacked. Unpacked installs used to get a random
# id per machine, so they could never be allowlisted; the "key" in manifest.json
# pins them all to the second id below.
STORE_ID="ggeikfbifbojgkgcehebpelplhajfffj"
UNPACKED_ID="pdgcfbbmlbjkhaifmfgomkfkpgillgmj"

read_local () {
  # Value of KEY= from .env.local, quotes stripped, empty if absent.
  grep -m1 "^$1=" .env.local 2>/dev/null | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//' || true
}

put () {
  local name="$1" value="$2"
  if [ -z "$value" ]; then
    echo "  SKIP $name (not found in .env.local)"
    return
  fi
  vercel env rm "$name" production -y >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$name" production --sensitive >/dev/null 2>&1
  echo "  set  $name"
}

echo "Writing production environment variables:"
put JC_EXTENSION_IDS "${STORE_ID},${UNPACKED_ID}"
put JC_ADMIN_KEY "$(read_local JC_ADMIN_KEY)"
put GITHUB_TOKEN "$(read_local GITHUB_TOKEN)"
put JC_AGENT_MODEL "$(read_local JC_AGENT_MODEL)"
put JC_AGENT_CLASSIFY_MODEL "$(read_local JC_AGENT_CLASSIFY_MODEL)"

cat <<'NOTE'

Now deploy, because environment variables only reach a NEW build:

    vercel --prod

Then run this script again with "check" to confirm it worked:

    bash scripts/setup-production-env.sh check
NOTE

if [ "${1:-}" = "check" ]; then
  echo
  echo "Checking production from outside:"
  for id in "$STORE_ID" "$UNPACKED_ID"; do
    # A deliberately malformed body: the origin gate runs FIRST, so 403 means
    # refused and 400 means allowed through (and no model was paid for).
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST https://justclarify.xyz/api/explain \
      -H "Origin: chrome-extension://$id" -H "Content-Type: application/json" -d 'not-json')
    case "$code" in
      400) echo "  OK       ${id:0:12}… is allowed through" ;;
      403) echo "  REFUSED  ${id:0:12}… is NOT in the allowlist" ;;
      *)   echo "  HTTP $code for ${id:0:12}…" ;;
    esac
  done
  for path in /tellme /api/tellme; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "https://justclarify.xyz$path")
    echo "  $path -> HTTP $code$([ "$code" = "404" ] && echo '  (not deployed yet)')"
  done
fi
