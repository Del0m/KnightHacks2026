#!/usr/bin/env bash
# Creates the Spotter labels and 75 issues in a GitHub repo, as YOU (via the gh CLI).
# Usage: ./create_issues.sh owner/repo
# Needs: gh (logged in with `gh auth login`) and jq.
set -euo pipefail
REPO="${1:?usage: ./create_issues.sh owner/repo}"
DIR="$(cd "$(dirname "$0")" && pwd)"
JSON="$DIR/issues.json"

jq -c '.labels[]' "$JSON" | while read -r l; do
  gh label create "$(jq -r .name <<<"$l")" --repo "$REPO" \
    --color "$(jq -r .color <<<"$l")" --description "$(jq -r .description <<<"$l")" --force
done

jq -c '.issues[]' "$JSON" | while read -r i; do
  title="$(jq -r .title <<<"$i")"
  if gh issue list --repo "$REPO" --state all --search "\"$title\" in:title" --json title -q '.[].title' | grep -qxF "$title"; then
    echo "skip (exists): $title"; continue
  fi
  args=()
  while read -r lab; do args+=(--label "$lab"); done < <(jq -r '.labels[]' <<<"$i")
  gh issue create --repo "$REPO" --title "$title" --body "$(jq -r .body <<<"$i")" "${args[@]}"
  sleep 1
done
echo "Done."
