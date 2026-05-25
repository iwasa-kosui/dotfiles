---
description: git worktreeの運用ルール
alwaysApply: false
---

# Worktree Workflow

- worktreeは `.wt/<ブランチ名>` に作成される（hookが自動処理）
- 新タスク開始時はworktreeを作成してから作業する
- 既存worktreeで作業を再開する際は、`git fetch origin <ブランチ名>` でリモートを取得し、ローカルが `origin/<ブランチ名>` より古ければ `git rebase origin/<ブランチ名>` で最新化してから作業を始める（リモート未pushの場合はスキップ）
- PR マージ後はworktreeを削除する
