---
name: add-rule
description: Claude Codeのルールファイル（.claude/rules/*.md）をchezmoi管理下のdotfilesに追加・編集し、diffプレビュー後にapplyするスキル。ユーザーがClaude Codeのルール追加、ルール変更、.claude/rulesの編集、プロジェクトルールの管理について言及した場合にトリガーする。chezmoi管理の設定変更全般にも対応する。
---

# Add Rule

Claude Codeの `.claude/rules/` ルールファイルをchezmoi管理下で追加・編集するスキル。

## 背景

Claude Codeは `.claude/rules/` ディレクトリ内のMarkdownファイルをルールとして読み込む。このスキルは、そのルールファイルをchezmoiのソースディレクトリで管理し、変更のdiffプレビューとapplyを一気通貫で行う。

### ルールファイルの仕様

- ファイル形式: Markdown (`.md`)
- 配置先: `.claude/rules/` ディレクトリ（再帰的に検索される）
- 無条件ルール: frontmatterなし。セッション開始時に常にロードされる
- パス条件付きルール: YAMLフロントマターの **`paths`** フィールドでglobパターン指定。マッチするファイルを扱うときだけロードされる

**重要**: パス条件には必ず `paths` フィールドを使う。`globs` や `description` は使わない。

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Development Rules
...
```

よく使うglobパターン:

| パターン | マッチ対象 |
|---|---|
| `**/*.ts` | 全ディレクトリのTypeScriptファイル |
| `src/**/*` | src/ 以下の全ファイル |
| `*.md` | プロジェクトルートのMarkdownファイル |
| `src/components/*.tsx` | 特定ディレクトリのReactコンポーネント |

複数パターンやブレース展開も可能: `"src/**/*.{ts,tsx}"`

### chezmoiでのパス対応

| デプロイ先 | chezmoiソース |
|---|---|
| `~/.claude/rules/*.md` | `dot_claude/rules/*.md` |
| `~/.claude/CLAUDE.md` | `dot_claude/CLAUDE.md` |

## ワークフロー

### 1. ルール内容の決定

ユーザーの要望を聞き、以下を明確にする:

- ルールのトピック（ファイル名に反映）
- ルールの内容
- パス条件が必要かどうか（特定のファイルタイプにだけ適用するか）

ファイル名は `kebab-case.md` で、内容を端的に表す名前にする（例: `code-style.md`, `testing.md`, `api-design.md`）。

### 2. 既存ルールの確認

chezmoiソースディレクトリで既存のルールを確認する:

```bash
ls dot_claude/rules/ 2>/dev/null || echo "ルールディレクトリはまだ存在しません"
```

同一トピックのルールが既にあれば、新規作成ではなく既存ファイルの編集を提案する。

### 3. ルールファイルの作成・編集

chezmoiソースディレクトリにルールファイルを作成または編集する。ディレクトリが存在しない場合は作成する。

ルール記述のガイドライン:
- 200行以内に収める（長すぎるとコンテキストを消費し遵守率が下がる）
- 具体的で検証可能な指示を書く（「コードを適切にフォーマットする」ではなく「2スペースインデントを使用する」）
- 矛盾する指示を避ける
- Markdownの見出しと箇条書きで構造化する

### 4. diffプレビュー

変更内容をプレビューする。以下の方法を順に試す:

```bash
# 方法1: chezmoi diff（通常のchezmoiソースディレクトリで作業している場合）
chezmoi diff

# 方法2: chezmoi diffが使えない場合（worktree内など）
# 作成・編集したファイルの内容を直接表示し、デプロイ先のパスを説明する
```

diffまたはファイル内容をユーザーに見やすく提示する。以下を伝える:
- 作成/変更されるファイルのパス（デプロイ先: `~/.claude/rules/<name>.md`）
- ルールの内容の要約
- パス条件がある場合、どのファイルを扱うときに有効になるか

### 5. ユーザー承認

AskUserQuestion ツールを使って、ユーザーに承認を求める:

- 「適用する」→ ステップ6へ
- 「修正する」→ ステップ3に戻る
- 「キャンセル」→ 変更をリバート

### 6. chezmoi apply

ユーザーが承認したら適用する:

```bash
chezmoi apply
```

適用結果を確認:

```bash
ls ~/.claude/rules/
```

### 7. 完了報告

適用されたルールの内容を簡潔に要約して報告する。パス条件付きルールの場合は、どのファイルを扱うときに有効になるかも伝える。
