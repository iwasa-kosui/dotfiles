---
name: pr
description: Git の変更をコミットし、Draft PR を作成または既存PRを更新する。
allowed-tools: Bash, Read, Write
---

# PR

`git` と `gh` で commit、push、Draft PR の作成・更新を行います。Claude Code でも Cursor でもメインの会話で実行し、サブエージェントには委譲しません。

## 手順

1. 状況を把握します。
   - `git status --short` と `git branch --show-current` を実行します。
   - 基点ブランチは `git symbolic-ref --short refs/remotes/origin/HEAD` で確かめます。
   - 差分は `git diff --stat HEAD` と `git diff --stat <base>...HEAD` で範囲を掴み、必要なファイルだけを読みます。
2. 差分から What と Why を判断し、コミット対象のファイルを決めます。対象に含めるか判断できないファイルはコミットせず、報告に残します。
3. `git rev-parse --absolute-git-dir` で git dir の絶対パスを確かめます。コミットメッセージを `<git dir>/PR_COMMIT_MSG`、PR 本文を `<git dir>/PR_BODY.md` に Write で書き出します。
   - git dir 配下なので、worktree でも作業ツリーを汚しません。後続のコマンドにも絶対パスで渡します。
   - コミットメッセージの末尾に、セッションで指示された `Co-Authored-By` 行を書きます。モデル名やバージョンをハードコードしません。
4. コミットします。
   - `git add -- <files...>` で対象ファイルだけをステージします。`git add -A`、`git add .`、ディレクトリ指定、`git commit -a` は使いません。
   - 削除したファイルは `git rm -- <files...>` でステージします。`git rm` 済みのファイルを `git add` に渡すと失敗します。
   - `git diff --cached --name-only` の結果が対象ファイルと一致することを確かめます。対象外のファイルが混ざっていたら、コミットせず報告します。
   - `git commit -F <git dir>/PR_COMMIT_MSG` を実行します。
5. 続きは目的で分かれます。
   - commit だけで止める指示なら、ここで終えます。
   - push は `git push -u origin HEAD` で行います。
   - PR を作る、または更新する場合は、push の後に `gh pr view --json url,state` で現在のブランチの PR を確かめます。PR が無いとこのコマンドは失敗します。
     - `state` が `OPEN` なら `gh pr edit --title <title> --body-file <git dir>/PR_BODY.md` で更新します。
     - それ以外なら `gh pr create --draft --title <title> --body-file <git dir>/PR_BODY.md [--base <branch>]` で作成します。
6. 次の項目だけを短く報告します。diff やコマンド出力の全文は含めません。
   - コミット SHA
   - push 先ブランチ
   - PR URL
   - 未コミットで残したファイルがあれば、その一覧
   - スキップした手順があれば、その内容

## 書き方の規約

- コミットメッセージは Conventional Commits の `<type>(<scope>): <description>` 形式です。scope は必須です。
- 変更の What と Why を書きます。「レビューコメントに基づき」のようなトリガーは書きません。リポジトリの CLAUDE.md の Commit Message Rules に従います。
- リポジトリに PR テンプレート（`.github/pull_request_template.md` など）があれば、その節構成に従います。
- 地の文はです・ます調です。コミットメッセージと PR タイトルは体言止め・言い切りでかまいません。

## 禁止事項

- main / master / develop にはコミットしません。feature ブランチで実行します。
- Ready 化、merge、force-push、保護ブランチへの直接変更は、ユーザーの明示的な承認なしに行いません。
- amend しません。
- コードとドキュメントの内容は、このスキルでは変更しません。
