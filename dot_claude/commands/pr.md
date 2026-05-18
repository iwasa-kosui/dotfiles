---
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git branch:*), Bash(git checkout:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(gh pr create:*), Bash(gh pr edit:*), Bash(gh pr view:*), Bash(cat *), Bash(find . *), Bash(ls *)
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

- **背景と論点に絞る**: 本文は「背景」と「論点」の2つだけに絞る
  - **背景** = 後続の論点を理解するために最低限必要なコンテキスト（既存仕様の制約、過去の経緯、関連する障害・依頼、外部要件など）。論点を理解するのに必要なものだけ書き、それ以上は書かない
  - **論点** = レビュアに判断を仰ぎたい点、採用しなかった代替案とその理由、トレードオフ、残っている懸念、後続タスクに送る判断、命名や責務境界など意見が分かれる箇所
- **コードを読めば自明なことは書かない**: 「Xを追加した」「YをZにリネームした」「Aファイルを編集した」「○○ライブラリを使った」のように diff から読み取れる事実は書かない。採用した API 名・関数名・追加したファイル名なども diff にあるので本文での再掲は不要
- **テンプレートがある場合もこの原則を守る**: テンプレートのセクションは「背景／論点」原則のもとで埋める。セクションを埋めるためだけに変更内容を羅列してはいけない。書くことが無いセクションは「特になし」と書くか、テンプレートの指示に従う
- Good example（背景＋論点）: 「Result 型のネストが深くなり既存コードで型推論が崩れていた（背景）。`andThen` ではなく `flatMap` 採用を提案するが、neverthrow 公式の慣用から外れるため将来の neverthrow バージョンアップ時の移行コストが論点（論点）」
- Bad example（diff の言い換え）: 「auth.ts の login 関数の return 文を ResultAsync に変更し、error.ts の MapError を削除し...」
- Bad example（背景だけで論点が無い）: 「Result 型のネストを解消するため flatMap に統一した」← レビュアが何を議論すればよいか分からない。論点が無いなら背景だけで PR description は十分短くて良い

#### 6c. Create the PR

If a PR template was found, use it as the body structure. Otherwise use the default format:

Write the PR body to a temporary file, then create the PR using `--body-file`:

```bash
cat > /tmp/pr-body.md <<'EOF'
## 背景

<後続の論点を理解するために最低限必要なコンテキスト。論点が無い場合はここで PR description を完結させてよい>

## 論点

<レビュアに判断を仰ぎたい点、採用しなかった代替案とその理由、トレードオフ、残っている懸念、後続タスク送りにした判断など。論点が無いなら本セクションごと削除する>

## Test Plan

- [ ] <Testing steps>

---
Generated with Claude Code
EOF
gh pr create --draft --title "<conventional commit style title>" --body-file /tmp/pr-body.md
```

**Skip to End after creating the PR.**

### 7. Update Existing PR

If a PR already exists for this branch:

1. Stage, commit, and push any uncommitted changes (same as Steps 4-5)
2. Re-analyze all commits on the branch (`git log` and `git diff` against base branch) to understand the full scope of changes
3. Check for a PR template (same as Step 6a) and follow it if found
4. Rewrite the PR title and description based on the current state of all changes, following the same 背景／論点 rules as Step 6b
5. Update the PR:

Write the updated body to a temporary file, then update the PR:

```bash
cat > /tmp/pr-body.md <<'EOF'
<Updated PR body>
EOF
gh pr edit --title "<updated title>" --body-file /tmp/pr-body.md
```

Return the PR URL when done.

### Important

- You MUST execute all steps in a single response using parallel tool calls where possible
- Always use conventional commit format with scope
- Always create the PR as a draft
- **If a PR template exists in the repository, you MUST follow its structure exactly**
- **PR description は「背景」と「論点」に絞る。コードや diff を読めば自明なこと（追加・削除・リネームしたシンボル、採用した API/ライブラリ名、変更ファイル一覧など）は書かない。論点が無いなら背景だけで短く完結させる**
