---
name: add-rule
description: Claude Codeのルールファイル（.claude/rules/*.md）を追加・編集するスキル。ルールの新規作成、既存ルールの変更、パス条件付きルールの設定など、.claude/rulesの管理全般でトリガーする。
---

# Add Rule

Claude Codeの `.claude/rules/` ルールファイルをchezmoi管理下で追加・編集するスキル。

## ルールファイルの仕様

Claude Codeは `.claude/rules/` 内のMarkdownファイルをルールとして読み込む。

- **無条件ルール**: frontmatterなし。セッション開始時に常にロードされる
- **パス条件付きルール**: YAMLフロントマターの `paths` フィールドでglobパターンを指定。マッチするファイルを扱うときだけロードされる

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Development Rules
...
```

`paths` フィールドのみ使用する。`globs` や `description` フィールドは効果がないため使わないこと。

## ルール記述のガイドライン

- **200行以内に収める** — ルールはセッション開始時にコンテキストウィンドウへ注入されるため、長すぎると他の情報を圧迫し、遵守率も下がる
- **具体的で検証可能な指示にする** — 「コードを適切にフォーマットする」ではなく「2スペースインデントを使用する」。曖昧な指示はエージェントの解釈に依存し、一貫性が保てない
- **理由を添える** — 「ALWAYS/NEVER」の羅列ではなく、なぜそのルールが必要かを書く。理由があれば未知のケースにも応用できる
- **矛盾を避ける** — 既存ルールと新ルールが衝突しないか確認する

## ワークフロー

このリポジトリはchezmoi管理下のdotfilesリポジトリ。ルールファイルはchezmoiソースディレクトリ内の `dot_claude/rules/` に配置し、`chezmoi apply` でデプロイする。

### 1. 要件整理と既存ルール確認

ユーザーの要望から以下を明確にする:
- ルールのトピック（ファイル名に反映、`kebab-case.md`）
- ルールの内容
- パス条件の要否

既存ルールを確認し、同一トピックがあれば新規作成ではなく編集を提案する:

```bash
ls dot_claude/rules/ 2>/dev/null || echo "ルールディレクトリはまだ存在しません"
```

### 2. ルールファイルの作成・編集

chezmoiソースディレクトリの `dot_claude/rules/` にファイルを作成または編集する。

### 3. diffプレビューと承認

変更内容をユーザーに提示する。以下を伝えること:
- デプロイ先パス（`~/.claude/rules/<name>.md`）
- ルール内容の要約
- パス条件がある場合、どのファイルに適用されるか

AskUserQuestionツールで承認を求め、「修正」なら2に戻り、「キャンセル」なら変更をリバートする。

### 4. 適用

```bash
chezmoi apply
```

適用後、デプロイ先にファイルが存在することを確認し、結果を簡潔に報告する。

## ルールの効果テスト

ルールの有無でClaude Codeの振る舞いがどう変わるかをテストする機能。`evals/evals.json` のテストケースを使い、ルールあり・なしの2条件で `claude -p` を実行して結果を比較する。skill-creatorのeval-viewerで結果をブラウザ上で閲覧できる。

ユーザーが「ルールをテストしたい」「ルールの効果を確認したい」「ルールの有無で比較したい」と言った場合にこのフローを実行する。

### テスト実行手順

#### 1. テストケースの準備

`evals/evals.json` にテストケースが既にあるか確認する。なければ作成する。各テストケースには `prompt` と `expectations`（検証項目）を含める。

```json
{
  "skill_name": "rule-name",
  "evals": [
    {
      "id": 1,
      "prompt": "ルールが影響するタスクのプロンプト",
      "expected_output": "期待される結果の説明",
      "expectations": [
        "具体的な検証項目1",
        "具体的な検証項目2"
      ]
    }
  ]
}
```

#### 2. テスト実行

`scripts/rule_tester.py` でルールあり・なしの両方を並列実行する:

```bash
python <add-rule-skill-path>/scripts/rule_tester.py \
  <ルールファイルパス> \
  <add-rule-skill-path>/evals/evals.json \
  --workspace <ワークスペースパス>/iteration-1 \
  --verbose
```

これにより各テストケースについて `with_rule/` と `without_rule/` の2つのディレクトリにレスポンスが保存される。

#### 3. グレーディング

各ランの出力を expectations に基づいて評価する。skill-creatorの `agents/grader.md` の手順に従い、サブエージェントまたはインラインでグレーディングを行う。結果は各ランディレクトリの `grading.json` に保存する。

`grading.json` の `expectations` 配列は `text`, `passed`, `evidence` フィールドを使うこと（viewerがこのフィールド名に依存）。

#### 4. ベンチマーク集計

```bash
python -m scripts.aggregate_benchmark <ワークスペースパス>/iteration-1 \
  --skill-name <ルール名>
```

skill-creatorのスクリプトをCWDをskill-creatorディレクトリにして実行する。

#### 5. eval-viewerで結果を閲覧

```bash
nohup python <skill-creator-path>/eval-viewer/generate_review.py \
  <ワークスペースパス>/iteration-1 \
  --skill-name "<ルール名>" \
  --benchmark <ワークスペースパス>/iteration-1/benchmark.json \
  > /dev/null 2>&1 &
```

ブラウザが開き、「Outputs」タブでルールあり・なしの出力を横並びで確認でき、「Benchmark」タブで定量的な比較が確認できる。

#### 6. フィードバックとイテレーション

ユーザーがビューアーでフィードバックを入力した後、`feedback.json` を読んでルールを改善し、次のイテレーションとして再実行する。`--previous-workspace` を指定すると前回の結果と並べて比較できる。
