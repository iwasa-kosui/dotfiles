---
name: pr
description: Git の変更をコミットし、Draft PR を作成または既存PRを更新する。
---

# PR

`agent-pr` を使います。最初に `agent-pr --help` を実行します。

1. `agent-pr context [--base <ref>]` の差分とテンプレートから、変更内容・検証結果を確認します。
2. コミット文をファイルに書き、`agent-pr commit --message-file <file> --model <実行中のモデル名> --email <提供元のnoreplyアドレス> -- <対象ファイル>...` を実行します。
3. PR本文をファイルに書き、`agent-pr publish --title <title> --body-file <file> [--base <branch>]` を実行します。
4. CLI が返した PR URL を提示します。

作業内容の判断と本文の作成はエージェントが行います。既にコミット済みなら commit は不要です。
