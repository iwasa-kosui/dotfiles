---
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch:*), Bash(git checkout:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(gh pr create:*), Bash(gh pr edit:*), Bash(gh pr view:*), Bash(cat *), Bash(find *pull_request_template*), Bash(find *.github*), Bash(ls *)
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

### 2. Check for Existing PR

Check if a PR already exists for the current branch:

```bash
gh pr view --json number,title,body 2>/dev/null
```

If a PR already exists, skip to **Step 7 (Update Existing PR)**.

### 3. Branch Check

If currently on main or master branch:

- Create a new branch with the naming convention `feature/<descriptive-name>`
- The branch name should reflect the changes being made
- Use `git checkout -b feature/<name>` to create and switch to the new branch

### 4. Stage and Commit

If there are uncommitted changes:

- Stage changes by adding specific files by name (do NOT use `git add -A` to avoid accidentally staging sensitive files like `.env`)
- Create a commit using **Conventional Commits** format with a **required scope**:
  - Format: `<type>(<scope>): <description>`
  - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`
  - Scope: A noun describing a section of the codebase (e.g., `auth`, `api`, `ui`, `config`)
  - Examples:
    - `feat(auth): add OAuth2 login support`
    - `fix(api): resolve null pointer in user endpoint`
    - `refactor(ui): simplify button component logic`
  - Include `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>` in the commit body

### 5. Push

Push the branch to origin with upstream tracking:

- Use `git push -u origin <branch-name>`

### 6. Create Draft Pull Request

#### 6a. Check for PR Template

Search for a pull request template in the repository:

```bash
find . -maxdepth 3 \( -iname '*pull_request_template*' \) 2>/dev/null | head -20
```

If a template is found, read its contents and **strictly follow the template structure**. Fill in each section of the template appropriately. Do NOT ignore, skip, or rearrange any section of the template.

#### 6b. Write the PR Description

Whether using a template or not, follow these rules for writing the PR body:

- **Focus on Why and What**: Explain the motivation (why this change is needed) and the approach/decisions (what was decided and why), NOT a line-by-line diff summary
- **Be declarative and concise**: State the intent and design decisions clearly
- **Do NOT rehash the diff**: Reviewers can read the diff themselves. Describe the high-level purpose, key decisions, and anything non-obvious
- Good example: "neverthrow導入時にResult型のネストが発生していたため、flatMap統一方針に切り替え"
- Bad example: "auth.tsのlogin関数のreturn文をResultAsyncに変更し、error.tsのMapErrorを削除し..."

#### 6c. Create the PR

If a PR template was found, use it as the body structure. Otherwise use the default format:

```bash
gh pr create --draft --title "<conventional commit style title>" --body "$(cat <<'EOF'
## Why

<Why this change is needed - motivation and context>

## What

<What approach was taken and key decisions>

## Test Plan

- [ ] <Testing steps>

---
Generated with Claude Code
EOF
)"
```

**Skip to End after creating the PR.**

### 7. Update Existing PR

If a PR already exists for this branch:

1. Stage, commit, and push any uncommitted changes (same as Steps 4-5)
2. Re-analyze all commits on the branch (`git log` and `git diff` against base branch) to understand the full scope of changes
3. Check for a PR template (same as Step 6a) and follow it if found
4. Rewrite the PR title and description based on the current state of all changes, following the same Why/What rules as Step 6b
5. Update the PR:

```bash
gh pr edit --title "<updated title>" --body "$(cat <<'EOF'
<Updated PR body>
EOF
)"
```

Return the PR URL when done.

### Important

- You MUST execute all steps in a single response using parallel tool calls where possible
- Always use conventional commit format with scope
- Always create the PR as a draft
- **If a PR template exists in the repository, you MUST follow its structure exactly**
- **PR descriptions must focus on Why/What, not diff summaries. コミットログを見れば分かる変更差分の羅列は不要**
