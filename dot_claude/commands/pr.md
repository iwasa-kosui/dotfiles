---
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch:*), Bash(git checkout:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(gh pr create:*)
description: Create a draft pull request with conventional commit
---

## Context

- Current branch: !`git branch --show-current`
- Git status: !`git status`

## Your task

You MUST use Japanese.

あなたは必ず日本語を話さなければなりません。

Based on the above context, perform the following steps:

### 1. Analyze Changes

Review the diff and git status to understand what changes have been made.

### 2. Branch Check

If currently on main or master branch:

- Create a new branch with the naming convention `feature/<descriptive-name>`
- The branch name should reflect the changes being made
- Use `git checkout -b feature/<name>` to create and switch to the new branch

### 3. Stage and Commit

If there are uncommitted changes:

- Stage all changes with `git add -A`
- Create a commit using **Conventional Commits** format with a **required scope**:
  - Format: `<type>(<scope>): <description>`
  - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`
  - Scope: A noun describing a section of the codebase (e.g., `auth`, `api`, `ui`, `config`)
  - Examples:
    - `feat(auth): add OAuth2 login support`
    - `fix(api): resolve null pointer in user endpoint`
    - `refactor(ui): simplify button component logic`
  - Include `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>` in the commit body

### 4. Push

Push the branch to origin with upstream tracking:

- Use `git push -u origin <branch-name>`

### 5. Create Draft Pull Request

Create a draft PR using `gh pr create`:

- Use `--draft` flag to create as draft
- Use `--fill` to use the PR template if available
- Format:

  ```
  gh pr create --draft --fill --title "<conventional commit style title>" --body "$(cat <<'EOF'
  ## Summary
  <Brief description of changes>

  ## Changes
  <Bullet points of what was changed>

  ## Test Plan
  - [ ] <Testing steps>

  ---
  Generated with Claude Code
  EOF
  )"
  ```

### Important

- You MUST execute all steps in a single response using parallel tool calls where possible
- Always use conventional commit format with scope
- Always create the PR as a draft
- If a PR template exists in the repository, respect its format
