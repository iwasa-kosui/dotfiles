---
name: x-dm
description: X.com のDMの会話一覧・履歴・検索・送信・返信を操作する。
---

# X DM

`x-dm --help` でコマンドと入力形式を確認します。

- 一覧: `x-dm list`
- 履歴: `x-dm read <会話名>`
- 検索: `x-dm search <検索語>`
- 新規送信: `x-dm send <handle> --text-file <本文ファイル>`
- 返信: `x-dm reply <会話名> --text-file <本文ファイル>`

送信・返信はユーザーから依頼された場合だけ実行します。本文の作成と結果の確認はエージェントが行います。
