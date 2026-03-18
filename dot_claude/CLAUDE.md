# Slack MCP

Slack情報取得時は `slack_` から始まる全MCPサーバを使うこと（異なるワークスペースに接続されている）。

# Confluence/Jira CLI

`Error: Network error: read ECONNRESET` が返された場合、成功するまで1秒間隔でリトライし続ける。

# Worktree Workflow

- worktreeは `.wt/<ブランチ名>` に作成される（hookが自動処理）
- 新タスク開始時はworktreeを作成してから作業する
- PR マージ後はworktreeを削除する

# ドキュメント駆動

新機能・アーキテクチャ変更では実装前にドキュメント（PRD / ADR / 仕様書）を作成する。コード変更とドキュメント変更は別コミットにする。

# GitHub レビュー

レビューコメントを送信する時は必ず以下を冒頭に添える。

```
🤖 Claude Code より:
```

# PR作成

Draft で作成し、自己レビュー（review-codes / review-docs スキル）後に Ready for review にする。

# シェルコマンドの書き方

セキュリティチェックによる不要な権限プロンプトを避けるため、以下を守ること:

- `#` を含む複数行テキスト（マークダウン等）をCLI引数に渡す場合は、一時ファイルに書き出してファイルパスで参照する
  - ⭕ `cat > /tmp/body.md <<'EOF' ... EOF; gh pr create --body-file /tmp/body.md`
  - ❌ `gh pr create --body "$(cat <<'EOF' ... ## Heading ... EOF)"`
- `$(...)`コマンド置換をCLI引数に埋め込まない。変数に格納するか一時ファイルを経由する
  - ⭕ `body=$(cmd); gh pr create --body "$body"`
  - ❌ `gh pr create --body "$(cmd)"`

# リポジトリ

kkhs org のリポジトリは `$(ghq root)/github.com/kkhs/` 配下。主要リポジトリ:

- **platform-domain-app**: 認証(authnp)・組織管理(ogas)等
- **platform-domain-infra**: インフラ（Terraform等）
- **ax-toolkit**: jira-cli, confluence-cli, PDF変換プラグイン等
- **typescript-study-group**: スキル開発・プラグインアーキテクチャ
- **kosui-sandbox**: 個人サンドボックス
- **kkhs-databricks**: Databricks
- **kkhs-mcp-server**: 社内MCPサーバ
