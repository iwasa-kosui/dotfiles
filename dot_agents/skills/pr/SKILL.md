---
name: pr
description: Git の変更をコミットし、Draft PR を作成または既存PRを更新する。
context: fork
agent: pr-runner
model: sonnet
background: false
allowed-tools: Bash, Read, Write
---

# PR

このスキルは `context: fork` により `pr-runner`（Sonnet）のサブエージェント内で実行されます。`pr-runner` が `agent-pr` を使って、commit、push、Draft PR の作成・更新を実行します。git の差分と出力は Sonnet 側の文脈で消化し、メインには短い報告だけを返します。

## 手順

1. `agent-pr --help` を実行し、サブコマンドの入出力を確認します。
2. `agent-pr context [--base <ref>]` を実行します。出力は JSON で、`root` / `branch` / `base` / `status` / `diff` / `branchDiff` / `commits` / `templates` を含みます。
   - `diff` と `branchDiff` は truncate されず、巨大になりえます。全文を報告に貼らないでください。まず `git diff --stat` で範囲を掴み、必要なファイルだけを読みます。
3. 差分から What と Why を判断し、コミット対象のファイルを決めます。
4. コミットメッセージを `$(git rev-parse --git-dir)/AGENT_PR_COMMIT_MSG`、PR 本文を `$(git rev-parse --git-dir)/AGENT_PR_BODY.md` に Write で書き出します。git dir 配下なので、worktree でも正しい場所に置け、作業ツリーを汚しません。
5. コミットメッセージの末尾に、セッションで指示された `Co-Authored-By` 行をそのまま書きます。
   - `agent-pr commit` は、メッセージに `Co-Authored-By` があれば追記しません。
   - `--model` と `--email` は渡しません。
   - モデル名やバージョンをハードコードしません。
6. `agent-pr commit --message-file <path> -- <files...>` を実行します。
7. 続きは目的で分かれます。
   - PR を作る、または更新する場合は `agent-pr publish --title <title> --body-file <path> [--base <branch>]` を実行します。
   - PR を作らず commit と push だけ行う場合は `agent-pr push` を実行します。
   - commit だけで止める指示なら、ここで終えます。
8. メインに短く報告します。次の項目だけを書き、diff や CLI 出力の全文は含めません。
   - コミット SHA
   - push 先ブランチ
   - PR URL
   - 未コミットで残したファイルがあれば、その一覧
   - スキップした手順があれば、その内容

## 書き方の規約

- コミットメッセージは Conventional Commits の `<type>(<scope>): <description>` 形式です。scope は必須です。
- 変更の What と Why を書きます。「レビューコメントに基づき」のようなトリガーは書きません。リポジトリの CLAUDE.md の Commit Message Rules に従います。
- `context` の `templates` に PR テンプレートがあれば、その節構成に従います。
- 地の文はです・ます調です。コミットメッセージと PR タイトルは体言止め・言い切りでかまいません。

## `agent-pr commit` の性質

- 明示したファイルだけをステージし、意図しないファイルの混入を検証します。
- Conventional Commits でないメッセージを拒否します。
- main / master / develop へのコミットを拒否します。

## 禁止事項

- Ready 化、merge、force-push、保護ブランチへの直接変更は、ユーザーの明示的な承認なしに行いません。
- amend しません。
- `git commit`、`git push`、`gh pr create` を直接実行せず、`agent-pr` 経由にします。
- コードとドキュメントの内容は、このスキルでは変更しません。
