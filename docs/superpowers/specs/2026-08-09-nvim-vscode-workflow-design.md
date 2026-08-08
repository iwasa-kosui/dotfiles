# Neovim VSCodeライクワークフロー設計

## 背景

現在の設定はLazyVim、Snacks Explorer、Grug-far、Bufferline、Diffview、Octo、claudecode.nvimを導入済みです。必要な機能の大半は揃っていますが、次の問題があります。

- Explorerが必要なときだけ開くため、ファイル構成を常に確認できません。
- LazyVimと各プラグインのグローバルショートカットが併存し、普段使う操作が分かりにくくなっています。
- buffer、window、tab、各種panelの役割が画面から判断しにくく、移動方法も統一されていません。
- worktree pickerは現在のworktreeを先頭にした後、ブランチ名で並べます。Claude CodeやCodexの利用状況は反映しません。
- ExplorerのGit表示は未コミット状態が中心で、PRのbaseブランチから変更されたファイルを判別できません。
- Octoの操作ごとにグローバルショートカットがあり、PRレビューを始めるまでの操作とレビュー中の操作が混在しています。
- Claude Codeとの連携はありますが、Codexと共通の操作体系になっていません。

この設計では既存のLazyVim構成を残し、普段見える画面とグローバル操作を減らします。VSCodeを再現するのではなく、ファイルツリー、複数Editor Group、Utility Dockという分かりやすい画面モデルへ揃えます。

## 目標

- 起動中は左側にファイルツリーを常設します。
- 中央で2〜3個のEditor Groupを日常的に使えるようにします。
- AI、Git、PRを右側のUtility Dockへ集約し、同時に一つだけ表示します。
- グローバルショートカットを主要操作だけに限定します。
- ファイル横断の検索と置換、ファイル作成、移動、改名、削除を迷わず実行できるようにします。
- PRのbaseブランチとの差分と未コミット状態をExplorer上で区別します。
- worktreeごとにNeovim画面を分け、最近使ったworktreeから選べるようにします。
- Claude CodeとCodexへ同じ操作でファイルや選択範囲を渡せるようにします。
- Neovim内でPRのdiffを読み、pendingコメントをまとめて送信できるようにします。
- 推論された型とドキュメントを明示操作で確認できるようにします。

## 対象外

- LazyVimの廃止やLSP、補完、言語設定の再構築は行いません。
- Snacks ExplorerをNeo-treeなどへ置き換えません。
- VSCodeの全ショートカットや全UIを再現しません。
- Claude CodeやCodexの会話履歴を解析しません。
- 複数worktreeのbufferやLSPを一つのNeovimプロセスへ混在させません。
- PRの作成、merge、ready変更など、レビュー以外のGitHub操作へ新しいグローバルキーを追加しません。

## 画面モデル

一つのworktreeを一つのcmux workspaceとNeovimプロセスへ対応させます。worktreeを切り替えるときは、現在のNeovimで`cd`せず、対象のcmux workspaceへ移動します。対象がまだ開かれていない場合だけ新しいworkspaceを作ります。

通常の画面は三つの領域で構成します。

1. 左側のExplorer
   - 常に表示します。
   - ファイル操作とGit状態の確認を担当します。
   - 幅を固定し、Editor Groupの分割で狭くならないようにします。
2. 中央のEditor Group
   - 2〜3個のwindowへファイルを並べて編集できます。
   - Bufferlineは開いているファイルの一覧として表示します。
3. 右側のUtility Dock
   - Claude Code、Codex、Git、PRのうち一つを表示します。
   - 新しいツールを開いたときは同じ領域を再利用します。

用語は次の意味で扱います。

- buffer: 開いているファイル
- window: VSCodeのEditor Groupに相当する編集領域
- tab: PRレビューなどが内部レイアウトを保持するために使用し、日常操作の対象にはしません。
- panel: ExplorerまたはUtility Dock

`Ctrl+h/j/k/l`でExplorer、Editor Group、Utility Dockを含む全領域を移動します。ExplorerとUtility Dockを閉じた場合は同じ位置へ復元できます。ファイルを閉じる操作とEditor Groupを閉じる操作は分離します。

## グローバル操作

Vimの標準編集操作は残します。LazyVimやプラグインが追加するグローバル`<leader>`マッピングは許可リスト方式に切り替えます。プラグインのbuffer-localマッピング、Insertモードの補完操作、Vim標準操作は一括削除しません。

| 操作 | キー |
|---|---|
| Explorerへ移動 | `<leader>e` |
| ファイル検索 | `<C-p>`、`<leader>f` |
| ファイル横断検索 | `<C-S-f>`、`<leader>s` |
| ファイル横断置換 | `<leader>r` |
| worktree選択 | `<leader>w` |
| AI Dock | `<leader>a` |
| Git Dock | `<leader>g` |
| PR表示・レビュー | `<leader>p` |
| 領域間移動 | `<C-h/j/k/l>` |
| 次または前のファイル | `<C-Tab>`、`<C-S-Tab>` |
| 左右または上下分割 | `<leader>\|`、`<leader>-` |
| ファイルを閉じる | `<leader>bd` |
| Editor Groupを閉じる | `<leader>wd` |

コード操作は次に限定します。

- `K`: 推論型とドキュメントを表示
- `gd`: 定義へ移動
- `gr`: 参照を表示
- `<leader>ca`: コードアクション
- `<leader>cr`: シンボル名を変更
- `[d`、`]d`: 前後の診断へ移動

起動後にカーソルを止めたときの自動ホバーは削除します。既存のinlay hintsは残します。

`which-key`には許可したグローバル操作だけを表示します。Explorer、AI Dock、PRレビューのキーは各buffer内だけで有効にし、通常のメニューへ混在させません。

## Explorerと検索置換

Snacks Explorerを起動時に開き、現在のファイルを追跡します。フォルダの開閉状態と幅はworktreeごとに復元します。

Explorer内では次のキーを使用します。

| 操作 | キー |
|---|---|
| ファイルまたはディレクトリを作成 | `a` |
| 改名 | `r` |
| 移動 | `m` |
| ゴミ箱へ移動 | `d` |
| コピー、貼り付け | `c`、`p` |
| 左右、上下のEditor Groupで開く | `v`、`s` |

削除にはSnacks Explorerのtrash設定を使い、直接削除しません。Explorer内のキーは`?`で確認できるようにします。

ファイル検索とファイル横断検索にはSnacks pickerを使います。ファイル横断置換には既に導入済みのGrug-farを使います。検索結果から通常表示、左右分割、上下分割のいずれかで開けるようにします。

## Git状態表示

Explorerではbaseブランチとの差分と未コミット状態を別々に表示します。

- ファイル名の色はbaseブランチとの差分を示します。
- 右端の`M/A/D/R`はHEADに対する未コミット状態を示します。
- baseから追加されたファイル、変更されたファイル、改名されたファイルで色を分けます。
- ファイルシステム上に存在しない削除済みファイルはExplorerへ仮想表示せず、Git Dockで確認します。

baseブランチは次の順で解決します。

1. `gh pr view`が返すPRのbaseブランチ
2. `refs/remotes/origin/HEAD`が示すデフォルトブランチ
3. `origin/main`
4. `origin/master`

base差分はmerge-baseから現在の作業ツリーまでを対象にします。これにより、commit済みのブランチ差分と未コミット差分を含む変更ファイルを判定できます。`git diff`に現れない未追跡ファイルは`git status`の結果を統合し、baseから追加されたファイルとして表示します。未コミット状態の記号も`git status`から別に取得します。

Gitコマンドと`gh`は`vim.system`で非同期実行します。保存、フォーカス復帰、Git操作完了時に更新し、短時間の連続イベントはまとめます。最後に成功した結果をworktree単位でキャッシュします。

## worktreeの活動記録と切替

Claude Code、Codex、Neovimがworktreeを使った時刻だけをXDG state directoryへ記録します。記録項目はworktreeの正規化済みパス、利用元、時刻です。プロンプト、会話、ファイル内容は保存しません。

Claude CodeとCodexでは既存の`SessionStart`フックから共通の記録処理を呼びます。Neovimでは起動時とフォーカス復帰時に記録します。並行書き込みの競合を避けるため、worktreeと利用元ごとに小さなstateファイルを分けます。

pickerは次の順で並べます。

1. 現在のworktree
2. Claude Code、Codex、Neovimの最終活動時刻が新しいworktree
3. 活動記録がないworktreeをブランチ名順

選択後はcmux CLIを使います。

1. `list-workspaces`と`tree`でworkspaceのcwdを取得し、正規化済みcwdが一致するworkspaceを探します。
2. 見つかった場合は`select-workspace`で移動します。
3. 見つからない場合は`new-workspace --cwd <path> --command nvim`で作成します。

workspace名にはリポジトリ名とブランチ名を使います。識別には表示名ではなくcwdを使うため、別リポジトリの同名ブランチと衝突しません。

## AI Dock

AI DockはClaude CodeとCodexを共通の操作で扱います。各providerのセッションはworktree内で個別に保持しますが、表示するterminalは一つだけです。

- `<leader>a`: 最後に使用したproviderを開くかフォーカスします。
- `<leader>af`: 現在ファイルのコンテキストを送ります。
- Visualモードの`<leader>as`: ファイル、選択行、選択範囲を送ります。
- Dock内の`p`: Claude CodeとCodexを切り替えます。
- Dock内の`r`: 選択中providerの直近セッションを再開します。

provider adapterは`path`、`startLine`、`endLine`、`text`を持つ共通コンテキストを受け取ります。Claude Code adapterはclaudecode.nvimの既存コマンドを使います。Codex adapterはSnacks terminalで`codex -C <worktree>`を起動し、共通コンテキストをCodex向けのファイル参照へ変換します。

Claude Codeのdiff承認など、共通化できない操作はDock内だけで有効にします。通常のグローバルショートカットには追加しません。

## PR表示とレビュー

`<leader>p`は現在ブランチのPR概要をOctoで開きます。現在ブランチにPRがない場合はPR一覧を表示します。レビュー開始または再開はPR buffer内の短いbuffer-local操作にします。

レビュー中は次の配置へ切り替えます。

- 左: 常設Explorer
- 中央: base側のdiff
- 右: 変更側のdiff。コメント選択時は同じ領域をコメントスレッドへ切り替えます。
- 下: PRの変更ファイル一覧

Octoの既定マッピングは`mappings_disable_default`で無効にし、レビューbuffer内だけで次を有効にします。

| 操作 | キー |
|---|---|
| 選択行へpendingコメントを追加 | Visualモードの`c` |
| 選択行へsuggestionを追加 | Visualモードの`s` |
| 前後のコメントへ移動 | `[c`、`]c` |
| レビューを確認して送信 | `S` |
| レビューを閉じる | `q` |

コメントとsuggestionはすぐに公開せずpending reviewへ追加します。`S`でpendingコメントを確認し、Comment、Approve、Request changesのいずれかとして一括送信します。レビューを閉じた後は、開始前のEditor Group配置とUtility Dockを復元します。

## エラー処理

- PR情報を取得できない場合はremoteのデフォルトブランチをbaseにします。
- base差分を取得できない場合は未コミット状態だけを表示します。
- cmux CLIを実行できない場合は現在のworktreeを維持し、理由を通知します。現在のNeovimで`cd`するfallbackは設けません。
- AIプロセスが終了した場合は自動再起動せず、Dockから再開できる状態にします。
- 活動時刻のstateファイルを読めない場合はそのファイルを無視します。次回の活動記録で再生成します。
- ExplorerのGit更新が失敗しても、ファイル操作と編集は継続できるようにします。
- `<C-S-f>`や`<C-Tab>`を識別できない端末では、対応する`<leader>`操作を使えます。

## 検証方針

自動検証では次を確認します。

- baseブランチの解決順
- base差分と未コミット状態の解析
- worktreeの活動時刻による並び順
- 同名ブランチを持つ別リポジトリの識別
- Claude CodeとCodex adapterへ渡す共通コンテキスト
- グローバルキーマップが許可リストと一致すること
- Neovimのheadless起動で設定を読み込めること
- StyLuaによるLuaファイルの書式

手動スモークテストでは次を確認します。

1. 起動時にExplorerが開き、Editor Groupを2〜3個へ分割できます。
2. Explorerでファイル作成、移動、改名、ゴミ箱への移動ができます。
3. ファイル検索、ファイル横断検索、ファイル横断置換ができます。
4. base差分の色と未コミット記号が独立して更新されます。
5. worktree pickerが活動時刻順に並び、既存cmux workspaceへ移動します。
6. Claude CodeとCodexを切り替え、現在ファイルと選択範囲を送れます。
7. PRレビューで複数のpendingコメントを追加し、一括送信できます。
8. `K`で型情報を表示でき、自動ホバーが発生しません。
9. `chezmoi diff`で意図した設定だけが変更され、`chezmoi apply`後も同じ動作になります。

## ドキュメント

`docs/vim-cheatsheet.md`は残したグローバル操作と画面別操作だけに更新します。LazyVimの網羅的な既定キー一覧は掲載しません。画面モデル、普段使うキー、Explorer、AI Dock、PRレビューの順で短くまとめます。
