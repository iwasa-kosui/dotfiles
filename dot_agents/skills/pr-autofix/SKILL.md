---
name: pr-autofix
description: PR の CI 失敗とレビュー指摘を収集し、修正する。
context: fork
agent: pr-autofix-runner
model: sonnet
background: false
allowed-tools: Agent, Bash, Read, Write
---

# PR Autofix

このスキルは `context: fork` により `pr-autofix-runner`（Sonnet）のサブエージェント内で実行されます。手順の詳細と禁止事項は `pr-autofix-runner` の定義側に持たせてあるため、ここには手順の骨子だけを書きます。

1. `pr-autofix --help` で入出力を確認します。
2. `pr-autofix collect` で CI 失敗とレビュー指摘を収集します。標準出力の要約で全体を把握し、`ci-failures.json` と `review-comments.json` は必要な項目だけ読みます。
3. 各指摘の妥当性と対応方針を判断します。判断できない指摘、設計方針が変わる指摘、承認が必要な指摘は修正せず報告します。
4. 修正はコードと設定ファイルを `code-editor`、Markdown を `doc-editor` に委譲します。
5. コミットメッセージとレビュー返信文は統括役が自分で執筆します。
6. コミットと PR 更新は `agent-pr --help` の指示に従います。レビュー返信の投稿は CLI に機能がないため `gh api` を直接使います。
7. `pr-autofix collect` を再実行し、CI の状態と未解決の指摘を確認します。
8. 対応した内容と残る問題を報告します。

計画の提示だけを求められた場合は、修正を実行せず収集結果と方針案を報告します。

Ready 化、merge、force-push はユーザーの明示的な承認が必要なため、このスキルでは行いません。
