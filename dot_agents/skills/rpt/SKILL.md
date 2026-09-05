---
name: rpt
description: rpt で MDX・HTML のレポートを作成・更新・プレビューする。
---

# rpt

最初に `rpt` を実行し、標準出力の記法に従って MDX を作成します。

- HTML生成: `rpt build <input.mdx> -o <output.html>`
- モバイルプレビュー: `rpt preview <output.html>`

CLIの診断に従って入力を修正し、生成したHTMLとMDXの絶対パスを提示します。プレビューを依頼された場合はプロセスを維持し、CLIが返したURLを提示します。
