---
name: pr
description: Git の変更をコミットし、Draft PR を作成または既存PRを更新する。
context: fork
agent: pr-runner
model: sonnet
background: false
allowed-tools: Agent, Bash, Read
---

# PR

このスキルは `context: fork` により `pr-runner`（Sonnet）のサブエージェント内で実行されます。手順の詳細と禁止事項は `pr-runner` の定義側に持たせてあるため、ここには手順の骨子だけを書きます。

1. `agent-pr --help` で入出力を確認します。
2. `agent-pr context [--base <ref>]` で差分・コミット・PR テンプレートを確認します。`diff` と `branchDiff` は truncate されていないため、必要な範囲だけ読みます。
3. 差分から変更の What と Why を判断し、コミット対象ファイルを決めます。
4. コミットメッセージと PR タイトル・本文の執筆は `pr-writer`（Haiku）に委譲します。統括役は自分で文章を書きません。
5. `agent-pr commit` でコミットし、`agent-pr publish` で push と Draft PR の作成または更新を行います。
6. コミット SHA と PR URL を報告します。

Ready 化、merge、force-push はユーザーの明示的な承認が必要なため、このスキルでは行いません。
