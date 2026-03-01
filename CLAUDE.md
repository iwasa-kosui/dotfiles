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

- セッション開始時に SessionStart hookが `git-wt` でworktreeを自動作成する
- hookの出力にworktreeパスが含まれている場合、最初のアクションとして `cd <worktreeパス>` を実行すること
- 以降のすべてのファイル操作（Read, Edit, Write, Glob, Grep等）はworktree内の絶対パスを使用すること
- セッション終了後のworktree削除は `git wt -d <ブランチ名>` で手動管理

## Language and Conventions

- **Use Japanese** when communicating with the user
- PR commits follow Conventional Commits format: `<type>(<scope>): <description>`
- PRs are created as drafts with `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`
