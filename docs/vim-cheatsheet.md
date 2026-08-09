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

## ファイル・検索

| キー | 説明 |
|---|---|
| `<leader>e` | Explorerへ移動 |
| `<leader><leader>` / `<leader>f` | ファイル検索 |
| `<leader>g` | Git管理中のファイルを検索 |
| `<leader>b` | バッファ一覧 |
| `<leader>p` | Snacks Pickerの一覧 |
| `<leader>;` | コマンド履歴 |
| `<leader>D` | 診断一覧 |
| `<leader>T` | LSPシンボル一覧 |
| `gR` | カーソル下の単語をファイル横断検索 |
| `gF` | カーソル下の単語を含むファイル名を検索 |
| `<leader>sr` | ファイル横断検索・置換（Grug-far） |

前のファイル: `H`

次のファイル: `L`

## Git・worktree

| キー | 説明 |
|---|---|
| `<leader>gg` | 右側のUtility DockでLazyGitを開く |
| `<leader>gz` | mainとの差分をDiffviewで開く |
| `<leader>gh` | 現在ファイルの履歴 |
| `<leader>gH` | ブランチ全体の履歴 |
| `<leader>gw` | AIが最近使った順でworktreeを選び、対応するcmux workspaceへ移動 |

## パスのコピー

| キー | 説明 |
|---|---|
| `<leader>cpa` | 絶対パスをコピー |
| `<leader>cpr` | リポジトリからの相対パスをコピー |
| `<leader>cpf` | ファイル名をコピー |

## ウィンドウ・バッファ

| キー | 説明 |
|---|---|
| `<leader>\|` / `<leader>-` | 左右 / 上下にEditor Groupを分割 |
| `<leader>bd` | ファイルを閉じる |
| `<leader>wd` | Editor Groupを閉じる |
| `<leader>M` | マルチカーソルを開始 |

迷ったときは`<leader>`を押して待つと、Which-keyに利用可能なキーが表示されます。

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

## Claude Code・AI Dock

| キー | 説明 |
|---|---|
| `<leader>aa` | Claude Codeを開く / 閉じる |
| `<leader>af` | Claude Codeへフォーカス |
| `<leader>ar` | 直近のClaude Codeセッションを再開 |
| `<leader>aC` | Claude Codeセッションを継続 |
| `<leader>ab` | 現在ファイルをClaude Codeへ追加 |
| Visualモードの`<leader>as` | 選択範囲をClaude Codeへ送る |
| `<leader>aA` / `<leader>ad` | Claude Codeの差分を承認 / 拒否 |
| `<C-,>` | Claude Codeへフォーカス。terminal内では隠す |

### AI Dock内の操作

AI Dockにフォーカスがあるときだけ使えます。Claude CodeとCodexの表示用terminalは一つで、providerごとのセッションはworktree内に保持されます。

| キー | 説明 |
|---|---|
| `p` | Claude CodeとCodexを切り替え |
| `r` | 選択中providerの直近セッションを再開 |

## GitHub・PRレビュー

| キー | 説明 |
|---|---|
| `<leader>gp` | 現在ブランチのPRをブラウザで開く |
| `<leader>opl` / `<leader>opc` | PR一覧 / PR作成 |
| `<leader>opC` / `<leader>opm` | PRをcheckout / merge |
| `<leader>opd` / `<leader>opr` | PR差分 / Ready化 |
| `<leader>ors` / `<leader>orr` | レビュー開始 / 再開 |
| `<leader>orS` / `<leader>ord` | レビュー送信 / 破棄 |
| `<leader>orc` | レビューコメントを表示 |
| `<leader>oca` / `<leader>ocd` | コメント追加 / 削除 |
| `<leader>oil` / `<leader>oic` / `<leader>oie` | Issue一覧 / 作成 / 編集 |
| `<leader>oo` / `<leader>os` | Octo操作一覧 / 検索 |

PR buffer内ではOcto既定のキーマップを使います。`?`で現在のbufferで利用できる操作を確認できます。

## Minuet

| キー | 説明 |
|---|---|
| `<leader>mp` | duet補完を生成 |
| `<leader>ma` | duet補完を適用 |
| `<leader>md` | duet補完を破棄 |

## コード操作

| キー | 説明 |
|---|---|
| `K` | 推論型とドキュメントを表示 |
| `gd` | 定義へ移動 |
| `gr` | 参照を表示 |
| `[d` / `]d` | 前 / 次の診断へ移動 |
| `<leader>ca` | コードアクション |
| `<leader>cr` | シンボル名を変更 |
