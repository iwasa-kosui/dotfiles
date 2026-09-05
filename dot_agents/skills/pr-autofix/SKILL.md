---
name: pr-autofix
description: PR の CI 失敗とレビュー指摘を収集し、修正する。
---

# PR Autofix

`pr-autofix --help` で収集コマンドの入出力を確認します。

1. `pr-autofix collect [<PR番号|URL>] [--repo <owner/repo>]` を実行します。
2. 要約と、必要な場合は出力先の JSON を読み、指摘の妥当性を確認して修正します。計画だけの依頼ならここで報告します。
3. 修正を検証し、`agent-pr --help` に従ってコミット・公開します。
4. 再収集して CI と未解決指摘を確認し、完了内容または残る問題を報告します。

CLI は収集だけを行います。修正判断・コード変更・完了判定はエージェントが行います。
