# Homebrew → Nix 移行 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** macOS のパッケージ管理を Homebrew から nix-darwin + home-manager へ移行し、Homebrew を完全に撤去する。

**Architecture:** chezmoi リポジトリ内の `nix/` に flake を置き、`darwin-rebuild switch --flake` で適用する。home-manager はパッケージ導入のみを担い、dotfiles 配置は chezmoi が継続する。検証完了まで Homebrew を残す段階的並行運用。

**Tech Stack:** Determinate Nix / nixpkgs-unstable / nix-darwin (master) / home-manager (master) / chezmoi

**Spec:** `docs/superpowers/specs/2026-06-12-homebrew-to-nix-migration-design.md`

---

## 実行上の注意

- このリポジトリは chezmoi のソースディレクトリ（`~/.local/share/chezmoi`）であり、作業は worktree（`.wt/docs/nix-migration-plan` 等）で行う。
- マシン状態を変えるコマンド（`darwin-rebuild`、`chezmoi apply`）は worktree のパスをソースに指定して実行する。`darwin-rebuild switch --flake "$PWD/nix"`、`chezmoi apply --source "$PWD"` の形。マージ後はパス指定なしの通常運用に戻る。
- Task 9（Homebrew 撤去）以降は後戻りのコストが上がる。Task 8 までの全検証が通ってから進むこと。
- Task 6 と Task 9 の間には数日の通常利用による検証期間を置く。1 セッションで一気に実行しない。

## File Structure

| ファイル | 操作 | 責務 |
|---|---|---|
| `nix/flake.nix` | 新規 | inputs と darwinConfigurations の定義 |
| `nix/darwin.nix` | 新規 | システム設定: フォント、GUI アプリ、zsh 連携 |
| `nix/home.nix` | 新規 | CLI パッケージ一覧（home.packages のみ） |
| `nix/flake.lock` | 生成 | 依存のピン留め（初回ビルドで生成しコミット） |
| `.chezmoiignore` | 変更 | `nix/` を配置対象から除外、後に Brewfile 行を削除 |
| `dot_zshrc` | 変更 | Homebrew PATH 行の削除 |
| `run_once_before_install-packages.sh.tmpl` | 置換 | Homebrew ブートストラップ → Nix ブートストラップ |
| `run_onchange_after_darwin-rebuild.sh.tmpl` | 新規 | nix/ 変更時の自動 switch |
| `Brewfile` | 削除 | 最終コミットで削除 |
| `CLAUDE.md`, `README.md` | 変更 | セットアップ手順を Nix 前提に更新 |

---

## Phase 1: Nix 導入（Homebrew 無変更）

### Task 1: Determinate Nix のインストール

**Files:** なし（マシン操作のみ）

- [ ] **Step 1: インストーラ実行**

```bash
curl --proto '=https' --tlsv1.2 -sSf -L -o /tmp/nix-install.sh https://install.determinate.systems/nix
sh /tmp/nix-install.sh install --no-confirm
```

Expected: `Nix was installed successfully!` で終了。

- [ ] **Step 2: 動作確認**

新しいシェルを開くか `exec zsh` してから:

```bash
nix --version
nix run nixpkgs#hello
```

Expected: `nix --version` が `nix (Determinate Nix ...)` を含むバージョン文字列を出力し、`hello` が `Hello, world!` を出力する。flakes は Determinate Nix で標準有効のため追加設定は不要。

### Task 2: .chezmoiignore へ nix/ を追加

**Files:**
- Modify: `.chezmoiignore`

- [ ] **Step 1: 編集**

`# Repository management files (should not be deployed to $HOME)` ブロックの `Brewfile` の次の行に追加:

```
nix/
```

- [ ] **Step 2: コミット**

```bash
git add .chezmoiignore
git commit -m "chore(chezmoi): nix/ ディレクトリを配置対象から除外

flake はホームへ配置せず darwin-rebuild --flake でソースディレクトリを
直接参照するため、chezmoi の管理対象から外す。"
```

### Task 3: flake 一式の作成

**Files:**
- Create: `nix/flake.nix`
- Create: `nix/darwin.nix`
- Create: `nix/home.nix`

- [ ] **Step 1: nix/flake.nix を作成**

```nix
{
  description = "kosui's macOS system configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin = {
      url = "github:nix-darwin/nix-darwin/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    home-manager = {
      url = "github:nix-community/home-manager/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    determinate.url = "https://flakehub.com/f/DeterminateSystems/determinate/*";
  };

  outputs = { self, nixpkgs, nix-darwin, home-manager, determinate, ... }: {
    darwinConfigurations."Kosuis-MacBook-Pro" = nix-darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      modules = [
        determinate.darwinModules.default
        ./darwin.nix
        home-manager.darwinModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.users.kosui = import ./home.nix;
          home-manager.backupFileExtension = "hm-bak";
        }
      ];
    };
  };
}
```

- [ ] **Step 2: nix/darwin.nix を作成**

```nix
{ pkgs, ... }:
{
  nixpkgs.hostPlatform = "aarch64-darwin";
  nixpkgs.config.allowUnfree = true; # vscode, _1password-cli

  system.stateVersion = 6;
  system.primaryUser = "kosui";
  users.users.kosui.home = "/Users/kosui";

  # /etc/zshrc に Nix の PATH 設定を書き込ませる
  programs.zsh.enable = true;

  fonts.packages = [ pkgs.nerd-fonts.hack ];

  # GUI アプリは /Applications/Nix Apps に配置されるよう systemPackages で導入
  environment.systemPackages = with pkgs; [
    aerospace
    ghostty-bin # ghostty はソースビルド版で darwin 非対応
    vscode
    waveterm
  ];
}
```

- [ ] **Step 3: nix/home.nix を作成**

```nix
{ pkgs, ... }:
{
  home.stateVersion = "26.05";

  home.packages = with pkgs; [
    _1password-cli # コマンド名は op
    actionlint
    age
    aws-vault
    chezmoi
    codex
    coreutils-prefixed # Homebrew coreutils と同じ g 接頭辞 (gls, gcat...)
    curl
    deck
    direnv
    duckdb
    ecspresso
    editorconfig-checker
    fd
    ffmpeg
    fzf
    gh
    ghq
    git
    git-lfs
    git-wt
    graphviz
    htop
    imagemagick
    jq
    jsonnet
    jwt-cli # コマンド名は jwt
    k6
    lazygit
    lftp
    librist
    llvmPackages_20.lld
    mise
    neovim
    pandoc-cli # pandoc はライブラリの別物
    perl
    pkgconf
    poppler-utils # pdftotext 等。poppler はライブラリのみ
    postgresql_15
    pre-commit
    python3Packages.grip # トップレベル grip は CD リッパーの別物
    qrencode
    ripgrep # the_silver_searcher (ag) は upstream 開発停止のため代替
    rtk
    sheldon
    silicon
    sqldef # psqldef / mysqldef を同梱
    ssm-session-manager-plugin
    starship
    terminal-notifier
    terraform-ls
    tig
    tmux
    tree
    ttyd
    unixtools.watch
    wget
    yq-go # mikefarah/yq (Go 版)
    yubikey-manager # コマンド名は ykman
    zig
  ];
}
```

注意: Brewfile にあった `gnu-sed` は導入しない。dotfiles に `gsed` の参照が無く未使用であることを確認済み。nixpkgs の `gnused` は接頭辞なしの `sed` を提供し、BSD sed 前提の `sed -i ''` を壊すため、必要になった時点で影響を確認して追加する。

- [ ] **Step 4: ビルドで検証（switch はまだしない）**

```bash
cd <worktree>
nix build "./nix#darwinConfigurations.Kosuis-MacBook-Pro.system" --no-link
```

Expected: 初回は大量のダウンロードの後、エラーなく終了する。属性名の誤りがあれば `error: attribute '...' missing` で落ちるので、その場合は spec の移行マップと照合して修正する。

- [ ] **Step 5: flake.lock を含めてコミット**

```bash
git add nix/flake.nix nix/darwin.nix nix/home.nix nix/flake.lock
git commit -m "feat(nix): nix-darwin + home-manager の flake を追加

Brewfile の全パッケージと Brewfile 外のインストール済みツールを
nixpkgs (unstable) へ移行する宣言的構成。dotfiles 配置は chezmoi が
継続するため home-manager は home.packages のみを使う。"
```

### Task 4: darwin-rebuild 初回実行

**Files:** なし（マシン操作のみ）

- [ ] **Step 1: 初回 switch**

```bash
cd <worktree>
sudo nix run nix-darwin/master#darwin-rebuild -- switch --flake "$PWD/nix"
```

Expected: `activating system...` 等の出力の後、エラーなく終了。`/run/current-system` が生成される。

- [ ] **Step 2: 確認**

```bash
ls /run/current-system/sw/bin/darwin-rebuild
ls "/Applications/Nix Apps"
```

Expected: `darwin-rebuild` が存在し、`Nix Apps` に AeroSpace / Ghostty / Visual Studio Code / Wave の .app が並ぶ。

## Phase 2: 検証と PATH 切替

### Task 5: Nix バイナリの一括検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 検証スクリプトを作成して実行**

この時点では PATH が Homebrew 優位のままなので、Nix のプロファイルパスを直接確認する:

```bash
cat > /tmp/verify-nix-bins.sh <<'EOF'
#!/bin/bash
set -u
dirs=("/etc/profiles/per-user/kosui/bin" "/run/current-system/sw/bin")
cmds=(op actionlint age aws-vault chezmoi codex gls curl deck direnv duckdb
  ecspresso editorconfig-checker fd ffmpeg fzf gh ghq git git-lfs git-wt dot
  htop magick jq jsonnet jwt k6 lazygit lftp lld mise nvim pandoc perl
  pkgconf pdftotext psql pre-commit grip qrencode rg rtk sheldon silicon
  psqldef session-manager-plugin starship terminal-notifier terraform-ls
  tig tmux tree ttyd watch wget yq ykman zig
  aerospace ghostty code)
fail=0
for c in "${cmds[@]}"; do
  found=""
  for d in "${dirs[@]}"; do
    [ -x "$d/$c" ] && found="$d/$c" && break
  done
  if [ -n "$found" ]; then
    echo "OK   $c -> $found"
  else
    echo "MISS $c"
    fail=1
  fi
done
exit $fail
EOF
bash /tmp/verify-nix-bins.sh
```

Expected: 全行 `OK` で exit 0。`MISS` が出たらパッケージ名と提供バイナリ名を `nix eval` や https://search.nixos.org で確認して home.nix を修正し、`darwin-rebuild switch --flake "$PWD/nix"` を再実行する。

- [ ] **Step 2: GUI アプリの起動確認**

```bash
open "/Applications/Nix Apps/Ghostty.app"
open "/Applications/Nix Apps/Wave.app"
```

Expected: 両アプリが起動する。AeroSpace は常駐中の Homebrew 版と競合するためここでは起動せず、Task 6 の後に切り替える。

- [ ] **Step 3: 動作の重いツールの実機能確認**

```bash
/etc/profiles/per-user/kosui/bin/nvim --version | head -1
/etc/profiles/per-user/kosui/bin/ffmpeg -version | head -1
/etc/profiles/per-user/kosui/bin/duckdb -c "select 1;"
/etc/profiles/per-user/kosui/bin/tmux -V
```

Expected: いずれもバージョン文字列または `1` を出力してエラーなく終了。

### Task 6: PATH 切替

**Files:**
- Modify: `dot_zshrc:1`

- [ ] **Step 1: dot_zshrc の Homebrew PATH 行を削除**

1 行目の以下を削除する:

```bash
export PATH="/opt/homebrew/bin:$PATH"
```

- [ ] **Step 2: 適用と確認**

```bash
chezmoi apply --source "$PWD" ~/.zshrc
exec zsh -l
echo "$PATH" | tr ':' '\n' | head -8
command -v git nvim tmux rtk mise
```

Expected: PATH の先頭グループに `/etc/profiles/per-user/kosui/bin` と `/run/current-system/sw/bin` が `/opt/homebrew/bin` より前に並び、各コマンドが Nix のパスを指す。

- [ ] **Step 3: AeroSpace を Nix 版へ切り替え**

```bash
pkill -x AeroSpace || true
open "/Applications/Nix Apps/AeroSpace.app"
```

Expected: AeroSpace が起動し、アクセシビリティ権限の再付与を求められたらシステム設定で許可する。`aerospace reload-config` が成功する。

- [ ] **Step 4: コミット**

```bash
git add dot_zshrc
git commit -m "feat(zsh): PATH の Homebrew 優先を廃止し Nix 管理へ切替

nix-darwin が /etc/zshrc で設定する PATH 順序（Nix が先）を
dot_zshrc の先頭で上書きしないようにする。"
```

- [ ] **Step 5: 検証期間ゲート（手動）**

数日の通常利用で問題が出ないことを確認してから Phase 3 へ進む。確認観点: シェル起動、neovim プラグイン群、tmux セッション、ghostty / aerospace の常用、git 操作、mise のランタイム切替。問題が出た場合は `dot_zshrc` の PATH 行を戻すだけで Homebrew 運用へ復帰できる。

## Phase 3: Homebrew 撤去

### Task 7: Nix 化できないツールの代替導入

**Files:** なし（マシン操作のみ）

- [ ] **Step 1: go install 系の導入**

```bash
go install github.com/felixge/pprofutils/v2/cmd/pprofutils@latest
go install github.com/k1LoW/mo@latest
go install github.com/Songmu/laminate/cmd/laminate@latest
ls "$(go env GOPATH)/bin"
```

Expected: 3 バイナリが `$(go env GOPATH)/bin` に並ぶ。laminate の main パッケージ位置が異なる場合は `go install github.com/Songmu/laminate@latest` を試す。

- [ ] **Step 2: go bin の PATH を確認**

```bash
command -v pprofutils mo laminate
```

Expected: 3 つとも解決する。解決しない場合は `dot_zshrc` の `$HOME/.local/bin` 行の直後に `export PATH="$HOME/go/bin:$PATH"` を追加し、`chezmoi apply --source "$PWD" ~/.zshrc` 後にコミットする:

```bash
git add dot_zshrc
git commit -m "feat(zsh): go install したツール用に ~/go/bin を PATH へ追加"
```

- [ ] **Step 3: kotlin-lsp の手動導入**

```bash
mkdir -p ~/.local/share/kotlin-lsp ~/.local/bin
gh release download --repo Kotlin/kotlin-lsp --pattern '*.zip' --dir /tmp
unzip -o /tmp/kotlin-lsp-*.zip -d ~/.local/share/kotlin-lsp
ln -sf ~/.local/share/kotlin-lsp/kotlin-lsp.sh ~/.local/bin/kotlin-lsp
kotlin-lsp --version
```

Expected: バージョンが表示される。zip 内の起動スクリプト名が異なる場合は `ls ~/.local/share/kotlin-lsp` で実体を確認してリンクし直す。nixpkgs PR #514623 がマージされたら home.nix へ移行する。

- [ ] **Step 4: openvino の pip 導入**

```bash
pip install openvino
python -c "import openvino; print(openvino.__version__)"
```

Expected: バージョンが表示される。mise 管理の python に紐づくため、python のメジャー更新時は再インストールが必要。

### Task 8: ブートストラップスクリプトの書き換え

**Files:**
- Delete: `run_once_before_install-packages.sh.tmpl`
- Create: `run_once_before_install-nix.sh.tmpl`

- [ ] **Step 1: 新スクリプトを作成し旧スクリプトを削除**

`run_once_before_install-nix.sh.tmpl`:

```bash
#!/bin/bash
{{ if eq .chezmoi.os "darwin" -}}
set -euo pipefail

# Determinate Nix が無ければインストール
if ! command -v nix &> /dev/null && [ ! -x /nix/var/nix/profiles/default/bin/nix ]; then
  echo "Installing Determinate Nix..."
  curl --proto '=https' --tlsv1.2 -sSf -L -o /tmp/nix-install.sh https://install.determinate.systems/nix
  sh /tmp/nix-install.sh install --no-confirm
fi

# nix-daemon の環境を読み込む（インストール直後のシェル向け）
if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
  . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
fi

# nix-darwin が未適用ならブートストラップ
if ! command -v darwin-rebuild &> /dev/null; then
  echo "Bootstrapping nix-darwin..."
  sudo nix run nix-darwin/master#darwin-rebuild -- switch --flake "{{ .chezmoi.sourceDir }}/nix"
fi
{{ end -}}
```

```bash
git rm run_once_before_install-packages.sh.tmpl
git add run_once_before_install-nix.sh.tmpl
```

- [ ] **Step 2: dry-run で確認**

```bash
chezmoi apply --source "$PWD" --dry-run --verbose 2>&1 | head -30
```

Expected: 新スクリプトが run_once として認識される。実行しても全ガードが効いて no-op になる（nix も darwin-rebuild も導入済みのため）。

- [ ] **Step 3: コミット**

```bash
git commit -m "feat(chezmoi): ブートストラップを Homebrew から Determinate Nix へ変更

新規マシンのセットアップで brew bundle の代わりに Nix のインストールと
nix-darwin の初回 switch を行う。"
```

### Task 9: Homebrew のアンインストール

**Files:** なし（マシン操作のみ）

- [ ] **Step 1: 最終棚卸し**

```bash
brew leaves | sort > /tmp/final-leaves.txt
brew list --cask > /tmp/final-casks.txt
cat /tmp/final-leaves.txt /tmp/final-casks.txt
```

Expected: 全項目が spec の移行マップ（nixpkgs 移行・代替手段・廃止のいずれか）に載っている。載っていないものが新たに増えていたら、home.nix へ追加して switch してから先へ進む。

- [ ] **Step 2: Nix 版へ置換済みの cask をアンインストール**

/Applications に旧 app が残って Nix Apps と二重になるのを防ぐ。rancher（継続利用、手動管理へ移行）は残す:

```bash
/opt/homebrew/bin/brew uninstall --cask 1password-cli aerospace codex font-hack-nerd-font ghostty okta session-manager-plugin visual-studio-code wave
```

Expected: 各 cask が削除される。VS Code の設定・拡張は `~/Library` 配下にあるため消えない。

- [ ] **Step 3: アンインストーラ実行**

```bash
curl -fsSL -o /tmp/brew-uninstall.sh https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh
/bin/bash /tmp/brew-uninstall.sh
sudo rm -rf /opt/homebrew
```

Expected: スクリプトが完了し、`/opt/homebrew` が消える。

- [ ] **Step 4: 動作確認**

```bash
exec zsh -l
command -v brew || echo "brew is gone"
bash /tmp/verify-nix-bins.sh
nvim --version | head -1
aerospace list-workspaces --all
```

Expected: `brew is gone`、検証スクリプトが全 `OK`、nvim と aerospace が動作する。

### Task 10: Brewfile 削除とドキュメント更新

**Files:**
- Delete: `Brewfile`
- Modify: `.chezmoiignore`（`Brewfile` 行を削除）
- Modify: `CLAUDE.md`（Commands と Repository Overview の Homebrew 記述）
- Modify: `README.md`（セットアップ手順に Homebrew 記述があれば）

- [ ] **Step 1: CLAUDE.md の更新**

Commands セクションの以下を:

```bash
# Install packages (Homebrew)
brew bundle
```

次に置き換える:

```bash
# Apply system & package configuration (nix-darwin + home-manager)
sudo darwin-rebuild switch --flake ~/.local/share/chezmoi/nix
```

Repository Overview の `including Neovim (LazyVim), Zsh, Git, tmux, and various CLI tools` 周辺に Homebrew への言及があれば Nix に改める。

- [ ] **Step 2: README.md の確認と更新**

```bash
grep -n -i "brew" README.md
```

ヒットした箇所を Nix のセットアップ手順（`chezmoi apply` がブートストラップスクリプト経由で Nix を導入する旨）に書き換える。ヒットしなければ変更不要。

- [ ] **Step 3: Brewfile の削除（独立コミット）**

```bash
git rm Brewfile
```

`.chezmoiignore` から `Brewfile` の行を削除する。

- [ ] **Step 4: コミット（2 つに分割）**

```bash
git add CLAUDE.md README.md
git commit -m "docs: セットアップ手順を Homebrew から Nix 前提に更新"
git add .chezmoiignore
git commit -m "chore: Brewfile を削除し Nix への移行を完了

パッケージ定義は nix/home.nix と nix/darwin.nix に一本化した。
復旧が必要な場合はこのコミット以前の Brewfile を git 履歴から取得して
brew bundle で再構築できる。"
```

## Phase 4: 仕上げ

### Task 11: nix/ 変更時の自動 switch スクリプト

**Files:**
- Create: `run_onchange_after_darwin-rebuild.sh.tmpl`

- [ ] **Step 1: スクリプト作成**

```bash
#!/bin/bash
{{ if eq .chezmoi.os "darwin" -}}
# nix config hash:
# flake: {{ include "nix/flake.nix" | sha256sum }}
# lock: {{ include "nix/flake.lock" | sha256sum }}
# darwin: {{ include "nix/darwin.nix" | sha256sum }}
# home: {{ include "nix/home.nix" | sha256sum }}
set -euo pipefail

if command -v darwin-rebuild &> /dev/null; then
  echo "Nix configuration changed, running darwin-rebuild switch..."
  sudo darwin-rebuild switch --flake "{{ .chezmoi.sourceDir }}/nix"
fi
{{ end -}}
```

注意: `darwin-rebuild switch` は root 権限が必要なため、`chezmoi apply` 時に sudo パスワードを求められる。

- [ ] **Step 2: dry-run で確認**

```bash
chezmoi apply --source "$PWD" --dry-run --verbose 2>&1 | grep -A2 darwin-rebuild
```

Expected: スクリプトが run_onchange として実行対象に挙がる。

- [ ] **Step 3: コミット**

```bash
git add run_onchange_after_darwin-rebuild.sh.tmpl
git commit -m "feat(chezmoi): nix/ 変更時に darwin-rebuild switch を自動実行

flake と各モジュールのハッシュを埋め込み、変更があった apply 時のみ
switch が走るようにする。"
```

### ollama keep-alive の launchd 移行について（spec Phase 4 の検討事項）

移行しない。ollama 本体が Nix 管理外（公式インストーラ、`/usr/local/bin/ollama`）のため、LaunchAgent だけを nix-darwin の `launchd.user.agents` へ移すと管理が分断される。現行の chezmoi 管理（plist + `run_onchange_after_ollama-keep-alive.sh.tmpl`）を維持し、将来 ollama を nixpkgs へ移す機会があれば併せて移行する。

### Task 12: PR 作成

**Files:** なし

- [ ] **Step 1: 文体検査**

```bash
grep -nE "(上界|表化|織り込|達成目標|設計の天井|に倒れる|として乗る|硬化|の鍵|羅針盤|銀の弾丸)" CLAUDE.md README.md
grep -rnE "(である|であった|だった|ではない|だ)。" CLAUDE.md README.md
```

Expected: ヒットなし（ヒットしたら communication-style ルールに従い修正）。

- [ ] **Step 2: PR 作成**

pr スキルを使い、Draft PR を作成する。本文は「背景／内容／論点」構成。論点には以下を含める:

- gnu-sed を意図的に導入していないこと（gsed 未使用、GNU sed の shadowing 回避）
- the_silver_searcher → ripgrep への代替
- okta CLI の廃止（upstream deprecated）
- rancher / kotlin-lsp / openvino が Nix 管理外であること

---

## 完了条件（spec のテスト節との対応）

- Phase 1: Task 3 Step 4 のビルド成功 + Task 4 の switch 成功
- Phase 2: Task 5 の検証スクリプト全 OK + Task 6 Step 2 の PATH 確認
- Phase 3: Task 9 Step 4 で `command -v brew` が空 + `/opt/homebrew` 不在 + 全コマンド動作
- Phase 4: Task 8 Step 2 / Task 11 Step 2 の dry-run でスクリプト連鎖が確認できること
