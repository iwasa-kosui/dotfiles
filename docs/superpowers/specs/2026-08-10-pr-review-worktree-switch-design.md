# PRレビュー開始時のworktree切り替え

## 背景

`<leader>pp` はPR一覧を開き、選んだPRのOcto画面を表示します。cwdは動かないため、レビュー対象がいまいるworktreeと別ブランチであっても、Explorerのファイル一覧とbase差分パネルは手元のブランチのままです。base差分パネルはmergeベースとの差分を出すので、mainのworktreeでレビューを始めると変更0件と表示され、レビュー対象の変更が一覧できません。

worktreeの切り替え自体は `<leader>gw` に実装済みで、cwdを移して `:restart` する方式です。PRレビューの入口からも同じ切り替えを行い、レビュー対象のブランチのworktreeでOcto画面が開く状態にします。

## やること

- PR一覧で選んだPRのブランチに対応するworktreeへ切り替えます
- worktreeが無ければ作成します
- 切り替え後にレビュー対象PRのOcto画面を開き直します

## やらないこと

- forkからのPRには対応しません。`origin/<branch>` が存在せずfetchが失敗するため、通知して中断します
- worktreeの削除やクリーンアップは扱いません。既存どおり `git wt -d` の手動運用です
- `<leader>po` の挙動は変えません。現在ブランチのPRを開く入口として残します

## 責務の配置

### user/worktrees.lua

ブランチ名を受け取ってworktreeを用意し、そこへ切り替える関数を追加します。`git fetch`、`git wt`、`:restart` を知るのはこのモジュールだけにします。既存の `parse_porcelain` でworktree一覧を解析し、既存の `restart_in_place` で切り替えます。

公開する関数は次の2つです。

- worktree一覧から対象ブランチのworktreeを探し、いまいるworktreeと同じか、別にあるか、無いかを判定する関数
- ブランチ名を受け取り、必要ならworktreeを作成して切り替える関数。切り替え後に新しいインスタンスで実行するコマンドを引数で受け取る

判定と切り替えを分けるのは、切り替え不要な場合に呼び出し側がそのまま処理を続けられるようにするためです。

### user/pr_review.lua

PRを選んだ後の分岐だけを変えます。対象PRのブランチがいまいるworktreeと同じなら、これまでどおりOcto画面を開きます。違う場合はworktrees側へブランチ名を渡し、切り替えを任せます。

ブランチ名はPR一覧の取得時に `headRefName` として既に受け取っているため、追加のAPI呼び出しは不要です。

## フロー

1. `<leader>pp` でPR一覧を開き、PRを選びます
2. 選択したPRの `headRefName` を取り出します
3. `git worktree list --porcelain` で対象ブランチのworktreeを探します
4. いまいるworktreeと同じ場合は、restartせずOcto画面を開きます
5. 別のworktreeがある場合は、そこへ切り替えます
6. worktreeが無い場合は、ローカルブランチの有無を確認します。無ければ `git fetch origin <branch>` を実行し、`git wt <branch> origin/<branch> --nocd` で作成します。ローカルブランチがあれば `git wt <branch> --nocd` で作成します
7. cwdを新しいworktreeへ移し、`:restart` で切り替えます
8. 新しいインスタンス側で `require("user.pr_review").open()` を実行し、現在ブランチのPR画面を開きます

`git wt` は作成の経過をstdoutに出力し、最後の行がworktreeのパスです。パスは最終の非空行から取ります。

`:restart [+cmd] [command]` の `[command]` は新しいサーバー側で実行されます。切り替え前のインスタンスでOcto画面を開いても `:qall` で失われるので、切り替えが必要な場合はOcto画面の生成を切り替え後まで遅らせます。

## エラー処理

- `git worktree list` の失敗: 通知して中断します。PR画面は開きません
- `git fetch` の失敗: 通知して中断します。forkからのPRはここで止まります
- `git wt` の失敗: stderrを添えて通知し、現在地に留まります
- `git wt` の出力からパスを取れない: 通知して中断します
- `:restart` の失敗: 既存の `restart_in_place` と同じく、cwdを元へ戻して通知します。未保存のバッファがある場合がこれに該当します
- 通知のレベルは既存の `user/worktrees.lua` と揃えて `ERROR` にします

いずれの失敗でもworktreeの作成以外の副作用を残しません。

## テスト

`tests/nvim/` にアダプタ注入のユニットテストを追加します。`git` コマンドの実行、cwdの変更、restartはすべてアダプタ経由にして差し替えます。

検証する項目は次のとおりです。

- 対象ブランチのworktreeがいまいるworktreeと同じ場合、restartを呼ばずPR画面を開くこと
- 別のworktreeがある場合、そのパスへcwdを移してrestartすること
- worktreeが無くローカルブランチもない場合、fetchのあとにstart-point付きで `git wt` を呼ぶこと
- worktreeが無くローカルブランチがある場合、start-pointなしで `git wt` を呼ぶこと
- `git wt` の出力に経過行が混ざっていても最終行のパスを取り出すこと
- fetchや `git wt` が失敗した場合、restartを呼ばず通知すること
- restartが失敗した場合、cwdを元へ戻すこと
- restartに渡すコマンド文字列がPR画面を開くものであること

## 受け入れ条件

- mainのworktreeで `<leader>pp` からPRを選ぶと、そのPRのブランチのworktreeへ移り、Octo画面とbase差分パネルがレビュー対象の変更を表示します
- 対象ブランチのworktreeが未作成でも、作成して切り替わります
- 既に対象ブランチのworktreeにいる場合はrestartが起きません
- 失敗時は原因が通知され、いまいるworktreeで作業を続けられます
