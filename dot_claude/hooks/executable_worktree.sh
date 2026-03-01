#!/bin/bash
# WorktreeCreate / WorktreeRemove hook

set -euo pipefail

# hookイベント情報をログに記録
input=$(cat)
log_dir="$HOME/.claude/logs"
mkdir -p "$log_dir"

timestamp=$(date +%Y%m%d_%H%M%S)
echo "[${timestamp}] Worktree event: ${input}" >> "${log_dir}/worktree.log"
