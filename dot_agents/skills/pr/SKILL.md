---
name: pr
description: Git の変更をコミットし、Draft PR を作成または既存PRを更新する。
allowed-tools: Agent
---

# PR

`pr-runner` サブエージェントを起動します。手順と禁止事項は `pr-runner` の定義側に持たせてあるため、ここには起動の仕方だけを書きます。

1. Agent tool を `subagent_type: "pr-runner"` で呼びます。`model` は渡しません。`pr-runner` の定義側で Sonnet に固定してあります
2. タスクメッセージに次を渡します。`pr-runner` に会話履歴は渡らないため、ここに書かなかったことは伝わりません
   - 作業ディレクトリの絶対パス
   - 何をなぜ変更したかの要約。`pr-runner` は `agent-pr context` で diff を読めますが、変更の意図は diff からは読めません
   - ユーザーから PR のタイトル・本文・base ブランチの希望があれば、そのまま添えます
   - 新規 PR の作成か既存 PR の更新かが分かっている場合は、その旨を書きます
3. 返ってきた報告をユーザーに伝えます。コミットの有無、PR の URL、スキップした手順は省略しません

コミットメッセージと PR 本文の執筆は `pr-runner` の担当なので、ここでは書きません。Ready 化・merge・force-push・保護ブランチへの直接変更は、`pr-runner` も行いません。
