#!/bin/bash
CACHE_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/gh-review-count"
CACHE_TTL=300

command -v gh >/dev/null 2>&1 || exit 0

fetch_count() {
  gh auth status >/dev/null 2>&1 || return 1
  local result
  result=$(gh search prs --review-requested=@me --state=open --json repository,author \
    | jq -r '
      [.[] | select((.author.login == "renovate[bot]") | not)]
      | group_by(.repository.name)
      | [.[] | {repo: .[0].repository.name, count: length}]
      | sort_by(-.count)
      | map("\(.repo):\(.count)")
      | join(" ")
    ' 2>/dev/null)
  if [ $? -eq 0 ]; then
    echo "$result" > "$CACHE_FILE"
  fi
}

if [ -f "$CACHE_FILE" ]; then
  cache_age=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE") ))
  cached_value=$(cat "$CACHE_FILE")
  if [ "$cache_age" -lt "$CACHE_TTL" ]; then
    [ -n "$cached_value" ] && echo "$cached_value"
    exit 0
  fi
  # Stale: return old value and update in background
  [ -n "$cached_value" ] && echo "$cached_value"
  fetch_count &
  disown 2>/dev/null
  exit 0
fi

# First run: synchronous fetch
fetch_count
cached_value=$(cat "$CACHE_FILE" 2>/dev/null)
[ -n "$cached_value" ] && echo "$cached_value"
