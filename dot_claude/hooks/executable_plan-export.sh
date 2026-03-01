#!/bin/bash
# PreToolUse hook: ExitPlanMode時にプランをエクスポート

set -euo pipefail

input=$(cat)

# プランファイルのパスを取得
plan_file=$(echo "$input" | jq -r '.tool_input.plan_file // ""')

if [ -n "$plan_file" ] && [ -f "$plan_file" ]; then
  export_dir="$HOME/.claude/plans"
  mkdir -p "$export_dir"
  timestamp=$(date +%Y%m%d_%H%M%S)
  cp "$plan_file" "${export_dir}/plan_${timestamp}.md"
fi

echo '{"decision": "allow"}'
