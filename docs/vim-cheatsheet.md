# Neovim ワークフロー チートシート

> `<leader>` = スペースキー

## 3領域の画面モデル

| 領域 | 役割 |
|---|---|
| Explorer（左） | 常時表示するファイルツリー。ファイル操作とGit状態の確認を行います。幅とフォルダの展開状態はworktreeごとに復元されます。 |
| Editor Group（中央） | ファイルを2〜3個の編集領域に分けて並べます。開いているファイルはBufferlineで確認します。 |
| Utility Dock（右） | Claude Code、Codex、Git、PRのうち一つを表示します。新しいツールを開くと同じ領域を再利用します。 |

## 領域間の移動

Explorer、Editor Group、Utility Dockを含むすべての領域を移動できます。

| キー | 説明 |
|---|---|
| `<C-h>` | 左の領域へ移動 |
| `<C-j>` | 下の領域へ移動 |
| `<C-k>` | 上の領域へ移動 |
| `<C-l>` | 右の領域へ移動 |

## グローバル操作

| キー | 説明 |
|---|---|
| `<leader>e` | Explorerへ移動 |
| `<C-p>` / `<leader>f` | ファイル検索 |
| `<C-S-f>` / `<leader>s` | ファイル横断検索 |
| `<leader>r` | ファイル横断置換（Grug-far） |
| `<leader>w` | worktreeを選択し、対応するcmux workspaceへ移動 |
| `<leader>a` | AI Dockを開く、またはフォーカス |
| `<leader>af` | 現在ファイルをAIへ送る |
| Visualモードの`<leader>as` | 選択範囲をAIへ送る |
| `<leader>g` | Git Dockを開く |
| `<leader>p` | 現在ブランチのPR、またはPR一覧を開く |
| `<leader>\|` / `<leader>-` | 左右 / 上下にEditor Groupを分割 |
| `<leader>bd` | ファイルを閉じる |
| `<leader>wd` | Editor Groupを閉じる |

次のファイル: `<C-Tab>` / `<leader>bn`

前のファイル: `<C-S-Tab>` / `<leader>bp`

端末が`<C-S-f>`、`<C-Tab>`、`<C-S-Tab>`を識別できない場合は、対応する`<leader>`キーを使います。

## Explorer内の操作

Explorerにフォーカスがあるときだけ使えます。

| キー | 説明 |
|---|---|
| `a` | ファイルまたはディレクトリを作成 |
| `r` | 改名 |
| `m` | 移動 |
| `d` | ゴミ箱へ移動 |
| `c` / `p` | コピー / 貼り付け |
| `v` / `s` | 左右 / 上下のEditor Groupで開く |
| `?` | Explorer内のキー一覧を表示 |

## AI Dock内の操作

AI Dockにフォーカスがあるときだけ使えます。Claude CodeとCodexの表示用terminalは一つで、providerごとのセッションはworktree内に保持されます。

| キー | 説明 |
|---|---|
| `p` | Claude CodeとCodexを切り替え |
| `r` | 選択中providerの直近セッションを再開 |

## PRレビュー内の操作

PR bufferまたはレビューbufferにフォーカスがあるときだけ使えます。コメントとsuggestionはpending reviewへ追加され、`S`で確認してから一括送信します。

| キー | 説明 |
|---|---|
| `r` / `R` | PR bufferでレビューを開始 / pending reviewを再開 |
| Visualモードの`c` | 選択行へpendingコメントを追加 |
| Visualモードの`s` | 選択行へsuggestionを追加 |
| `[c` / `]c` | 前 / 次のコメントへ移動 |
| `S` | レビューを確認して送信 |
| `q` | レビューを閉じる。送信画面では送信をキャンセル |

## コード操作

| キー | 説明 |
|---|---|
| `K` | 推論型とドキュメントを表示 |
| `gd` | 定義へ移動 |
| `gr` | 参照を表示 |
| `[d` / `]d` | 前 / 次の診断へ移動 |
| `<leader>ca` | コードアクション |
| `<leader>cr` | シンボル名を変更 |
