#!/bin/sh
# Give the koalas their own GitHub: asks for the repository and a fine-grained token
# (typed hidden, never shown or logged), checks the token can write to that repository
# and nothing more is needed, stores it in data/grove.env (only you can read it), and
# restarts the grove if it runs at login.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
ENV_FILE="$ROOT/data/grove.env"
mkdir -p "$ROOT/data"

printf 'Repository for the koalas (owner/name) [FaiGiJoon/Repo-for-the-Koala-s]: '
read -r REPO
REPO=${REPO:-FaiGiJoon/Repo-for-the-Koala-s}

printf 'Paste the fine-grained token (it will not be shown): '
stty -echo 2>/dev/null || true
read -r TOKEN
stty echo 2>/dev/null || true
printf '\n'
case "$TOKEN" in
  github_pat_*|ghp_*) ;;
  *) echo "That does not look like a GitHub token (it should start with github_pat_)."; exit 1 ;;
esac

api() { curl -sS -o /tmp/koala-gh.$$ -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "https://api.github.com/repos/$REPO$1"; }

echo "Checking the token..."
code=$(api '')
if [ "$code" != 200 ]; then
  echo "The token cannot see $REPO (HTTP $code). Check the repository name, and that the token has access to it."
  rm -f /tmp/koala-gh.$$; exit 1
fi
if ! grep -q '"push": *true' /tmp/koala-gh.$$; then
  echo "The token can read $REPO but not write. Give it Contents: Read and write."
  rm -f /tmp/koala-gh.$$; exit 1
fi
BRANCH=$(sed -n 's/.*"default_branch": *"\([^"]*\)".*/\1/p' /tmp/koala-gh.$$ | head -1)
code=$(api "/git/ref/heads/$BRANCH")
rm -f /tmp/koala-gh.$$
if [ "$code" != 200 ]; then
  echo "$REPO has no first commit yet. On GitHub, add a README to it, then run this again."
  exit 1
fi

# keep any other settings already in the file; replace only these two
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
grep -v '^GROVE_GITHUB_REPO=\|^GROVE_GITHUB_TOKEN=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
printf 'GROVE_GITHUB_REPO=%s\nGROVE_GITHUB_TOKEN=%s\n' "$REPO" "$TOKEN" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Saved to data/grove.env (only your user can read it; data/ is never committed)."

PORT=${PORT:-4317}
if launchctl print "gui/$(id -u)/com.koala-grove.server" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/com.koala-grove.server"
  echo "Restarted the grove."
  sleep 3
  printf 'Let every koala write a first page now, to try it? [Y/n] '
  read -r NOW
  case "${NOW:-y}" in
    [Nn]*) ;;
    *) curl -sS -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/api/grove/github/publish"; echo ;;
  esac
  echo "From now on each koala writes its day at its first nap after 20:00: https://github.com/$REPO"
else
  echo "Done. Start the grove (npm start); each koala writes its day at its first nap after 20:00: https://github.com/$REPO"
  echo "To try it right away while it runs: curl -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:$PORT/api/grove/github/publish"
fi
