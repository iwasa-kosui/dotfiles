# ルールファイルへのリファレンス

各種ルールは `~/.claude/rules/` 配下に配置。詳細は各ファイルを参照。

## 常時適用 (alwaysApply: true)

- `communication-style.md` — コミュニケーションスタイル・批判的姿勢
- `shell-command-style.md` — シェルコマンドの書き方（権限プロンプト回避）
- `subagent-tool-usage.md` — サブエージェントでのBash使用制限
- `secret-file-access.md` — 秘密情報ファイルへのアクセス禁止

## オンデマンド適用 (alwaysApply: false)

- `commit-message.md` — コミットメッセージとコミット分割
- `slack-mcp.md` — Slack MCPサーバの使い方
- `confluence-jira-cli.md` — Confluence/Jira CLIのエラーハンドリング
- `worktree-workflow.md` — git worktreeの運用ルール
- `doc-driven.md` — ドキュメント駆動開発
- `github-review.md` — GitHub PRレビューコメント書式
- `pr-creation.md` — PR作成ワークフロー
- `jira-markdown.md` — JIRA課題の記法
- `local.md` — リポジトリ一覧
- `pdf-post-processing.md` — PDF→Markdown変換後の後処理
- `typescript-discriminated-union.md` — TypeScript判別共用体
- `typescript-no-double-assertion.md` — TypeScript `as unknown as` 禁止

@RTK.md
