#!/usr/bin/env bash
# Put a GitHub token where the maintenance agent can find it, without it ever
# appearing on screen, in your shell history, or in a chat window.
#
#   bash scripts/set-github-token.sh
#
# It asks for the token with the input hidden, checks it can actually reach the
# repository and push, writes it to .env.local, and offers to send it to Vercel
# production. Safe to re-run every time you rotate.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="tomiwadoesux/JustClarify-Extension"
ENV_FILE=".env.local"

echo "Paste your GitHub token. It will NOT be shown as you type or paste."
echo "(fine-grained token needs, on $REPO: Contents read+write, Pull requests read+write)"
printf "token: "
read -rs TOKEN
echo
echo

if [ -z "$TOKEN" ]; then
  echo "Nothing entered. Stopping without changing anything."
  exit 1
fi

# Check it before storing it. A token that cannot push is worse than no token,
# because the agent would do a whole run and only fail at the last step.
echo "Checking the token against $REPO:"
WHO=$(curl -s -H "Authorization: Bearer $TOKEN" https://api.github.com/user \
  | sed -n 's/.*"login": *"\([^"]*\)".*/\1/p' | head -1)
if [ -z "$WHO" ]; then
  # Fine-grained tokens may not have user scope, which is fine on its own.
  echo "  (could not read the account name, continuing)"
else
  echo "  belongs to: $WHO"
fi

# A REAL write, then undo it. The obvious check — reading "push": true from the
# repository endpoint — is a trap: on your own repository that field reports
# YOUR access, not the token's, so a read-only fine-grained token sails through
# it and then fails at git push half an hour later. Creating and deleting a
# throwaway ref is the only answer that cannot lie.
MAIN_SHA=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/$REPO/git/refs/heads/main" \
  | sed -n 's/.*"sha": *"\([^"]*\)".*/\1/p' | head -1)

if [ -z "$MAIN_SHA" ]; then
  echo "  This token cannot even read $REPO. Check it is scoped to that repository."
  echo
  echo "Nothing was saved."
  exit 1
fi

WRITE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/git/refs" \
  -d "{\"ref\":\"refs/heads/jc-token-write-check\",\"sha\":\"$MAIN_SHA\"}")

if printf '%s' "$WRITE" | grep -q '"ref"'; then
  echo "  write access: yes"
  curl -s -X DELETE -H "Authorization: Bearer $TOKEN" \
    "https://api.github.com/repos/$REPO/git/refs/heads/jc-token-write-check" >/dev/null
else
  echo
  echo "  This token can READ $REPO but cannot WRITE to it."
  echo "  GitHub said: $(printf '%s' "$WRITE" | sed -n 's/.*"message": *"\([^"]*\)".*/\1/p')"
  echo
  echo "  Fix it on the token itself, no need to make a new one:"
  echo "    github.com -> Settings -> Developer settings"
  echo "      -> Personal access tokens -> Fine-grained tokens -> (your token)"
  echo "    Repository access: $REPO"
  echo "    Repository permissions:"
  echo "      Contents ........ Read and write"
  echo "      Pull requests ... Read and write"
  echo
  echo "Nothing was saved."
  exit 1
fi

# Written with python so the value is never passed as a shell argument, where it
# would be visible in the process list to anything watching.
TOKEN="$TOKEN" python3 - "$ENV_FILE" <<'PY'
import os, re, sys
path = sys.argv[1]
token = os.environ["TOKEN"]
try:
    with open(path) as f:
        text = f.read()
except FileNotFoundError:
    text = ""

text = text.replace("# ROTATE ME BEFORE PRODUCTION\n", "")
if re.search(r"^GITHUB_TOKEN=.*$", text, flags=re.M):
    text = re.sub(r"^GITHUB_TOKEN=.*$", "GITHUB_TOKEN=" + token, text, flags=re.M)
else:
    if text and not text.endswith("\n"):
        text += "\n"
    text += "\n# Lets the maintenance agent push a branch and open a pull request.\nGITHUB_TOKEN=" + token + "\n"

with open(path, "w") as f:
    f.write(text)
print("  saved to .env.local")
PY

echo
printf "Send it to Vercel production too? [y/N] "
read -r REPLY
case "$REPLY" in
  [yY]*)
    vercel env rm GITHUB_TOKEN production -y >/dev/null 2>&1 || true
    printf '%s' "$TOKEN" | vercel env add GITHUB_TOKEN production --sensitive >/dev/null 2>&1
    echo "  set in production. Deploy for it to take effect: vercel --prod"
    ;;
  *)
    echo "  left local only. Run this again, or scripts/setup-production-env.sh, when you want it live."
    ;;
esac

unset TOKEN
echo
echo "Done. The agent can open pull requests now."
