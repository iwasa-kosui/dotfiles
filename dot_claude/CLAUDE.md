# ルールファイルへのリファレンス

各種ルールは `~/.claude/rules/` 配下に配置。詳細は各ファイルを参照。

## 常時適用 (alwaysApply: true)

- `communication-style.md` — 言葉遣い・文章スタイル（対話および成果物テキスト）
- `shell-command-style.md` — シェルコマンドの書き方（権限プロンプト回避）
- `subagent-tool-usage.md` — サブエージェントでのBash使用制限
- `secret-file-access.md` — 秘密情報ファイルへのアクセス禁止

## オンデマンド適用 (alwaysApply: false)

- `commit-message.md` — コミットメッセージとコミット分割
- `confluence-jira-cli.md` — Confluence/Jira CLIのエラーハンドリング
- `worktree-workflow.md` — git worktreeの運用ルール
- `doc-driven.md` — ドキュメント駆動開発
- `github-review.md` — GitHub PRレビューコメント書式
- `pr-creation.md` — PR作成ワークフロー
- `jira-markdown.md` — JIRA課題の記法
- `local.md` — リポジトリ一覧（ローカル専用。chezmoi 未管理）
- `pdf-post-processing.md` — PDF→Markdown変換後の後処理
- `typescript-discriminated-union.md` — TypeScript判別共用体
- `typescript-no-double-assertion.md` — TypeScript `as unknown as` 禁止

## コマンド/スキル設計原則: サブエージェント駆動

コマンドやスキルを設計する際は、Opus（司令塔）と Sonnet（実行者）の役割を分離する。
`CLAUDE_CODE_SUBAGENT_MODEL` 環境変数により、Agent ツールで起動したサブエージェントは自動的に Sonnet で動作する。

### 司令塔（Opus）の責務

- ユーザーとの対話（ヒアリング、確認、承認）
- サブエージェントのディスパッチ（プロンプト組み立て + Agent tool 呼び出し）
- サブエージェントの結果を統合して最終成果物を組み立てる

### サブエージェント（Sonnet）の責務

- 調査・診断・データ収集を実行し、構造化された結果を返す
- gh コマンド実行、ファイル探索、コード解析など I/O が多い作業

### 設計のガイドライン

- コマンドの `allowed-tools` に `Agent` を含め、調査/診断フェーズをサブエージェントに委譲する
- 司令塔は Read, Glob, Grep を直接使わない。必要な情報はサブエージェント経由で取得する
- サブエージェントへのプロンプトには、期待する出力形式を明記する（構造化テキストや JSON）
- 1つの診断フェーズは原則 1 サブエージェントにまとめる。タスクが独立している場合のみ並列化する

@RTK.md
