---
description: Bashツールでシェルコマンドを実行する際の書き方ルール
alwaysApply: true
---

# シェルコマンドの書き方

セキュリティチェックによる不要な権限プロンプトを避けるため、以下を守ること:

- `#` を含む複数行テキスト（マークダウン等）をCLI引数に渡す場合は、一時ファイルに書き出してファイルパスで参照する
  - ⭕ `cat > /tmp/body.md <<'EOF' ... EOF; gh pr create --body-file /tmp/body.md`
  - ❌ `gh pr create --body "$(cat <<'EOF' ... ## Heading ... EOF)"`
- `$(...)`コマンド置換をCLI引数に埋め込まない。変数に格納するか一時ファイルを経由する
  - ⭕ `body=$(cmd); gh pr create --body "$body"`
  - ❌ `gh pr create --body "$(cmd)"`
