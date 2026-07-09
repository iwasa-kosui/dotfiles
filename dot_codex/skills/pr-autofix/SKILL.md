---
name: pr-autofix
description: 関連するPRからCI失敗・SonarCloud指摘・レビューコメントを並列で収集し、問題を構造化して修正計画を立て、すべて解決するまで自律的にコミット/push/再チェックを繰り返すスキル。「PRを直して」「CI落ちてる直して」「レビュー対応して」「PRの問題全部直して」「sonarのエラー解消して」「PR autofix」「PRをグリーンにして」などと言われたら積極的に使用する。明示されなくても、ユーザーが開いているPRに対して複数種類の問題（CI/Sonar/レビュー）が混在しており、それらを一括で潰す意図が読み取れる場合にも積極的にトリガーする。dry-runモードでは修正は行わず、問題一覧と修正計画だけを出力する。
---

# PR Autofix

関連するPRに対して、CI失敗・SonarCloud指摘・レビューコメントを並列で収集し、構造化した修正計画を立て、すべて解決するまで自律的に反復するスキル。

## いつ使うか

- PR上で複数の問題（CI失敗・Sonar指摘・レビューコメント）が同時に存在し、横断的に対応したいとき
- 「PRを直して」「CI直して」「レビュー対応して」のような漠然とした依頼を受けたとき
- 修正→push→再チェックの反復が必要なとき

## 設計思想

1. **並列収集が必須**: CI・Sonar・レビューコメントは独立した情報源なので、必ず並列で取得する。直列にすると時間が無駄
2. **構造化を挟む**: 収集した生データを即修正に流すのではなく、一度問題リストに正規化することで、依存関係・重複・優先順位が見える
3. **計画を先に立てる**: コミット分割は計画段階で確定させる。`commit-message.md` の「What/Whyを本質的に説明」「トリガー文言禁止」を計画時点で担保する
4. **レビュー指摘は鵜呑みにしない**: `superpowers:receiving-code-review` の原則を適用し、不明な指摘は質問、技術的に違う指摘は反論する
5. **dry-runと適用を明示的に分ける**: 副作用の大きい操作（コミット/push）の前に必ずユーザー確認を取る

## ワークフロー

### Step 0: モードとPRの確定

ユーザー指示を読み、以下を確定する:

- **対象PR**: 引数でPR番号/URLが指定されていればそれ。なければ現在ブランチのPR
- **モード**: 「計画だけ」「dry-run」「見せて」等の意図があれば dry-run。「直して」「適用して」等なら適用モード。曖昧なら明示的に確認する

```bash
# 現在ブランチのPRを取得
gh pr view --json number,url,headRefName,baseRefName,mergeable,state,headRepository,headRepositoryOwner
```

`owner/repo` と `prNumber` を抽出する。マージコンフリクト（`mergeable: CONFLICTING`）が発生していたら、その時点でユーザーに通知し、コンフリクト解消を依頼してから次に進む（自動解決はしない）。

ワークスペースを準備:

```bash
mkdir -p /tmp/pr-autofix/<owner>-<repo>-<pr>/iteration-1
```

### Step 1: 問題収集（並列）

**3つのサブエージェントを同一メッセージで並列に起動する**。直列起動は禁止（並列性の保証が崩れる）。

#### Subagent A: CI失敗ログ
- `subagent_type`: `general-purpose`
- プロンプト例:
  > 次のスクリプトを実行してCI失敗を収集してください:
  > ```
  > bun <skill-dir>/scripts/collect-ci-failures.ts <owner/repo> <PR>
  > ```
  > 標準出力に出力されるJSONをそのまま `/tmp/pr-autofix/.../iteration-N/ci-failures.json` に保存し、簡潔なサマリを返してください。

#### Subagent B: SonarCloud指摘
- `subagent_type`: `general-purpose`
- プロンプト例:
  > `~/.codex/skills/sonarcloud-issues/SKILL.md` を読み、PR `<owner/repo>#<PR>` に対してそのスキルを実行してください。
  > 結果を `/tmp/pr-autofix/.../iteration-N/sonarcloud.json` にJSONとして保存し、サマリを返してください。
  > `SONAR_TOKEN` 未設定や Sonar コメント不在で取得できなければ、空の `issues: []` と理由をJSONに記録してください。

#### Subagent C: レビューコメント（収集＋受け止め）
- `subagent_type`: `general-purpose`
- プロンプト例:
  > 次のスクリプトを実行してPRのレビューコメントを収集してください:
  > ```
  > bun <skill-dir>/scripts/collect-review-comments.ts <owner/repo> <PR>
  > ```
  > その後、利用可能なら `superpowers:receiving-code-review` を読み、その原則に沿って各コメントスレッドを以下の3つに分類してください:
  > - `actionable`: 意図が明確で、技術的に妥当
  > - `needs_clarification`: 意図が不明、または前提が不明
  > - `pushback`: 技術的に間違っているかYAGNI違反で、反論したい
  > 分類結果を `/tmp/pr-autofix/.../iteration-N/review-comments.json` に保存し、サマリを返してください。
  > なお、`outdated` なコメントや `[bot]` 以外でも既に修正済みの内容のコメントは `resolved` カテゴリに入れて除外してください。

並列起動後、3つの完了を待ってから次へ進む。

### Step 2: 構造化

3つのJSONを統合し、`/tmp/pr-autofix/.../iteration-N/problems.json` を生成する:

```json
{
  "pr": {
    "owner": "kkhs",
    "repo": "platform-domain-app",
    "number": 6186,
    "head": "feat/...",
    "base": "main",
    "mergeable": true
  },
  "problems": [
    {
      "id": "P001",
      "source": "ci",
      "severity": "blocker",
      "title": "test failure in UserService",
      "detail": "ログ抜粋...",
      "file": "src/user-service.ts",
      "line": 42
    },
    {
      "id": "P002",
      "source": "sonarcloud",
      "severity": "major",
      "title": "Cognitive Complexity 16 > 15",
      "file": "src/user-service.ts",
      "line": 80,
      "rule": "typescript:S3776"
    },
    {
      "id": "P003",
      "source": "review",
      "severity": "major",
      "category": "actionable",
      "author": "alice",
      "comment_id": 123456,
      "thread_id": 123456,
      "file": "src/foo.ts",
      "line": 10,
      "detail": "本文",
      "depends_on": []
    }
  ]
}
```

重大度の判断基準:
- **blocker**: マージを阻害する（CI failure、Quality Gate failure、required reviewer change request）
- **major**: 機能的・品質的に直すべき（major review comment、Sonar major issue）
- **minor**: nit、style、minor Sonar issue

依存関係: 「sonar違反がCI failureの根本原因」のような関連が明らかなら `depends_on` で繋ぐ。不明なら空配列。

### Step 3: 修正計画

`/tmp/pr-autofix/.../iteration-N/plan.md` を以下のテンプレートで生成する:

```markdown
# 修正計画 — <owner/repo>#<PR>

## サマリ
- 問題数: {count}（blocker {n} / major {n} / minor {n}）
- 推定コミット数: {n}
- マージ可能: {true|false}

## コミット分割
### Commit 1: <type>(<scope>): <description>
- 解決する問題: P001, P003
- 変更点:
  - `src/foo.ts:10` — ...
- Why: なぜこの変更が必要か（1〜2文）

### Commit 2: <type>(<scope>): <description>
- 解決する問題: P002
- ...

## 質問・反論が必要な指摘 (受信時に receiving-code-review を適用)
- P00X (reviewer @foo): 意図が不明
  - **対応方針**: 「<質問内容>」を返信し、回答が得られるまで保留
- P00Y (reviewer @bar): 技術的に異論あり
  - **反論内容**: 「<根拠と代替案>」
```

コミット分割のルール（`commit-message.md` 準拠）:
- 1コミット1論理変更
- メッセージは `<type>(<scope>): <description>` 形式
- ❌ 「レビュー対応」「フィードバック反映」「指摘を反映」のようなトリガー文言は禁止
- 各コミットメッセージは独立して What と Why を説明できること

### Step 4a: Dry-runモード

ここで終了。以下をユーザーに伝える:
- `problems.json` と `plan.md` のパス
- 問題数のサマリ（blocker/major/minorの内訳）
- 質問・反論が必要な指摘の有無
- 「適用しますか？」の確認

### Step 4b: 適用モード

「質問・反論が必要な指摘」が1件でもあれば、適用前に必ずユーザーに方針を仰ぐ。ユーザーが回答するまでpushしない。

承認後、計画の各コミットを順に実行:

1. **修正をコード変更として適用**（Edit/Write）
2. **コミット作成**:
   - 1論理変更につき1コミット
   - メッセージは計画通り（What/Why準拠、トリガー文言禁止）
   - `--amend` は使わない。間違えたら新しいコミットで対応する
3. **push**:
   ```bash
   git push
   ```
4. **CI待機**:
   ```bash
   gh pr checks --watch --interval 30 <PR>
   ```
   タイムアウトを30分とし、超えたらユーザーに状況を確認する。
5. **レビューコメントへの返信**（該当する場合のみ）:
   - 解決した `actionable` なinline review commentにスレッド返信
   - 書式: プロジェクトの `AGENTS.md` または `~/.Codex/rules/github-review.md` のprefixルールに従う（指定がなければ `🤖 Codex says:` を使う）
   - コミットハッシュを本文に含める場合は **半角括弧 `()`** で囲む。全角括弧 `（）` は使わない（例: `修正しました (e4dcbb406)`）
   - API:
     ```bash
     gh api repos/{owner}/{repo}/pulls/{pr}/comments/{comment_id}/replies \
       -f body="$PREFIX
     修正しました ($(git rev-parse --short HEAD))"
     ```

全コミット完了後、Step 1 に戻って再収集（`iteration-2` ディレクトリで実行）。

### Step 5: 終了判定

**成功終了** (以下を全て満たす):
- CI 全 green
- 未解決の `actionable` レビューコメントゼロ
- 未対応のbot指摘（SonarCloud Quality Gate含む）ゼロ

→ 完了報告:
- 解決した問題リスト（P001-P00N）
- 作成したコミットのSHAリスト
- 残った `needs_clarification` / `pushback` があれば、その後のユーザー対応案

**エスカレーション** (以下のいずれかで停止):
- 同じCIエラー（同一checkの同一step）が2回連続で再発 → 修正方針が誤っている可能性。原因の仮説と代替案を提示してユーザーに判断を仰ぐ
- レビュー指摘で意図不明・反論あり → ユーザーに方針確認
- 反復回数が **5回** に到達 → 進捗サマリと未解決問題リストを示して中断
- マージコンフリクト発生 → 自動解決はせずユーザーに依頼
- 環境要因（`SONAR_TOKEN` 未設定など）で取得不能 → 部分的に処理してその旨を報告

## バンドルスクリプト

- `scripts/collect-ci-failures.ts` — `gh pr checks` で失敗ジョブを抽出し、`gh run view --log-failed` でログを取得して構造化JSONを返す
- `scripts/collect-review-comments.ts` — inline review comments + general PR comments を取得し、bot/人間・active/outdatedで分類してJSONを返す

両スクリプトとも `bun <skill-dir>/scripts/<name>.ts <owner/repo> <PR>` で呼び出す。

## ワークスペース

`/tmp/pr-autofix/<owner>-<repo>-<pr>/iteration-<N>/` に保存:
- `ci-failures.json`
- `sonarcloud.json`
- `review-comments.json`
- `problems.json`
- `plan.md`

反復ごとに `iteration-N` でディレクトリを切る。永続化が必要なら `~/.codex/skills/pr-autofix-workspace/...` に移動する。

## なぜこの構造か

- **並列収集**: 3つの情報源に依存がない。直列にする理由がない。サブエージェントを分けるのは、それぞれが大量のログ・コメントを読むため、メイン文脈を汚染しないためでもある
- **`problems.json` という中間表現**: 修正計画を立てる前に「全部で何件あるか」「優先順位はどうか」が一覧で見えると、不必要なコミットを増やさずに済む。出典がバラバラの問題（CI/Sonar/レビュー）を統一スキーマで扱うことで、同じファイル・同じ行への重複指摘を発見できる
- **`plan.md` を先に書く**: コミット分割を計画段階で決めることで、`commit-message.md` の「1コミット1論理変更」と「What/Why本質説明」を実装中に再考しなくて済む
- **receiving-code-reviewの分類フェーズ**: レビュー指摘を3カテゴリに分けることで、`actionable` だけ自動適用し、`needs_clarification`/`pushback` はユーザー判断に回せる。「全部直す」と言われても、技術的に間違った指摘まで盲従しない
- **dry-run分離**: pushという不可逆操作の前にユーザーが計画を確認できる。CIが回り出してから「やっぱり違った」を防ぐ
