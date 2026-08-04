# ルールファイルへのリファレンス

各種ルールは `~/.Codex/rules/` 配下に配置。詳細は各ファイルを参照。

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

## GitHub CLI 利用ルール

- PR作成・PR確認・PR更新など、GitHub操作を求められた場合は、まず `gh` コマンドを使う。
- `gh auth status` の失敗や警告だけを根拠に、`gh` 全体が使えないと判断してはならない。ユーザー環境では目的の `gh` コマンドが正常に動くことがある。
- `gh auth status` が token invalid などを返しても、まず目的のコマンド（例: `gh pr create`, `gh pr view`, `gh pr edit`, `gh pr checks`）を実行する。目的のコマンド自体が失敗した場合にのみ、認証状態の確認や代替手段を検討する。
- GitHubコネクタやWeb APIへ迂回する前に、原則として該当する `gh` コマンドを試す。

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
