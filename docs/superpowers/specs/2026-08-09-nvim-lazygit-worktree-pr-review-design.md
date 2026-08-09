# Neovim LazyGit・worktree・PRレビュー導線設計

## 背景

現在のNeovim設定には、左側に常設するSnacks Explorer、右側へClaude Code・Codex・LazyGitを表示するUtility Dock、OctoによるPRレビュー、worktree pickerがあります。一方、日常のGit操作とPRレビューには次の問題が残っています。

- LazyGitは必要なときだけ開くため、起動直後にリポジトリ状態を確認できません。
- LazyGitのLocal Branchesが目立ち、普段の作業単位であるworktreeを探しにくくなっています。
- LazyGitで見ているworktreeまたはbranchから、そのPRをNeovimでレビューするまでの導線がありません。
- PR一覧、レビュー開始、コメント、suggestionが別々のキープレフィックスへ分散しています。
- Claude Code、Codex、PR画面を閉じた後に、通常表示であるLazyGitへ自動的に戻りません。

この設計は、PR #133で変更されたNeovimキーマップを変更前の状態へ戻したうえで、LazyGitを右Dockの通常表示にします。PRレビューで普段使う操作だけを`<leader>p`へ集約します。現在の`<leader>p`単体のSnacks Pickerは使っていないため削除し、このprefixをPR専用にします。

この仕様は、`2026-08-09-nvim-vscode-workflow-design.md`のうち、Utility Dock、Git Dock、PR表示・レビューに関する記述を更新します。Explorer常設、buffer/window/tabの扱い、検索、AI連携など、その他の設計は変更しません。

## 目標

- GitリポジトリでNeovimを起動したとき、右DockへLazyGitを表示します。
- 起動時のフォーカスはEditorに残し、すぐ編集を始められるようにします。
- LazyGitのside panelではWorktreesをLocal Branchesより先に表示します。
- LazyGitで選択中のworktreeまたはlocal branchから、対応するPRを直接開けるようにします。
- ローカルにbranchがない他者のPRは、リポジトリのPR一覧から選べるようにします。
- PRレビュー操作を`<leader>p`グループへまとめます。
- PR #133で削除・変更された従来キーマップを復元した状態を維持します。
- 重複している`<leader>p`単体のSnacks Pickerマッピングを削除します。
- Claude Code、Codex、PR画面を閉じたとき、LazyGitを右Dockへ復元します。
- 既存のLazyGit操作と、`<leader>p`のSnacks Pickerを除く復元済みNeovimキーマップを壊しません。

## 対象外

- LazyGit本体のUIやLocal Branches機能をforkして変更しません。
- Local Branches、Remotes、Tagsを完全には削除しません。LazyGitで非表示にできない標準panelはWorktreesの後ろのtabとして残します。
- PRの作成、merge、close、ready変更を新しいレビュー導線へ含めません。
- 他者のPRを自動checkoutしたり、新しいworktreeを自動作成したりしません。
- GitHubブラウザ画面でのレビュー機能を置き換えません。LazyGitの既存`G`操作は残します。
- headless Neovim、Gitリポジトリ外、LazyGit未導入環境でDockを強制表示しません。

## 通常レイアウト

Gitリポジトリでの通常レイアウトは次の三領域です。

1. 左: 常設のSnacks Explorer
2. 中央: Editor Group
3. 右: LazyGitを表示するUtility Dock

起動時はExplorerとLazyGitを表示しますが、カーソルはEditorに置きます。`<C-h/j/k/l>`でExplorer、Editor、Dockの間を移動します。

Utility Dockで一度に表示するツールは一つです。表示状態は次のように遷移します。

```text
LazyGit -> Claude Code -> LazyGit
LazyGit -> Codex       -> LazyGit
LazyGit -> PR/Review   -> LazyGit
```

Claude Code、Codex、PR/Reviewを開くとLazyGitを隠します。表示中のツールを閉じると、既存のLazyGit handleを再表示します。プロセスまたはwindowが既に終了している場合だけLazyGitを再生成します。

ユーザーがLazyGit自体を明示的に閉じた場合は、その操作を尊重して直ちに再表示しません。LazyGitを通常表示へ戻すのは、別のDockツールまたはPR画面を閉じた場合です。

## LazyGitのWorktrees中心表示

LazyGitのグローバル設定をchezmoiで管理し、macOSの標準設定場所へ配備します。

```text
~/Library/Application Support/lazygit/config.yml
```

side panelは次の順で構成します。

1. Status
2. Files
3. Worktrees / Local Branches / Remotes / Tags
4. Commits
5. Stash

3番目のpanelはWorktreesを先頭tabにします。Local Branches、Remotes、Tagsは同じpanelの後続tabとして残します。これにより、通常はworktreeを起点に作業しつつ、必要なときは標準branch操作も利用できます。

LazyGit本来のキーは維持します。特に次を上書きしません。

- `Space`: 選択したworktreeへ切り替え
- `n`: worktreeを作成
- `o`: editorで開く
- `d`: worktreeを削除
- `G`: GitHubのPRをブラウザで開く
- `P`: push

## PRレビューのキー体系

PRレビューで普段使う操作は`<leader>p`へ統一します。

`<leader>p`単体に登録されているSnacks Pickerは、`config/keymaps.lua`とSnacks plugin specの両方から削除します。Picker本体と、ファイル・buffer・診断などを直接開く既存キーは残します。復元済みだが読み込まれていない`user/vscode_keymaps.lua`はPR #133以前の内容を維持し、activeな`<leader>p`には単体actionを置かず、WhichKeyでPRグループとして表示します。

| キー | 操作 | 有効な場所 |
|---|---|---|
| `<leader>pp` | リポジトリのPR一覧を開く | Editor、LazyGit、Octo |
| `<leader>po` | 選択中または現在branchのPRを開く | LazyGit、Editor |
| `<leader>pr` | reviewを開始する。pending reviewがあれば再開する | Octo PR buffer、review |
| `<leader>pc` | Visual選択した行へpending commentを追加する | Octo review diff |
| `<leader>ps` | Visual選択した行へpending suggestionを追加する | Octo review diff |
| `<leader>pS` | reviewを確認して送信する | Octo review |
| `<leader>pd` | pending reviewを破棄する | Octo review |
| `<leader>pq` | PR/review画面を閉じてLazyGitへ戻る | Octo PR buffer、review |

`<leader>pr`は開始と再開を一つにまとめます。reviewが存在しない場合は開始し、pending reviewがある場合はそれを再開します。

既存の`<leader>o...` Octoキーマップは互換性のため残します。cheatsheetとWhichKeyでは`<leader>p`を日常の推奨導線として表示します。

LazyGitはterminal applicationであるため、LazyGit bufferだけにterminal-local mappingを設定します。ユーザーが入力するキーは上表と同じ`<leader>p...`にします。選択中のworktreeまたはbranchが必要な操作だけ、terminal-local mappingからLazyGitの非公開custom command triggerへ中継し、LazyGitの選択コンテキストを取得します。

単独の`Space`はLazyGitへそのまま届く必要があります。leader sequenceの判定はNeovimの通常のmapping timeout内だけで行い、`Space`単独のworktree切替、文字入力、既存LazyGitキーを恒久的に奪いません。

## PRを開く処理

### PR一覧

`<leader>pp`は現在のGit repositoryを対象に`Octo pr list`を開きます。ローカルにbranchがない他者のPRはこの一覧から選択します。LazyGitから実行した場合はLazyGitを隠してから一覧を表示します。

### 選択中または現在branchのPR

`<leader>po`は呼び出し元によって対象branchを決めます。

1. LazyGit Worktrees: `SelectedWorktree.Branch`
2. LazyGit Local Branches: `SelectedLocalBranch.Name`
3. その他のLazyGit panelまたはEditor: 現在branch

選択値が空、detached HEADなどでbranchを解決できない場合も現在branchへfallbackします。現在branchも解決できない場合はPRを開かず、理由を通知します。

branch名はshell codeとして組み立てず、bridgeの引数データとして安全に渡します。quote、`$`、括弧などを含むrefでもコマンドとして評価しません。

Neovim側のPR bridgeはrepository rootとbranchを受け取り、`gh pr view <branch> --json number`でPR番号を解決します。PRが見つかった場合は`Octo pr edit <number>`を開きます。見つからない場合は通知し、LazyGitを復元します。PR一覧へ自動fallbackしないことで、選択したbranchとは別のPRを誤ってレビューすることを防ぎます。

bridgeはLazyGitが起動したNeovimの`$NVIM` serverへ処理を依頼します。別のNeovimプロセスへPR画面を開きません。

## PRレビューの操作例

ローカルにない他者のPRをレビューする場合:

```text
nvim .
<leader>pp        PR一覧を開く
j / k, Enter      PRを選択する
<leader>pr        reviewを開始する
Visual選択
<leader>pc        commentを追加する
<leader>ps        suggestionを追加する
<leader>pS        reviewを送信する
<leader>pq        閉じてLazyGitへ戻る
```

既存worktreeのPRを直接レビューする場合:

```text
<C-l>             LazyGitへ移動する
3                 Worktrees panelへ移動する
j / k             worktreeを選択する
<leader>po        選択branchのPRを開く
<leader>pr        reviewを開始する
...
<leader>pq        閉じてLazyGitへ戻る
```

## Dockの状態管理

Dock controllerは表示中のtool、window handle、通常表示を管理します。

- 通常表示: LazyGit
- 一時表示: Claude Code、Codex、PR/Review
- activate: 現在と異なるtoolを隠して、対象toolを表示する
- close temporary: LazyGitをrestoreする
- explicit close LazyGit: 通常表示を停止し、自動restoreしない

同じtoolを再度開く場合は、既存handleへfocusします。Codexなどのプロセスが終了済みなら古いhandleを破棄して再生成します。異なるhandleに同じtool名が付いていても、切替前のhandleを隠してDockが重ならないようにします。

PR一覧、PR buffer、review tabのうち最後のOcto画面を閉じた時点でPR/Reviewの一時表示が終了したと判定します。PR内のbuffer移動だけではLazyGitを復元しません。

## 起動条件とエラー処理

LazyGitの自動表示は次をすべて満たす場合だけ行います。

- UI付きNeovimである
- 現在のworkspaceがGit repository内である
- `lazygit` executableが存在する
- 起動処理がそのrepository rootで未実行である

起動時にLazyGitが失敗してもExplorerとEditorは利用できます。エラーは一度だけ通知し、再起動loopを作りません。

PR操作では次のように処理します。

- `gh`またはOctoを利用できない: 理由を通知してLazyGitへ戻る
- branchに対応するPRがない: 対象branchを通知してLazyGitへ戻る
- `gh`が一時的に失敗する: stderrを短く通知してLazyGitへ戻る
- bridgeからNeovim serverへ接続できない: LazyGit側へ失敗を表示し、Neovimを追加起動しない
- PR一覧が空: Octoの空状態を表示し、閉じたらLazyGitへ戻る

## 配備対象

実装では主に次を変更または追加します。

- chezmoi管理下のLazyGitグローバル設定
- Neovimの起動autocommand
- Utility Dock controller
- LazyGit window生成とterminal-local keymap
- LazyGitからNeovimへPR対象を渡すbridge
- `user.pr_review`のbranch指定、一覧、review操作、restore処理
- Octoのbuffer-local review mapping
- `docs/vim-cheatsheet.md`

LazyGit設定はchezmoi sourceと配備先の両方を検証します。手動で配備先だけを編集しません。

## 検証方針

### 自動検証

- Git repositoryで起動すると、ExplorerとLazyGitの生成処理が一度ずつ呼ばれ、Editorへfocusが残ること
- headless、Git repository外、LazyGit未導入環境では自動表示しないこと
- side panel順がStatus、Files、Worktrees優先group、Commits、Stashであること
- WorktreesとLocal Branchesの選択値を正しいbranchへ変換すること
- 選択値が空の場合とその他のpanelでは現在branchを使用すること
- branch名をshell codeとして評価せず、bridgeへ完全な値を渡すこと
- PR番号を整数として検証してからOcto commandへ渡すこと
- `<leader>pp`からPR一覧、`<leader>po`から対象PRを開くこと
- `<leader>pr/pc/ps/pS/pd/pq`が対応するreview操作を呼ぶこと
- `<leader>p`単体のSnacks Pickerマッピングがなく、PRグループとして登録されること
- PR #133で削除・変更された従来キーマップが、明示した`<leader>p`の例外を除いて復元状態を保つこと
- LazyGit内の`Space`単独操作と既存の`G`、`P`を上書きしないこと
- Claude Code、Codex、PR/Reviewを閉じるとLazyGitをrestoreすること
- 終了済みLazyGit handleだけを再生成すること
- LazyGitを明示的に閉じた場合は即座に再表示しないこと
- LuaをStyLuaでformatでき、Neovimをheadless起動できること

### 手動スモークテスト

1. Git repositoryでNeovimを起動し、左Explorer、中央Editor、右LazyGitが表示されることを確認します。
2. 起動後の入力先がEditorであり、`<C-l>`でLazyGitへ移動できることを確認します。
3. Worktreesが3番目のpanelで最初のtabとして表示され、`Space`でworktreeを切り替えられることを確認します。
4. WorktreesとLocal Branchesで`<leader>po`を実行し、選択branchのPRが開くことを確認します。
5. `<leader>pp`でローカルにない他者のPRを一覧から開けることを確認します。
6. `<leader>pr/pc/ps/pS`でreviewを開始し、commentとsuggestionを追加して送信できることを確認します。
7. `<leader>pq`でPR画面を閉じ、右DockへLazyGitが戻ることを確認します。
8. Claude CodeとCodexを開閉し、同じ位置へLazyGitが戻ることを確認します。
9. LazyGitを明示的に閉じた場合は閉じたままであることを確認します。
10. `chezmoi diff`と`chezmoi apply`後のLazyGit設定が一致することを確認します。

## 完了条件

- Neovim起動時の右DockがLazyGitになっている
- LazyGitがworktree中心のside panel構成になっている
- PR一覧、対象PR、レビュー操作が`<leader>p`へ集約されている
- 他者のPRと既存worktreeのPRの両方をcheckoutせずレビュー開始できる
- Claude Code、Codex、PR/Review終了後にLazyGitへ戻る
- PR #133以前のキーマップが`<leader>p`のSnacks Pickerを除いて維持されている
- LazyGitの標準操作とExplorer常設が維持されている
- 自動検証、headless検証、手動スモークテスト、chezmoi配備検証が完了している
