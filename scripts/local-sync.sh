#!/bin/bash
# Lokální sync na Macu: stáhne akce, pushne data a GitHub je nasadí. Spouští ho launchd
# (scripts/install-launchd.sh), ručně: scripts/local-sync.sh

set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."
mkdir -p logs
exec >>logs/local-sync.log 2>&1
echo "== $(date '+%F %T') start"

# Souběžné běhy (dohnaný zmeškaný + plánovaný) by se praly o git.
if ! mkdir .git/radar-sync.lock 2>/dev/null; then
  echo "přeskočeno: jiný běh ještě neskončil"
  exit 0
fi
trap 'rmdir .git/radar-sync.lock' EXIT

if [ "$(git rev-parse --abbrev-ref HEAD)" != main ]; then
  echo "přeskočeno: pracovní kopie není na větvi main"
  exit 0
fi

# Po probuzení ze spánku chvíli trvá, než naběhne síť.
for _ in 1 2 3 4 5 6; do
  curl -fsS -m 10 -o /dev/null https://github.com && break
  sleep 20
done

git pull --rebase --autostash --quiet
node scripts/sync.mjs

git add site/data
if git diff --cached --quiet -- site/data; then
  echo "data beze změny"
else
  git commit --quiet -m "data: sync z Macu $(date -u +%FT%H:%MZ)" -- site/data
  git push --quiet
  echo "data pushnuta"
fi

# AI hledání běží na GitHubu (API klíč je jen tam). Spustí se při prvním běhu dne.
stamp=.git/radar-ai-date
today=$(date +%F)
if [ "$(cat "$stamp" 2>/dev/null)" != "$today" ]; then
  gh workflow run sync.yml -f ai=true && echo "$today" >"$stamp" && echo "AI hledání spuštěno na GitHubu"
fi
echo "== $(date '+%F %T') hotovo"
