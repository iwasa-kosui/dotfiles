# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a personal dotfiles repository managed by **Chezmoi**. It contains configuration files for a macOS development environment, including Neovim (LazyVim), Zsh, Git, tmux, and various CLI tools.

## Chezmoi Conventions

- Files prefixed with `dot_` are deployed without the prefix (e.g., `dot_zshrc` → `~/.zshrc`)
- Files in `dot_config/` are deployed to `~/.config/`
- Apply changes with `chezmoi apply` after editing

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
| Claude Code | `dot_claude/` |
| Tmux | `dot_tmux.conf` |

## Neovim Plugin Architecture

Uses LazyVim with plugins defined in `dot_config/nvim/lua/plugins/`:
- `claudecode.lua` - Claude Code integration
- `git.lua` - Git tools (lazygit, diffview.nvim)
- `plugin.lua` - Snacks, Copilot

Core config in `dot_config/nvim/lua/config/`: `keymaps.lua`, `options.lua`, `autocmds.lua`

## Worktree Workflow

- 既にworktree内でセッションを開始した場合は、新規作成せずそのworktreeで作業を続行する
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
   wt_path=$(git-wt "<ブランチ名>" --nocd)

   # リモートブランチが存在する場合
   git fetch origin <ブランチ名>
   wt_path=$(git-wt "<ブランチ名>" "origin/<ブランチ名>" --nocd)
   ```

3. **settings.local.json の生成**（メインリポジトリへのアクセスを許可）
   ```bash
   mkdir -p "$wt_path/.claude"
   cat > "$wt_path/.claude/settings.local.json" <<EOF
   {"permissions": {"additionalDirectories": ["<メインリポジトリの絶対パス>"]}}
   EOF
   ```

4. **worktreeへ移動**
   ```bash
   cd "$wt_path"
   ```

## Language and Conventions

- **Use Japanese** when communicating with the user
- PR commits follow Conventional Commits format: `<type>(<scope>): <description>`
- PRs are created as drafts with `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`

## Commit Message Rules

- コミットメッセージは変更の「What（何を）」と「Why（なぜ）」を本質的に説明すること
- 「レビューコメントに基づき」「指摘を反映」「フィードバック対応」のような**トリガー（きっかけ）をメッセージにしてはならない**。これらは変更の内容も理由も伝えない
- 良い例: `fix(ogas): descriptionからトリガーワード説明を削除し disable-model-invocation との矛盾を解消`
- 悪い例: `fix: レビューコメントに基づくrunbookスキルと手順書の修正`
- **amend + force pushは絶対にしない**。メッセージを間違えても新しいコミットで対応する

## PR Review Comment Rules

- PRのレビューコメントに返信する際は、必ず `🤖 Claude Code says: ` で本文を開始する
- 修正済みの場合はコミットのSHA1ハッシュを本文に含める（例: `🤖 Claude Code says: 修正しました (e4dcbb406)`）
