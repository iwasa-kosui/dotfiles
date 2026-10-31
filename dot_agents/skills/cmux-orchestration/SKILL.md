---
name: cmux-orchestration
description: cmux で作業セッションとレビューセッションを起動し、SendMessage で進捗とレビューを受け取って PR を merge まで進める。複数の作業を別々の Claude Code セッションに並行して任せ、レビューと merge まで管理したいときに使う。
---

# cmux orchestration

管理役の Claude Code セッションが、cmux のワークスペースごとに作業セッションとレビューセッションを起動します。各セッションはセッション間通信（SendMessage）で報告と指摘を送ります。ユーザーの手作業を減らすことが目的です。

## 役割

- 管理役は、ワークツリーを作り、セッションを起動し、報告を待ちます。管理役は判断の依頼に答え、重点観点を追加で指示し、GitHub の Environment を承認し、古い workflow 実行を取り消します。管理役は、ユーザーの承認を得てから、レビューセッションが承認した head SHA を指定して PR を merge します。
- 作業セッションは、バックログの1件につき1つ起動します。作業セッションは Draft PR を作り、PR URL・要旨・検証結果・未確認事項を管理役に SendMessage で報告します。
- レビューセッションは、PR ごとに1つ起動します。レビューセッションはコードを編集しません。レビューセッションは指摘を「重大度（must/should/nit）・file:line・問題・修正案」の形で作業セッションに直接送ります。must と should がすべて解消したら、レビューセッションは「承認: PR URL・確認した head SHA（40桁）・残った nit」を管理役に送ります。

## 手順

1. 管理役は ListAgents で自分の宛先名を確認します。ListAgents の出力に「This session is <名前>」と表示されます。管理役はこの名前を共通ルールのプロンプトに書きます。
2. 管理役は、「ダッシュボード」の節の基準でダッシュボードを作るかを決めます。作る場合、管理役はセッションを起動する前に最初の版を公開します。
3. 管理役は、`git worktree add` で `<リポジトリ>/.wt/<ブランチ名>` にワークツリーを先に作ります。作業セッションには EnterWorktree を使わせません。作業セッションが EnterWorktree を使うと、`.claude/worktrees/` の外への移動を確かめる権限確認が出てセッションが止まり、ユーザーの操作が必要になります。
4. 管理役はプロンプトを Write ツールでファイルに書きます。共通ルールと個別の指示は別のファイルにします。管理役は、プロンプトのファイルと起動スクリプトをワークツリーの外に置き、絶対パスで指定します。ワークツリーの中に置くと、作業セッションがこれらのファイルを `git add` して PR に含めるおそれがあります。管理役は Bash の heredoc ではプロンプトを書きません。heredoc で書くと、本文に含まれる語（AWS の CLI 名など）に bash-guard の hook が反応して、コマンドが拒否されることがあります。
5. 管理役は作業セッションの起動スクリプトを書き、cmux でワークスペースを作って作業セッションを起動します。
   - 管理役は `CMUX_QUIET=1 cmux new-workspace --name <ワークスペース名> --cwd <ワークツリーのパス> --command "bash <起動スクリプトの絶対パス>" --focus false` を実行します。cmux は `--command` の文字列を、新しいワークスペースのシェルに1行のコマンドとして打ち込みます。`CMUX_QUIET=1` を付けると、エイリアス変更の通知が出なくなります。
   - 起動スクリプトは、プロンプトのファイルを読んでから `claude -n <セッション名> --permission-mode auto` を実行します。起動スクリプトの中身は「起動スクリプト」の雛形に従います。`-n` で付けた名前が SendMessage の宛先になります。
   - 管理役は `CMUX_QUIET=1 cmux list-workspaces` の出力を `--name` で付けた名前と突き合わせ、ワークスペースの ref を控えます。
6. 作業セッションから PR URL の報告を受けたら、管理役はレビューセッションの指示に PR URL を書き、レビューセッションを起動します。起動の方法は手順5と同じです。管理役は、レビューセッションの `--cwd` に作業セッションと同じワークツリーを指定します。レビューセッションは PR の差分を `gh pr diff <PR URL>` で読みます。
7. 管理役は報告を待ちます。待ち方は「監視」の節に従います。
8. 管理役は、レビューセッションから承認を受けたら、Ready 化と merge の前にユーザーの承認を得ます。権限確認が出た場合、管理役はユーザーの応答を待ちます。ユーザーが承認したら、管理役は `gh pr ready <PR>` を実行し、続けて `gh pr merge <PR> --squash --match-head-commit <承認された head SHA>` を実行します。

## 監視

- 報告は SendMessage で届きます。管理役は `sleep` の長い待機タイマーをバックグラウンドで動かして待ちます。
- 報告が途絶えたら、管理役は `cmux read-screen --workspace <ワークスペースの ref> --lines <行数>` で各セッションの画面を見て、権限確認で止まっていないかを確かめます。
- セッションが権限確認で止まっている場合、管理役は代わりに答えません。管理役はユーザーに、どのワークスペースで何を選べばよいかを伝えます。

## 権限と手作業

- 作業セッションで権限判定に拒否された操作を、管理役やほかのセッションが代わりに実行しません。
- 本番サーバーへの ssh のように権限判定で止まりやすい操作を、ユーザーの手作業に回しません。管理役とセッションは、CI（GitHub Actions の workflow）を経由する方法を先に検討します。
- プロンプトに「例:」として具体的な値を書くと、セッションはその値をそのまま使います。管理役は、使ってほしくない値を「例:」としてプロンプトに書きません。

## 終了

- ワークスペースは管理役が閉じます。管理役は、PR の merge が済んだ後、作業セッションとレビューセッションのそれぞれに終了の連絡を SendMessage で送ります。管理役はその後で `cmux close-workspace --workspace <ワークスペースの ref>` を実行し、各ワークスペースを閉じます。
- 閉じた後のセッションには、メッセージが届きません。

## ダッシュボード

ダッシュボードは、ユーザーが作業の状況を一目で把握するための HTML のページです。管理役が作成と更新を担います。

### 作るかどうかの基準

管理役は、次のどれか1つに当てはまる場合にダッシュボードを作ります。どれにも当てはまらない場合、管理役はテキストのバックログだけで進めます。

- 同時に動かすセッションが4つ以上ある。作業セッションとレビューセッションが2組以上ある状態です。
- 作業全体で PR が3件以上になる見込みがある。
- 作業期間が2日以上にわたる。

### 載せる内容

管理役は、ページの上から次の順に節を置きます。

1. ユーザーの操作が必要なもの。権限確認で止まったセッション、GitHub の Environment の承認待ち、ユーザーの判断待ちを、ワークスペース名と選ぶべき操作とともに並べます。管理役はこの節を目立つ枠と色で囲みます。該当するものがないとき、管理役は「なし」と書き、目立つ枠を外します。
2. 目標と現在地の要約。
3. 構成図。移行作業では移行前と移行後の構成を並べて描きます。移行以外の作業では対象システムの構成を描きます。管理役は図をインライン SVG で描きます。
4. バックログの表（ID、内容、依存、担当セッション、状態）と、項目間の依存関係の図。
5. セッションの一覧（作業セッションとレビューセッションの対応、cmux のワークスペース、状態）。
6. PR の一覧（作業担当、レビュー担当、状態、merge のコミット）。
7. 決定事項の記録（日付、決めた人、内容）。

### 公開と更新

- 管理役は、Claude Code の Artifact ツールでダッシュボードを公開します。公開したページは private で始まります。ページのリンクを誰に共有するかは、ユーザーが決めます。
- 管理役は、ダッシュボードの HTML を置くファイルパスを最初に1つ決めます。管理役は状態が変わるたびに、同じファイルパスで再公開します。同じファイルパスで公開すると、同じ URL のページが更新されます。
- 管理役は、次のときにダッシュボードを更新します。
  - セッションを起動したとき、閉じたとき
  - PR が作られたとき、merge されたとき
  - 判断を記録したとき
  - ユーザーの操作が必要な事態が起きたとき、解消したとき
- 管理役は、図を描く前に artifact-design と artifact-diagramming の skill を読み込みます。どちらかの skill が使えない場合は、読み込まずに進めます。

### 二重管理を避ける

- バックログと決定事項の正本は、1つの Markdown のファイルにまとめます。各セッションはプロンプトの指示でこの Markdown を読むので、管理役は正本をセッションが読める形式にしておきます。
- 管理役は、更新のたびに Markdown の正本からダッシュボードの表へ内容を書き写します。管理役は、ダッシュボードの表だけを直接書き換えません。
- セッションの状態と PR の状態には正本を作りません。管理役は、更新のたびに `cmux read-screen` と `gh pr view` で確かめた値をダッシュボードに載せます。

## 雛形

`<...>` はプレースホルダです。管理役が起動前に実際の値へ置き換えます。

### 共通ルール

```markdown
# 共通ルール

- 管理役のセッション名は `<管理役の名前>` です。報告・質問・判断の依頼は、この名前に SendMessage で送ります。
- バックログと決定事項は `<バックログの場所>` にあります。
- 作業ディレクトリは起動時のディレクトリです。EnterWorktree で新しいワークツリーを作りません。

## 進め方

1. 担当の項目を読み、不明点があれば作業を始める前に管理役に質問します。
2. 判断が必要な点は、自分で決めずに管理役に聞きます。
3. 担当の作業が終わったら、完了の報告を管理役に送ります。ワークスペースは管理役が閉じるので、自分では閉じません。
4. 管理役から終了の連絡を受けたら、新しい作業を始めません。

## 禁止事項

- 権限判定で拒否された操作を、別の方法で回避しません。ほかのセッションに代わりの実行を頼みません。拒否された内容を管理役に報告します。
- 本番サーバーへの直接の操作が必要になったら、CI（GitHub Actions の workflow）を経由する方法を先に検討し、管理役に相談します。
- PR の Ready 化、merge、force-push、保護ブランチへの直接 push はしません。
```

### 作業セッション

```markdown
# 担当

- このセッションの名前: `<作業セッション名>`
- 担当するバックログの項目: `<項目>`
- ブランチ: `<ブランチ名>`（作業ディレクトリのワークツリー）
- レビューセッションの名前: `<レビューセッション名>`

## 進め方

1. 担当の項目を実装し、検証します。
2. Draft PR を作ります。
3. PR URL・要旨・検証結果・未確認事項を `<管理役の名前>` に SendMessage で報告します。
4. `<レビューセッション名>` から指摘が SendMessage で届きます。指摘に対応して push し、`<レビューセッション名>` と `<管理役の名前>` に返信します。
```

### レビューセッション

```markdown
# レビュー担当

- このセッションの名前: `<レビューセッション名>`
- 対象の PR: `<PR URL>`
- 作業セッションの名前: `<作業セッション名>`
- 重点観点: `<観点>`

## 進め方

1. PR の差分を `gh pr diff <PR URL>` で読みます。コードは編集しません。
2. 指摘は1件ごとに「重大度（must/should/nit）・file:line・問題・修正案」の形で、`<作業セッション名>` に SendMessage で送ります。
3. `<作業セッション名>` から修正の返信が届いたら、push された差分を確認します。
4. must と should がすべて解消したら、「承認: PR URL・確認した head SHA（40桁）・残った nit」を `<管理役の名前>` に SendMessage で送ります。
```

### 起動スクリプト（作業用）

`$(cat ...)` の失敗は `set -e` で止まらないことがあるので、起動スクリプトはファイルごとに変数へ読み込みます。2つのファイルの間には空行を入れます。

```bash
#!/bin/bash
set -euo pipefail
common="$(cat <共通ルールのファイルの絶対パス>)"
task="$(cat <作業セッションの指示のファイルの絶対パス>)"
exec claude -n <作業セッション名> --permission-mode auto "${common}"$'\n\n'"${task}"
```

### 起動スクリプト（レビュー用）

```bash
#!/bin/bash
set -euo pipefail
common="$(cat <共通ルールのファイルの絶対パス>)"
task="$(cat <レビューセッションの指示のファイルの絶対パス>)"
exec claude -n <レビューセッション名> --permission-mode auto "${common}"$'\n\n'"${task}"
```

### ダッシュボード

この雛形では、HTML のタグと区別するために `{{...}}` をプレースホルダにします。管理役は、表の行と一覧の項目を件数に合わせて複製します。

```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{作業名}} 進捗</title>
<style>
:root { --bg: #ffffff; --fg: #1a1a1a; --muted: #666666; --line: #dddddd; --alert-bg: #fff4e5; --alert-line: #e8590c; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #16181d; --fg: #e8e8e8; --muted: #a0a0a0; --line: #333333; --alert-bg: #3a2410; --alert-line: #ff922b; }
}
:root[data-theme="dark"] { --bg: #16181d; --fg: #e8e8e8; --muted: #a0a0a0; --line: #333333; --alert-bg: #3a2410; --alert-line: #ff922b; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font-family: system-ui, sans-serif; line-height: 1.6; }
main { max-width: 1100px; margin: 0 auto; }
.alert { border: 2px solid var(--alert-line); background: var(--alert-bg); padding: 12px 16px; border-radius: 8px; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
svg { max-width: 100%; height: auto; }
.updated { color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>{{作業名}}</h1>
  <p class="updated">最終更新: {{更新日時}}</p>

  <section class="alert" id="needs-user">
    <h2>ユーザーの操作が必要なもの</h2>
    <ul>
      <li>{{ワークスペース名}}: {{止まっている理由}} → {{選ぶべき操作}}</li>
    </ul>
  </section>

  <section id="summary">
    <h2>目標と現在地</h2>
    <p>{{目標}}</p>
    <p>{{現在地}}</p>
  </section>

  <section id="architecture">
    <h2>構成図</h2>
    <svg viewBox="0 0 800 320" role="img" aria-label="{{図の説明}}">
      <!-- {{移行前と移行後の構成、または対象システムの構成}} -->
    </svg>
  </section>

  <section id="backlog">
    <h2>バックログ</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>内容</th><th>依存</th><th>担当セッション</th><th>状態</th></tr></thead>
        <tbody>
          <tr><td>{{ID}}</td><td>{{内容}}</td><td>{{依存する ID}}</td><td>{{作業セッション名}}</td><td>{{状態}}</td></tr>
        </tbody>
      </table>
    </div>
    <svg viewBox="0 0 800 240" role="img" aria-label="バックログの依存関係">
      <!-- {{バックログの項目間の依存関係}} -->
    </svg>
  </section>

  <section id="sessions">
    <h2>セッション</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>作業セッション</th><th>レビューセッション</th><th>cmux のワークスペース</th><th>状態</th></tr></thead>
        <tbody>
          <tr><td>{{作業セッション名}}</td><td>{{レビューセッション名}}</td><td>{{ワークスペースの ref}}</td><td>{{状態}}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section id="prs">
    <h2>PR</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>PR</th><th>作業担当</th><th>レビュー担当</th><th>状態</th><th>merge のコミット</th></tr></thead>
        <tbody>
          <tr><td><a href="{{PR URL}}">{{PR 番号}}</a></td><td>{{作業セッション名}}</td><td>{{レビューセッション名}}</td><td>{{状態}}</td><td>{{merge のコミット}}</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section id="decisions">
    <h2>決定事項</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>日付</th><th>決めた人</th><th>内容</th></tr></thead>
        <tbody>
          <tr><td>{{日付}}</td><td>{{決めた人}}</td><td>{{内容}}</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</main>
</body>
</html>
```
