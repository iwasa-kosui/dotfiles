---
name: pr-autofix
description: PR の CI 失敗とレビュー指摘を収集し、修正する。起動時は対象 PR の番号か URL と、作業ディレクトリ（worktree）の絶対パスを引数に含める。
context: fork
agent: pr-autofix-runner
model: sonnet
background: false
allowed-tools: Agent, Bash, Read, Write
---

# PR Autofix

CI 失敗とレビュー指摘を収集・修正します。実行場所は runtime で分かれます。手順の詳細と禁止事項の正本は Claude Code では `pr-autofix-runner` の定義側にあります。Cursor ではこのスキル本文の手順に従います。

## Runtime

- **Claude Code**: `context: fork` により `pr-autofix-runner`（Sonnet）のサブエージェント内で実行します。
- **Cursor**: メインの会話でこの手順をそのまま実行します。Task やその他のサブエージェントには委譲しません。修正もメインで直接行い、`code-editor` / `doc-editor` への再委譲はしません。

## 引数と対象 PR

引数: $ARGUMENTS

Claude Code の fork 先にはメインの会話履歴が渡らないため、対象 PR は次の優先順位で決めます。Cursor でも同じ優先順位に従います。

1. 引数に PR 番号か URL があれば、それを使います。
2. 引数に作業ディレクトリの絶対パスがあれば、以降の git / gh / pr-autofix のコマンドはそのディレクトリに `cd` してから実行します。
3. PR の指定がなければ、作業ディレクトリで `gh pr view --json number,url,headRefName` を実行して現在のブランチの PR を特定し、その番号を `pr-autofix collect` に渡します。
4. それでも見つからなければ推測せず、PR を特定できなかったことを報告して終了します。

## 手順

1. `pr-autofix --help` で入出力を確認します。
2. `pr-autofix collect` で CI 失敗とレビュー指摘を収集します。標準出力の要約で全体を把握し、`ci-failures.json` と `review-comments.json` は必要な項目だけ読みます。
3. 各指摘の妥当性と対応方針を判断します。判断できない指摘、設計方針が変わる指摘、承認が必要な指摘は修正せず報告します。
4. 修正は、Claude Code ではコードと設定ファイルを `code-editor`、Markdown を `doc-editor` に委譲します。Cursor ではメインで直接編集します。
5. コミットメッセージとレビュー返信文は実行役が自分で執筆します。
6. コミットと PR 更新は `agent-pr --help` の指示に従います。レビュー返信の投稿は CLI に機能がないため `gh api` を直接使います。
7. `pr-autofix collect` を再実行し、CI の状態と未解決の指摘を確認します。
8. 対応した内容と残る問題を報告します。

計画の提示だけを求められた場合は、修正を実行せず収集結果と方針案を報告します。

Ready 化、merge、force-push はユーザーの明示的な承認が必要なため、このスキルでは行いません。
