# ルールファイルへのリファレンス

各種ルールは `~/.Codex/rules/` 配下に配置。詳細は各ファイルを参照。

## 常時適用 (alwaysApply: true)

- `communication-style.md` — 言葉遣い・文章スタイル（対話および成果物テキスト）
- `shell-command-style.md` — シェルコマンドの書き方（権限プロンプト回避）
- `subagent-tool-usage.md` — サブエージェントでのBash使用制限
- `secret-file-access.md` — 秘密情報ファイルへのアクセス禁止

## オンデマンド適用 (alwaysApply: false)

- `commit-message.md` — コミットメッセージとコミット分割
- `confluence-jira-cli.md` — Confluence/Jira CLIのエラーハンドリング
- `worktree-workflow.md` — git worktreeの運用ルール
- `doc-driven.md` — ドキュメント駆動開発
- `github-review.md` — GitHub PRレビューコメント書式
- `pr-creation.md` — PR作成ワークフロー
- `jira-markdown.md` — JIRA課題の記法
- `local.md` — リポジトリ一覧（ローカル専用。chezmoi 未管理）
- `pdf-post-processing.md` — PDF→Markdown変換後の後処理
- `typescript-discriminated-union.md` — TypeScript判別共用体

## GitHub CLI 利用ルール

- PR作成・PR確認・PR更新など、GitHub操作を求められた場合は、まず `gh` コマンドを使う。
- `gh auth status` の失敗や警告だけを根拠に、`gh` 全体が使えないと判断してはならない。ユーザー環境では目的の `gh` コマンドが正常に動くことがある。
- `gh auth status` が token invalid などを返しても、まず目的のコマンド（例: `gh pr create`, `gh pr view`, `gh pr edit`, `gh pr checks`）を実行する。目的のコマンド自体が失敗した場合にのみ、認証状態の確認や代替手段を検討する。
- GitHubコネクタやWeb APIへ迂回する前に、原則として該当する `gh` コマンドを試す。

## Meshnet mobile preview

- スマホ向けプレビューでは、開発サーバーを `0.0.0.0` で待ち受ける。
- `mobile-preview-url <port>` を実行し、返されたURLをユーザーへ提示する。
- 明示的な依頼がない限り、公開トンネルは使用しない。

## Superpowers の適用基準

この基準は superpowers の各スキルより優先する。工程はタスクの規模ではなく、未解決の設計判断と変更リスクに比例させる。

### Direct: そのまま実行する

次のタスクでは `using-superpowers`、`brainstorming`、`writing-plans`、`subagent-driven-development`、`test-driven-development` を自動適用しない。spec・実装計画・設計承認・サブエージェントを追加せず、必要な作業と対象に比例した検証だけを行う。

- 読み取り専用の調査、説明、レビュー、状況確認
- 既存ファイルのコピー、移動、改名、整理
- 指示済みの formatter、generator、Git 操作
- 誤字、文言、コメント、メタデータの修正
- 挙動やインターフェースを変えない、明確で可逆な設定変更

リポジトリ固有の安全規則が worktree を要求する場合は、タスク種別にかかわらずその規則を適用する。

### Bounded: 品質ゲートだけを残す

既存フローへの局所変更で、受入条件が明確かつ、公開 API・データモデル・永続化形式・セキュリティ境界を変えない場合は `brainstorming`、spec、`writing-plans`、`subagent-driven-development` を省略する。未解決の設計判断がなければ承認待ちにしない。

- バグ調査には `systematic-debugging` を使う
- 挙動変更には、テスト可能な場合だけ `test-driven-development` を使う
- 完了前に `verification-before-completion` で対象に比例した検証を行う

### Full: 完全なフローを使う

次のいずれかに該当する場合は、設計・計画・実装・レビューを含む superpowers の完全なフローを使う。

- 新しいプロジェクト、機能、サブシステムを作る
- 要件や受入条件に未解決の選択肢がある
- 複数コンポーネントをまたぐ変更
- 公開 API、データモデル、スキーマ、移行、認証、認可に影響する変更
- ユーザーが superpowers のスキルや設計先行を明示した

Direct または Bounded として開始しても、調査中に設計判断や高いリスクが見つかったら Full へ切り替える。安全のための昇格は行うが、工程を正当化するための拡大解釈はしない。

## コマンド/スキル設計原則: サブエージェント駆動

コマンドやスキルを設計する際は、Opus（司令塔）と Sonnet（実行者）の役割を分離する。
`CLAUDE_CODE_SUBAGENT_MODEL` 環境変数により、Agent ツールで起動したサブエージェントは自動的に Sonnet で動作する。

### 司令塔（Opus）の責務

- ユーザーとの対話（ヒアリング、確認、承認）
- サブエージェントのディスパッチ（プロンプト組み立て + Agent tool 呼び出し）
- サブエージェントの結果を統合して最終成果物を組み立てる

### サブエージェント（Sonnet）の責務

- 調査・診断・データ収集を実行し、構造化された結果を返す
- gh コマンド実行、ファイル探索、コード解析など I/O が多い作業

### 設計のガイドライン

- コマンドの `allowed-tools` に `Agent` を含め、調査/診断フェーズをサブエージェントに委譲する
- 司令塔は Read, Glob, Grep を直接使わない。必要な情報はサブエージェント経由で取得する
- サブエージェントへのプロンプトには、期待する出力形式を明記する（構造化テキストや JSON）
- 1つの診断フェーズは原則 1 サブエージェントにまとめる。タスクが独立している場合のみ並列化する

@RTK.md
