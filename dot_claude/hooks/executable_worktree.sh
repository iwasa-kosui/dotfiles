#!/bin/bash
# WorktreeCreate / WorktreeRemove hook

set -euo pipefail

input=$(cat)
log_dir="$HOME/.claude/logs"
mkdir -p "$log_dir"

timestamp=$(date +%Y%m%d_%H%M%S)
echo "[${timestamp}] Worktree event: ${input}" >> "${log_dir}/worktree.log"

event=$(echo "$input" | jq -r '.hook_event_name // ""')
cwd=$(echo "$input" | jq -r '.cwd // "."')
name=$(echo "$input" | jq -r '.name // ""')

if [ "$event" = "WorktreeCreate" ]; then
  if [ -z "$name" ]; then
    echo "Error: name is required" >&2
    exit 1
  fi

  # リポジトリのルートを取得
  repo_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$repo_root" ]; then
    echo "Error: not a git repository" >&2
    exit 1
  fi

  wt_path="${repo_root}/.wt/${name}"
  branch_name="${name}"

  # 既に存在する場合はそのパスを返す
  if [ -d "$wt_path" ]; then
    echo "$wt_path"
    exit 0
  fi

  # worktreeを作成
  git -C "$repo_root" worktree add "$wt_path" -b "$branch_name" 2>&1 >&2
  echo "$wt_path"

elif [ "$event" = "WorktreeRemove" ]; then
  if [ -z "$name" ]; then
    echo "Error: name is required" >&2
    exit 1
  fi

  repo_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$repo_root" ]; then
    echo "Error: not a git repository" >&2
    exit 1
  fi

  wt_path="${repo_root}/.wt/${name}"

  if [ -d "$wt_path" ]; then
    git -C "$repo_root" worktree remove "$wt_path" 2>&1 >&2
    echo "Removed worktree: ${wt_path}"
  else
    echo "Worktree not found: ${wt_path}" >&2
    exit 1
  fi
fi
