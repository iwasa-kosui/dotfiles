# Neovim base差分ツリーパネル設計

## 背景

現在のSnacks Explorerは左側へ常設され、baseブランチとの差分をファイル名の色で示します。ただし、変更ファイルだけを一覧できず、削除済みファイルも表示できません。baseとの差分を確認するにはLazyGitやDiffviewへ移動する必要があります。

Explorerの下へ独立した差分ツリーを追加します。ファイルツリーを残したまま変更ファイルを確認し、選択したファイルのbase版と作業ツリーを中央で比較できるようにします。

## 目標

- Explorer列の下半分へbaseとの差分ファイルをディレクトリツリーで表示します。
- 差分パネル全体とツリー内のディレクトリを折りたためるようにします。
- 追加、変更、改名、削除を区別して表示します。
- 選択したファイルをbase版と作業ツリーの2画面diffで表示します。
- パネルの高さと開閉状態をworktreeごとに復元します。
- 既存Explorerのbase差分色と未コミット状態表示を維持します。

## 対象外

- Snacks Explorerを別のファイルExplorerへ置き換えません。
- baseブランチを手動で切り替える操作は追加しません。
- 差分パネルでstage、commit、revertなどのGit操作は行いません。
- バイナリファイルの内容差分は表示しません。
- Diffviewの専用tabとファイルパネルは今回の2画面diffに使いません。

## 画面構成

Explorerのwindowを上下へ分割し、上側へ既存Explorer、下側へbase差分ツリーを配置します。初回表示は50:50です。通常のNeovim splitを使うため、境界をマウスでドラッグして高さを変更できます。

差分パネルの見出しは次の形式です。

```text
⌄ BASE CHANGES · main · 4
```

見出しには解決したbaseブランチ名と変更件数を表示します。全体を折りたたむと高さを1行にし、見出しだけを残します。

展開時は変更ファイルをディレクトリツリーで表示します。

```text
⌄ BASE CHANGES · main · 4
  ⌄ lua
    ⌄ user
      M base_diff.lua
      A base_diff_tree.lua
    ⌄ plugins
      M plugin.lua
  ⌄ docs
      D old-notes.md
```

追加は`A`、変更は`M`、改名は`R`、削除は`D`で表示します。各記号とファイル名には既存のGit系highlightを使います。改名は新しいパス側のディレクトリへ配置し、項目の補足として旧パスを保持します。

変更がない場合も見出しは残し、本文へ`No base changes`と表示します。

## 操作

見出し上の`Enter`または`Space`でパネル全体を開閉します。`zc`と`zo`でも閉じる、開く操作を実行できます。

ディレクトリ上の`Enter`は、そのディレクトリだけを開閉します。ファイル上の操作は次のとおりです。

- `Enter`: 最後に使った中央のEditor Groupで2画面diffを開きます。
- `o`: 作業ツリーの実ファイルを通常bufferとして開きます。
- `R`: baseと変更一覧を手動で再取得します。
- `?`: パネル内の操作一覧を表示します。

削除済みファイルには作業ツリー側の実ファイルがないため、`o`では通知だけを表示します。`Enter`では削除前の内容と空bufferを比較できます。

`Ctrl+h/j/k/l`による既存のwindow移動は、Explorer、差分ツリー、Editor Groupの間でもそのまま使えます。

## モジュール構成

### `user.base_diff`

既存のbase解決とGitコマンド実行を担当します。キャッシュをstatusだけのmapからworktree単位のsnapshotへ拡張します。

snapshotは次の情報を持ちます。

```lua
{
  cwd = "/path/to/worktree",
  base_ref = "origin/main",
  base_name = "main",
  merge_base = "<commit>",
  changes = {
    {
      status = "R",
      path = "lua/user/new_name.lua",
      old_path = "lua/user/old_name.lua",
    },
  },
}
```

`status(path)`とExplorer用formatterはsnapshotを参照し、既存のファイル名色分けを維持します。削除済みファイルはExplorerには現れませんが、snapshotの変更一覧には残します。

### `user.base_diff_tree`

差分ツリーの表現と操作を担当する新しいモジュールです。

- snapshotの変更一覧からディレクトリノードとファイルノードを構築します。
- `nofile`のscratch bufferへ見出しとツリーを描画します。
- 行とノードの対応を保持し、カーソル位置の操作を判定します。
- windowの作成、折りたたみ、再描画、終了処理を管理します。
- 2画面diffを開くためのbuffer計画を作成します。

Gitコマンドとbase解決は担当しません。

### `user.workspace`

Explorerと差分パネルの配置を調整します。

- Explorer作成後に同じ列を上下分割します。
- 既存windowがある場合は再利用し、重複パネルを作りません。
- Explorerを閉じた場合は差分パネルも閉じます。
- Explorerを再表示した場合は保存済み状態から差分パネルを復元します。
- 最後に使ったpanel以外のwindowを2画面diffの対象Editor Groupとして記録します。

## base差分の取得

baseブランチは既存と同じ順で解決します。

1. `gh pr view`が返すPRのbaseブランチ
2. `refs/remotes/origin/HEAD`が示すデフォルトブランチ
3. `origin/main`
4. `origin/master`

base候補とのmerge-baseを取得し、merge-baseから現在の作業ツリーまでを比較します。これにより、commit済みのブランチ差分、index、未commitの変更を一つの一覧に含めます。未追跡ファイルは`git status --porcelain=v1 -z --untracked-files=all`から取得し、追加ファイルとして統合します。

改名検出を有効にし、旧パスと新パスを保持します。削除済みファイルも除外せずsnapshotへ保存します。

保存、Neovimへのフォーカス復帰、shellコマンド終了後に更新を予約します。短時間の連続イベントはdebounceします。同じworktreeで新しい更新が始まった場合はgenerationを進め、古い非同期結果を破棄します。

すべてのGitコマンドが成功した時点でsnapshotを一括置換します。置換後にExplorerと差分ツリーを再描画し、片方だけが新しい結果になる状態を避けます。

## 2画面diff

Diffviewは専用tabと独自ファイルパネルを所有します。常設するExplorer列と役割が重なるため、ファイル単位の比較にはNeovim標準のdiff windowを使います。

ファイル上で`Enter`を押すと、最後に使った中央のEditor Groupを左右へ分割します。左はmerge-base時点、右は作業ツリー時点です。両方へ`diffthis`を設定し、scrollbindとcursorbindはNeovim標準のdiff動作へ任せます。

statusごとのbufferは次のように構成します。

- `A`: 左は空のread-only buffer、右は現在ファイルです。
- `M`: 左は`git show <merge-base>:<path>`のread-only buffer、右は現在ファイルです。
- `R`: 左は旧パスのbase版、右は新パスの現在ファイルです。
- `D`: 左は削除前のbase版、右は空のread-only bufferです。

作業ツリーに存在する右bufferは通常の編集可能なfile bufferです。base版と空bufferは`nofile`、`readonly`、`modifiable=false`にします。

別の差分ファイルを選んだ場合は既存の左右windowを再利用し、選択ごとにsplitを増やしません。片方のdiff windowだけが閉じられた場合は、残ったwindowのdiff modeを解除して管理中のwindow IDを破棄します。`q`でdiff表示を閉じても、編集済みの実ファイルbufferはbuffer一覧へ残します。

## 状態保存

状態は`stdpath("state") .. "/base-diff-tree.json"`へ保存します。worktreeの正規化済みパスをkeyにします。

- パネル全体の開閉状態
- 展開時の高さ
- 開いているディレクトリのパス

初回はパネルを展開し、Explorer列を50:50にします。保存済みの高さはwindow作成後に適用します。Explorerと差分ツリーの最低表示行数を確保できない場合は、差分パネルを1行へ折りたたみます。

変更一覧の更新後に存在しなくなったディレクトリは、保存状態から除外します。新しいディレクトリは閉じた状態から始めます。

## エラー処理

- `gh pr view`が失敗した場合は次のbase候補を試します。
- すべてのbase候補またはmerge-baseを解決できない場合は、見出しを`BASE CHANGES · unavailable`にします。
- 更新に失敗した場合は直前の正常なsnapshotを消さず、見出しへ警告記号を追加します。
- 初回更新が失敗した場合は空のツリーと短いエラー理由を表示します。
- 表示後にファイルが移動または削除されていた場合は通知し、更新を予約します。
- バイナリファイルを選んだ場合は2画面diffを開かず、LazyGitで確認するよう通知します。
- 差分パネルの失敗はExplorerの表示、ファイル操作、編集を妨げません。

自動更新の失敗通知は同じgenerationで一度だけ表示し、フォーカス復帰のたびに同じ通知を繰り返しません。手動更新では失敗理由を毎回通知します。

## 検証方針

既存の`tests/nvim/run.lua`から実行するLuaテストへ次を追加します。

- `A/M/R/D`と改名前後パスの解析
- base解決順と古い非同期結果の破棄
- snapshotの一括置換と直前の正常値の維持
- 変更一覧からディレクトリツリーへの変換と並び順
- ディレクトリとパネル全体の開閉
- worktreeごとの高さと開閉状態の保存
- `A/M/R/D`に対応する左右buffer計画
- diff windowの再利用と片側終了時のcleanup
- Explorer作成後の差分パネル配置と重複防止

設定全体はheadless Neovimで読み込み、LuaファイルはStyLuaで検査します。

手動スモークテストでは次を確認します。

1. Explorerの下半分へ差分ツリーが表示されます。
2. パネル全体と各ディレクトリを開閉できます。
3. 境界をドラッグして高さを変更できます。
4. Neovim再起動後に開閉状態、高さ、ディレクトリ状態が復元されます。
5. 追加、変更、改名、削除の各ファイルで正しい2画面diffが開きます。
6. 別ファイルを選んでもdiff windowが増えません。
7. 保存、フォーカス復帰、Git操作後に変更一覧が更新されます。
8. Explorerを閉じて再表示すると、差分パネルも同じ列へ復元されます。
9. base解決失敗やバイナリファイルが通常の編集を妨げません。
10. `chezmoi diff`で意図したNeovim設定とドキュメントだけが変更されます。

## 受け入れ条件

- 左ペインだけでbaseとの差分ファイルを階層的に確認できます。
- 差分パネルを1行へ折りたたみ、元の高さへ戻せます。
- 変更ファイルの`Enter`でbase版と作業ツリーの2画面diffが開きます。
- 変更ファイルの`o`で通常の実ファイルを開けます。
- パネル状態がworktree間で混ざりません。
- Git差分の取得に失敗してもExplorerと編集を継続できます。
