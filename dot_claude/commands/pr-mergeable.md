---
allowed-tools: AskUserQuestion, Agent, Bash, Write
description: Make PR mergeable by diagnosing blockers and launching /goal session
---

## Your task

You MUST use Japanese.

あなたは、現在のブランチに紐づく PR を診断し、マージ可能にするための完了条件プロンプトを自動生成して `/goal` セッションとして起動する**司令塔**です。
調査・診断はサブエージェントに委譲し、自身はディスパッチ・判断・ユーザー対話に専念してください。

## フロー

### ステップ1: PR特定

```bash
gh pr view --json number,title,url,isDraft,mergeable,headRefName,baseRefName
```

- PR が見つからない場合はエラーメッセージを表示して終了する
- 複数の PR が存在する場合は `gh pr list --head <branch>` で一覧を表示し、ユーザーに選択を求める

### ステップ2: 診断（サブエージェントに委譲）

Agent ツールで **1つのサブエージェント** を起動し、以下の診断を委譲する。
サブエージェントへのプロンプトには、ステップ1で取得した PR 情報（number, owner, repo, mergeable, isDraft, baseRefName）を含めること。

```
サブエージェントへのプロンプト例:

PR #{number} ({owner}/{repo}) の以下4項目を診断し、結果を構造化テキストで返してください。

## 診断項目

### 1. CI状態
- `gh pr checks #{number} --json name,state,conclusion` で取得
- conclusion が FAILURE または CANCELLED のジョブを抽出
- 失敗ジョブがある場合、`gh run view <run-id> --log-failed` でログ概要を取得（末尾200行）

### 2. 未対応レビューコメント
- `gh api repos/{owner}/{repo}/pulls/{number}/comments` でコメント取得
- GraphQL で reviewThreads の isResolved/isOutdated を確認
- isResolved: false かつ isOutdated: false のスレッドを抽出

### 3. マージコンフリクト
- mergeable フィールド値: {mergeable}
- UNKNOWN の場合は数秒待って `gh pr view` で再取得

### 4. draft状態
- isDraft: {isDraft}

## 出力形式

以下の形式で結果を返すこと:

**CI失敗ジョブ:** (なし or ジョブ名リスト + ログ要約)
**未対応レビューコメント:** (なし or ファイルパス・コメント要約のリスト)
**マージコンフリクト:** (なし or あり / base: {base})
**draft状態:** (true or false)
```

### ステップ3: ブロッカー判定

サブエージェントの結果を分析し、ブロッカーの有無を判定する。

- **ブロッカーなし**: 「このPRはマージ可能な状態です」と報告して終了する
- **ブロッカーあり**: ステップ4に進む

### ステップ4: プロンプト生成

以下のテンプレートに従ってプロンプトを組み立てる。検出されたブロッカーに応じて受入条件を動的に生成する。

```
PR #<番号> (<タイトル>) をマージ可能な状態にする

## 現状の問題

- <診断で検出されたブロッカーの箇条書き>

## 完了条件

以下の**すべて**が満たされた時点で完了とする。

### 受入条件
- <ブロッカーごとに生成された条件。以下の生成ルールを参照>

### PR対応時の前提条件（未対応レビューコメントがある場合のみ含める）
- PRの全レビューコメントについて対応要否が判定されていること
- 対応が必要なコメントには修正コミットのハッシュ付きで返信されていること

### セルフレビュー前提条件（PRがdraft状態の場合のみ含める）
- `/review` でセルフレビューを実行し、指摘事項があればすべて修正すること
- セルフレビュー完了後、`gh pr ready` で Ready for review にすること

### 前提条件（常に必須）
- ローカルでテスト・lint・型チェック等がすべて通過していること
- push 済みの場合、GitHub Actions の CI が通過していること（`gh run list --branch <branch>` または `gh pr checks` で**リモートの CI ステータス**を確認する。ローカルの検証結果だけでは CI 通過とみなさない。CI が in_progress や queued の場合は completed になるまで待機してから再確認する）
- 上記の受入条件をすべて満たしていること
- 完了を主張する前に、実際にコマンドを実行して結果を確認すること（証拠なき完了主張は不可）
```

#### 受入条件の生成ルール

| ブロッカー | 生成する受入条件 |
|---|---|
| CI失敗 | 「GitHub Actions の CI ジョブ `<失敗ジョブ名>` が通過していること」＋失敗ログの要約を「現状の問題」セクションに記載 |
| 未対応レビューコメント | コメントごとに「`<ファイルパス>` の指摘（<コメント要約>）に対応すること」 |
| マージコンフリクト | 「ベースブランチ (`<base>`) とのマージコンフリクトが解消されていること」 |
| draft状態 | セルフレビュー前提条件セクションで対応（受入条件には含めない） |

### ステップ5: プレビューと確認

組み立てたプロンプト全文をコードブロックで表示し、ユーザーに最終確認を求める:

> 以下のプロンプトで `/goal` セッションを起動します。修正点があれば教えてください。

修正があれば反映し、再度プレビューする。

### ステップ6: cmux で /goal セッションを起動

ユーザーの承認を得たら、以下の手順で新しい cmux ワークスペースに `/goal` セッションを起動する:

1. 組み立てたプロンプトの先頭に `/goal` + 改行を付加し、Write ツールで `/tmp/goal-prompt.md` に書き出す
2. haiku でワークスペース名を生成する:
   ```bash
   ws_name=$(claude -m haiku -p "以下のタスク概要から、ワークスペース名として最適な短い英語名を1つだけ出力してください。kebab-case、15文字以内、説明不要。タスク: PR #<番号> をマージ可能にする" 2>/dev/null | tr -d '\n' | tr -d ' ')
   ws_name="${ws_name:-pr-fix}"
   ```
3. 起動スクリプトを書き出し、cmux ワークスペースを作成する:
   ```bash
   cat > /tmp/goal-run.sh <<'SCRIPT'
   prompt=$(cat /tmp/goal-prompt.md)
   exec claude "$prompt"
   SCRIPT
   chmod +x /tmp/goal-run.sh
   cmux new-workspace --name "$ws_name" --cwd "$PWD" --command "bash /tmp/goal-run.sh"
   ```
4. ユーザーに「cmux ワークスペース `$ws_name` で /goal セッションを起動しました」と伝える

## 重要なルール

- 診断はサブエージェントに委譲し、司令塔のトークン消費を最小化する
- 受入条件はチェッカーモデルが**機械的に判定できる**形で記述する
- 前提条件（CI通過・検証実行）は**常に含める**。ユーザーが削除を希望しても、理由を説明して残すことを推奨する
- プロンプトは簡潔に。冗長な説明はチェッカーモデルの判定精度を下げる
- 「現状の問題」セクションには /goal セッションが作業着手しやすいよう、CI失敗ログの要約やコメント内容などの参考情報を含める
