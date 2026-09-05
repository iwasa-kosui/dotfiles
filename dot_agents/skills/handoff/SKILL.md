---
name: handoff
description: 現在の作業を引き継ぐための文書を作成する。
---

# Handoff

`handoff --help` に従って、引き継ぐ結論を JSON ファイルに書きます。

`handoff write --brief <json-file> [--out-dir <directory>]` を実行し、返された絶対パスを提示します。

残す事実・決定・未完了作業はエージェントが選びます。Git情報の収集、整形、保存先の決定、上書き回避はCLIが行います。
