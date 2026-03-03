claude() {
  command claude "$@"
  local exit_code=$?
  local last_wt="$HOME/.claude/last-worktree"
  if [[ -f "$last_wt" ]]; then
    local wt_path
    wt_path=$(<"$last_wt")
    rm -f "$last_wt"
    if [[ -d "$wt_path" ]]; then
      cd "$wt_path"
    fi
  fi
  return $exit_code
}
