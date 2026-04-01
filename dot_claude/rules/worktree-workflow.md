---
description: git worktreeの運用ルール
alwaysApply: false
---

# Worktree Workflow

- worktreeは `.wt/<ブランチ名>` に作成される（hookが自動処理）
- 新タスク開始時はworktreeを作成してから作業する
- PR マージ後はworktreeを削除する
