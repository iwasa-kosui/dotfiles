#!/bin/bash
# SessionStart hook: Worktree自動作成・Jira課題・GitHub PR情報を取得

set -euo pipefail

input=$(cat)
cwd=$(echo "$input" | jq -r '.cwd // "."')

output=""

# --- git-wt でWorktree自動作成 ---
if command -v git-wt >/dev/null 2>&1 && git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  # メインのワークツリーでのみ作成（既にworktree内にいる場合はスキップ）
  git_dir=$(git -C "$cwd" rev-parse --git-dir 2>/dev/null || true)
  if [ -n "$git_dir" ] && ! echo "$git_dir" | grep -q '/worktrees/'; then
    branch_name="claude/$(date +%Y%m%d-%H%M%S)"
    wt_path=$(cd "$cwd" && git-wt "$branch_name" --nocd 2>/dev/null || true)

    if [ -n "$wt_path" ] && [ -d "$wt_path" ]; then
      output+="## Worktree (自動作成)
- パス: ${wt_path}
- ブランチ: ${branch_name}
- **重要**: セッション開始直後に \`cd ${wt_path}\` を実行し、以降すべてのファイル操作はこのworktree内の絶対パスを使用してください。
"
    fi
  fi
fi

# --- Git worktree情報 ---
if git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
  worktrees=$(git -C "$cwd" worktree list 2>/dev/null || true)
  output+="## Git情報
- ブランチ: ${branch}
"
  if [ -n "$worktrees" ]; then
    output+="- ワークツリー:
$(echo "$worktrees" | sed 's/^/  /')
"
  fi
fi

# --- GitHub PR情報 ---
if command -v gh >/dev/null 2>&1 && git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  pr_info=$(cd "$cwd" && gh pr view --json number,title,state,url 2>/dev/null || true)
  if [ -n "$pr_info" ] && echo "$pr_info" | jq -e '.number' >/dev/null 2>&1; then
    pr_number=$(echo "$pr_info" | jq -r '.number')
    pr_title=$(echo "$pr_info" | jq -r '.title')
    pr_state=$(echo "$pr_info" | jq -r '.state')
    pr_url=$(echo "$pr_info" | jq -r '.url')
    output+="
## GitHub PR
- #${pr_number}: ${pr_title} (${pr_state})
- URL: ${pr_url}
"
  fi
fi

# --- Jira課題情報 ---
if command -v jira >/dev/null 2>&1; then
  # ブランチ名からJiraチケットIDを抽出 (例: feat/PROJ-123-description)
  if [ -n "${branch:-}" ]; then
    ticket_id=$(echo "$branch" | grep -oE '[A-Z]+-[0-9]+' | head -1 || true)
    if [ -n "$ticket_id" ]; then
      jira_info=$(jira get "$ticket_id" 2>/dev/null || true)
      if [ -n "$jira_info" ]; then
        output+="
## Jira課題
${jira_info}
"
      fi
    fi
  fi
fi

if [ -n "$output" ]; then
  echo "$output"
fi
