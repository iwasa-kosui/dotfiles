#!/usr/bin/env bash
# /goal セッションを cmux ワークスペースで起動する。
#
# 呼び出し元は「タスク概要 + 受入条件 + 条件付きの前提条件」までを body ファイルに書き、
# 常に必須の前提条件とワークスペース命名・起動はこのスクリプトに任せる。
# pr-mergeable と goal-builder が同じ文面を二重に持たないための共有点。
#
# Usage: goal-session.sh [--dry-run] <body-file> [name-hint]

set -euo pipefail

dry_run=false
if [[ ${1:-} == "--dry-run" ]]; then
  dry_run=true
  shift
fi

body_file=${1:-}
name_hint=${2:-}

if [[ -z $body_file || ! -f $body_file ]]; then
  echo "Usage: goal-session.sh [--dry-run] <body-file> [name-hint]" >&2
  exit 1
fi

session_dir=$(mktemp -d /tmp/goal-session-XXXXXX)
prompt_file="$session_dir/prompt.md"

{
  echo "/goal"
  cat "$body_file"
  cat <<'FOOTER'

### 前提条件（常に必須）
- ローカルでテスト・lint・型チェック等がすべて通過していること
- push 済みの場合、GitHub Actions の CI が通過していること（`gh run list --branch <branch>` または `gh pr checks` で**リモートの CI ステータス**を確認する。ローカルの検証結果だけでは CI 通過とみなさない。CI が in_progress や queued の場合は completed になるまで待機してから再確認する）
- 上記の受入条件をすべて満たしていること
- 完了を主張する前に、実際にコマンドを実行して結果を確認すること（証拠なき完了主張は不可）
FOOTER
} >"$prompt_file"

if [[ $dry_run == true ]]; then
  cat "$prompt_file"
  echo "(dry-run: 起動していません)" >&2
  exit 0
fi

ws_name=$(claude -m haiku -p "以下のタスク概要から、ワークスペース名として最適な短い英語名を1つだけ出力してください。kebab-case、15文字以内、説明不要。タスク: ${name_hint:-unknown}" 2>/dev/null | tr -cd 'a-z0-9-' || true)
ws_name=${ws_name:-goal}
ws_name=${ws_name:0:15}

run_script="$session_dir/run.sh"
cat >"$run_script" <<SCRIPT
#!/usr/bin/env bash
exec claude "\$(cat '$prompt_file')"
SCRIPT
chmod +x "$run_script"

cmux new-workspace --name "$ws_name" --cwd "$PWD" --command "bash $run_script"
echo "cmux workspace: $ws_name (prompt: $prompt_file)"
