# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Repository Overview

This is a personal dotfiles repository managed by **Chezmoi**. It contains configuration files for a macOS development environment, including Neovim (LazyVim), Zsh, Git, tmux, and various CLI tools.

## Chezmoi Conventions

- Files prefixed with `dot_` are deployed without the prefix (e.g., `dot_zshrc` → `~/.zshrc`)
- Files in `dot_config/` are deployed to `~/.config/`
- Apply changes with `chezmoi apply` after editing

## Chezmoi Integration

- Deploy dotfiles and skills through chezmoi after creation
- When modifying dotfiles-managed files, use chezmoi apply workflow

## Commands

```bash
# Install packages (Homebrew)
brew bundle

# Apply dotfiles to home directory
chezmoi apply

# Preview changes before applying
chezmoi diff
```

## Key Configuration Locations

| Tool | Config Path |
|------|-------------|
| Neovim | `dot_config/nvim/` (LazyVim-based) |
| Zsh | `dot_zshrc`, `dot_config/zsh/` |
| Git | `dot_gitconfig`, `dot_config/git/` |
| Codex | `dot_codex/` |
| Cursor | `dot_cursor/` → `~/.cursor/`（rules, hooks, skills, cli-config） |
| Tmux | `dot_tmux.conf` |
| cmux | `dot_config/cmux/` |

## Neovim Plugin Architecture

Uses LazyVim with plugins defined in `dot_config/nvim/lua/plugins/`:
- `claudecode.lua` - Claude Code integration
- `git.lua` - Git tools (lazygit, diffview.nvim)
- `plugin.lua` - Snacks, Copilot
- `minuet.lua` - ollama (qwen2.5-coder) によるローカルコード補完を blink.cmp に統合

Core config in `dot_config/nvim/lua/config/`: `keymaps.lua`, `options.lua`, `autocmds.lua`

## Worktree Workflow

- 既にworktree内でセッションを開始した場合は、新規作成せずそのworktreeで作業を続行する
- 読み取り専用を含むすべての新しいタスクで、mainのworktreeを使わず専用worktreeを作成する
- worktree作成後もセッションの既定cwdは自動では変わらない。各シェルコマンド内でworktreeへの移動を明示し、ファイル操作にはworktreeの絶対パスを使用する
- 以降のすべてのファイル操作（Read, Edit, Write, Glob, Grep等）はworktree内の絶対パスを使用すること
- セッション終了後のworktree削除は `git wt -d <ブランチ名>` で手動管理

### Worktree作成手順（セッション開始時にworktreeが未作成の場合）

ユーザーの最初のプロンプトを分析して、以下の手順でworktreeを作成する:

1. **ブランチ名の決定**
   - プロンプトの内容からConventional Commits風のブランチ名を推定する（例: `fix/nvim-keymap-conflict`, `feat/add-tmux-plugin`）
   - PRのURLが含まれている場合は `gh pr view <URL> --json headRefName` でブランチ名を取得し、そのリモートブランチをチェックアウトする
   - 既存の実装や既知のブランチに言及している場合は `git branch -r` で該当するリモートブランチを探す
   - ブランチ名に迷う場合はユーザーに確認する。ユーザーが空の応答を返した場合は、次のプロンプトまで何もせず待機する

2. **Worktree作成**
   ```bash
   # 新規ブランチの場合
   git-wt "<ブランチ名>" --nocd

   # リモートブランチが存在する場合
   git fetch origin <ブランチ名>
   git-wt "<ブランチ名>" "origin/<ブランチ名>" --nocd
   ```

   コマンドが返したworktreeの絶対パスを記録し、以後は `<worktreeの絶対パス>` として明示的に使用する。シェル変数は別のツール呼び出しに引き継がれないため、後続処理を `wt_path` に依存させない。

3. **settings.local.json の生成**（メインリポジトリへのアクセスを許可）
   ```bash
   mkdir -p "<worktreeの絶対パス>/.Codex"
   cat > "<worktreeの絶対パス>/.Codex/settings.local.json" <<EOF
   {"permissions": {"additionalDirectories": ["<メインリポジトリの絶対パス>"]}}
   EOF
   ```

4. **以後のツール呼び出しをworktreeへ固定**
   - シェルコマンドは毎回 `cd "<worktreeの絶対パス>" && <command>` として、同じ呼び出し内でworktreeへ移動する。Gitコマンドは `git -C "<worktreeの絶対パス>" <subcommand>` でもよい
   - ツールが作業ディレクトリの指定に対応している場合も、worktreeの絶対パスを指定する
   - Read、Edit、Write、Glob、Grep、apply_patch等では、worktree配下の絶対パスを使用する
   - `cd` だけの呼び出しに依存しない。シェル呼び出しは別プロセスで実行され、前回のcwdを引き継がない
   - 最初の作業前に次を実行し、両方がworktreeの絶対パスを示すことを確認する
   ```bash
   cd "<worktreeの絶対パス>" && pwd
   git -C "<worktreeの絶対パス>" rev-parse --show-toplevel
   ```

## Language and Conventions

- **Use Japanese** when communicating with the user
- PR commits follow Conventional Commits format: `<type>(<scope>): <description>`
- PRs are created as drafts with a `Co-Authored-By` trailer naming the model that is actually running. Do not hardcode a version (see `dot_codex/skills/pr/SKILL.md`)

## GitHub CLI Usage

- ユーザーが `gh` コマンドを使えると言っている場合、またはリポジトリの運用ルール・スキルが `gh` の使用を前提としている場合は、`gh auth status` の失敗だけで `gh` 全体を使えないと判断しない。
- `gh auth status` が token invalid などを返しても、まず目的の `gh` コマンド（例: `gh pr create`, `gh pr view`, `gh pr edit`）を実行する。目的のコマンド自体が失敗した場合にだけ、認証や代替手段を検討する。
- PR作成・更新では、GitHubコネクタやWeb APIへ迂回する前に、原則として `gh pr create` / `gh pr edit` を試す。

## Commit Message Rules

- コミットメッセージは変更の「What（何を）」と「Why（なぜ）」を本質的に説明すること
- 「レビューコメントに基づき」「指摘を反映」「フィードバック対応」のような**トリガー（きっかけ）をメッセージにしてはならない**。これらは変更の内容も理由も伝えない
- 良い例: `fix(ogas): descriptionからトリガーワード説明を削除し disable-model-invocation との矛盾を解消`
- 悪い例: `fix: レビューコメントに基づくrunbookスキルと手順書の修正`
- **amend + force pushは絶対にしない**。メッセージを間違えても新しいコミットで対応する

## PR Review Comment Rules

PRのレビューコメントに返信する際は、エージェントの発言全体を引用記法で囲む。修正済みの場合はコミットのSHA1ハッシュを本文に含める。

```markdown
> 🤖 <実行中のエージェント名>
>
> 修正しました (e4dcbb406)
```

`> 🤖 <実行中のエージェント名>` の行以降は、空行を含めてすべて行頭を `>` にする。署名行より上は引用の外なので、ユーザーが自分のコメントを追記する場合はそこに置く。
