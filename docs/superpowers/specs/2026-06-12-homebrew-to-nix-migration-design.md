# Homebrew から Nix への移行 設計ドキュメント

作成日: 2026-06-12

## 目的

macOS 開発環境のパッケージ管理を Homebrew から Nix へ移行し、Homebrew を完全に撤去します。パッケージ構成を flake として宣言的に管理し、世代管理によるロールバックを可能にします。dotfiles の配置管理は引き続き chezmoi が担当し、両者の責務を明確に分離します。

## 決定事項

| 論点 | 決定 |
|---|---|
| 全体アーキテクチャ | nix-darwin + home-manager、chezmoi は dotfiles 管理として継続 |
| GUI アプリ（cask） | Homebrew 完全廃止。nixpkgs にあるものは Nix 管理、無いものは手動管理 |
| 開発ランタイム | mise を継続。mise 本体だけ home-manager で導入 |
| Nix インストーラ | Determinate Nix |
| Nix 化できない 3 ツール | Homebrew なしの代替手段で対応（後述） |
| 移行方式 | 段階的並行運用。検証完了まで Homebrew を残す |

## アーキテクチャ

### リポジトリ構成

chezmoi リポジトリ内に `nix/` ディレクトリを新設し、`.chezmoiignore` に追加して chezmoi の配置対象から除外します。flake はホームディレクトリへ配置せず、ソースディレクトリを直接参照します。

```
nix/
  flake.nix          # inputs: nixpkgs-unstable, nix-darwin, home-manager, determinate
  flake.lock
  darwin.nix         # システム設定: fonts.packages, launchd, システムPATH
  home.nix           # home.packages（CLI + GUI アプリ）
```

適用コマンドは `darwin-rebuild switch --flake ~/.local/share/chezmoi/nix` です。

### flake 構成

Homebrew の「常に最新版」という使用感を維持するため、安定版ブランチではなく以下を採用します。

- `nixpkgs`: `github:NixOS/nixpkgs/nixpkgs-unstable`
- `nix-darwin`: `github:nix-darwin/nix-darwin/master`（nixpkgs を follows）
- `home-manager`: `github:nix-community/home-manager/master`（nixpkgs を follows）
- `determinate`: Determinate 公式 darwin モジュール。Nix 本体の管理を Determinate 側に委ね、nix-darwin の `nix.enable` との競合を回避します

home-manager は nix-darwin のサブモジュールとして統合し、`useGlobalPkgs = true` と `useUserPackages = true` を設定します。`darwin-rebuild switch` 一回でシステムとユーザー環境の両方が更新されます。

### 責務分担

home-manager の `programs.*` は使いません。zsh や git の設定ファイルを生成する機能で、chezmoi が管理する dotfiles と衝突するためです。

| 担当 | 範囲 |
|---|---|
| home-manager | パッケージ導入のみ（`home.packages`） |
| nix-darwin | フォント（`fonts.packages`）、launchd サービス、システム PATH |
| chezmoi | dotfiles 配置（現状維持）、`run_onchange` スクリプトによる `darwin-rebuild switch` 自動実行 |
| mise | 開発ランタイム（node / java / rust / go / python / terraform / aws-cli） |

## パッケージ移行マップ

Brewfile のパッケージは formulae 44 + cask 7 の計 51 項目で、うち 48 項目を nixpkgs（unstable, aarch64-darwin）へ移行します。

### 属性名が Homebrew と異なるもの

| Homebrew | nixpkgs 属性名 | 備考 |
|---|---|---|
| pandoc | `pandoc-cli` | `pandoc` は Haskell ライブラリを指す別物 |
| gnu-sed | `gnused` | ハイフンなし |
| yq | `yq-go` | `yq` は Python 実装の別物 |
| watch | `unixtools.watch` | darwin では watch のみビルドされる |
| sqldef/sqldef/psqldef | `sqldef` | psqldef / mysqldef 等を同梱 |
| ghostty (cask) | `ghostty-bin` | `ghostty` はソースビルド版で darwin 非対応。必ず bin 版を使う |
| 1password-cli (cask) | `_1password-cli` | `nixpkgs.config.allowUnfree = true` が必要 |
| font-hack-nerd-font (cask) | `nerd-fonts.hack` | nix-darwin の `fonts.packages` で導入 |
| session-manager-plugin (cask) | `ssm-session-manager-plugin` | バイナリ名は従来どおり |
| wave (cask) | `waveterm` | |
| postgresql@15 | `postgresql_15` | brew services 未使用のためパッケージ導入のみ |
| jsonnet | `jsonnet` | C++ 実装。Go 実装が必要なら `go-jsonnet` |
| jwt-cli | `jwt-cli` | コマンド名は `jwt` |

カスタム tap 由来の `git-wt`, `ecspresso`, `terraform-ls`, `aerospace` はいずれも同名で nixpkgs に存在します。その他の一般 formulae（actionlint, chezmoi, coreutils, curl, direnv, duckdb, editorconfig-checker, ffmpeg, fzf, gh, ghq, git, git-lfs, graphviz, htop, jq, k6, lazygit, librist, mise, neovim, perl, pre-commit, sheldon, starship, terminal-notifier, tig, tmux, tree, wget, zig）も同名で存在し darwin 対応済みです。

### Nix 化できない 3 ツールの対応

| ツール | 状況 | 対応 |
|---|---|---|
| kotlin-lsp | nixpkgs PR #514623 が未マージ | JetBrains 公式の zip を手動ダウンロードして導入。PR マージ後に nixpkgs へ移行 |
| okta | 2025 年 7 月に upstream が deprecated（最終 v0.10.0） | 廃止。必要になった場合は後継手段を別途検討 |
| openvino | nixpkgs で darwin は broken マーク | `pip install openvino` で代替 |

### Brewfile の go ディレクティブ

`pprofutils` は `go install github.com/felixge/pprofutils/v2/cmd/pprofutils@latest` の直実行に移します。`cmd/go`, `cmd/gofmt` は mise 管理の go に含まれるため不要です。

## 移行フェーズ

### Phase 1: Nix 導入（Homebrew 無変更）

1. Determinate Nix をインストール
2. `nix/` ディレクトリに flake 一式を作成し、`.chezmoiignore` へ `nix/` を追加
3. `darwin-rebuild switch --flake ~/.local/share/chezmoi/nix` を初回実行

この時点で PATH は Homebrew 優位のままです。Nix 側のバイナリは `/run/current-system/sw/bin` と `/etc/profiles/per-user/<user>/bin` に並行して存在します。

### Phase 2: 検証と PATH 切替

1. Nix 管理バイナリの動作確認。GUI アプリ（ghostty, aerospace, waveterm）と依存の重いもの（neovim, tmux, ffmpeg, duckdb）を重点的に確認
2. 問題なければ `dot_zshrc` 先頭の `export PATH="/opt/homebrew/bin:$PATH"` を削除し、nix-darwin が設定する PATH 順序（Nix が Homebrew より先）へ切替
3. 数日の通常利用で問題が出ないことを確認

### Phase 3: Homebrew 撤去

1. `run_once_before_install-packages.sh.tmpl` を Homebrew ブートストラップから Determinate Nix ブートストラップ + `darwin-rebuild switch` へ書き換え
2. kotlin-lsp の手動導入、openvino の pip 移行を実施
3. Homebrew 公式アンインストーラを実行し、残骸の `/opt/homebrew` を削除
4. Brewfile と関連記述（CLAUDE.md の `brew bundle` 等）を削除。Brewfile 削除は復旧手段を保つため最後の独立コミットとする

### Phase 4: 仕上げ

1. `run_onchange_after_darwin-rebuild.sh.tmpl` を追加し、`nix/` 配下の変更時に chezmoi apply から自動で `darwin-rebuild switch` を実行
2. ollama keep-alive スクリプトの launchd 管理を nix-darwin の `launchd.user.agents` へ移行するか検討
3. CLAUDE.md と README のセットアップ手順を Nix 前提に更新

## エラー対応とロールバック

- Phase 2 までは Homebrew が無傷のため、`dot_zshrc` の PATH を戻すだけで復旧できます
- Phase 3 以降も Brewfile が git 履歴に残るため、`brew bundle --file=Brewfile` で再構築できます
- `darwin-rebuild` は世代管理されるため、`darwin-rebuild switch --rollback` でパッケージ構成を直前の世代へ戻せます
- macOS メジャーアップデート後に Nix が壊れた場合は Determinate の `repair` コマンドで修復します

## テスト

各フェーズの完了条件を以下とします。

- Phase 1: `darwin-rebuild switch` が成功し、`nix run nixpkgs#hello` 相当の基本動作と全パッケージのビルド取得が完了している
- Phase 2: `which` で主要コマンドが Nix のパスを指し、シェル起動・neovim 起動・tmux セッション・GUI アプリ起動が正常
- Phase 3: `command -v brew` が空を返し、`/opt/homebrew` が存在せず、全コマンドが引き続き動作する
- Phase 4: クリーンな状態を模した `chezmoi apply` の dry-run でスクリプト連鎖が意図どおり動く
