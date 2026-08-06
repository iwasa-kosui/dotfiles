# ルールファイルへのリファレンス

各種ルールは `~/.claude/rules/` 配下に配置。詳細は各ファイルを参照。

## 常時適用 (alwaysApply: true)

- `communication-style.md` — 言葉遣い・文章スタイル（対話および成果物テキスト）
- `shell-command-style.md` — シェルコマンドの書き方（権限プロンプト回避）
- `subagent-tool-usage.md` — サブエージェントでのBash使用制限
- `secret-file-access.md` — 秘密情報ファイルへのアクセス禁止
- `scope-discipline.md` — 設計判断の確認とスコープの絞り込み

## オンデマンド適用 (alwaysApply: false)

- `commit-message.md` — コミットメッセージとコミット分割
- `confluence-jira-cli.md` — Confluence/Jira CLIのエラーハンドリング
- `worktree-workflow.md` — git worktreeの運用ルール
- `doc-driven.md` — ドキュメント駆動開発
- `github-review.md` — GitHub PRレビューコメント書式
- `external-review-feedback.md` — botレビュー指摘の検証手順
- `pr-creation.md` — PR作成ワークフロー
- `jira-markdown.md` — JIRA課題の記法
- `repo-account-scope.md` — 変更が別リポジトリに属すると結論する前の確認
- `local.md` — リポジトリ一覧（ローカル専用。chezmoi 未管理）
- `pdf-post-processing.md` — PDF→Markdown変換後の後処理
- `typescript-discriminated-union.md` — TypeScript判別共用体

## コマンド/スキル設計原則: サブエージェント駆動

コマンドやスキルを設計する際は、Opus（司令塔）と Sonnet（実行者）の役割を分離する。

### モデルと effort の決まり方

`CLAUDE_CODE_SUBAGENT_MODEL` に `sonnet` を設定しているため、Agent ツールで起動したサブエージェントは Sonnet で動作する。この環境変数はモデル解決の最優先で、サブエージェント定義の `model` frontmatter と Agent 呼び出し時の `model` パラメータの両方を上書きする。したがって `~/.claude/agents/*.md` に `model:` を書いても効かない。誤解を招くので書かない。

一方 `effort` frontmatter は有効で、セッションの `effortLevel` を上書きする。サブエージェントは既定でセッションの effort を継承するため、機械的な収集作業には `effort: low` / `medium` を明示してコストを抑える。判断を伴う照合には `high` を残す。

### 定義済みサブエージェント

`~/.claude/agents/` に配置。

- `gh-collector` — PR の基本情報、CI 失敗ログ、SonarCloud 指摘、レビューコメント、ブランチのコミット群と差分の要約
- `fact-checker` — 主張を一次情報と照合し、判定・根拠 URL・原文引用を返す
- `doc-style-checker` — 日本語の長文ドキュメントを `communication-style.md` の検査項目に照らして検査
- `atlassian-collector` — Jira 課題と Confluence ページの取得・検索・要約

これで足りない場合は builtin の `Explore`（コード探索）と `Plan`（実装方針の設計）を使う。

### 司令塔（Opus）の責務

- ユーザーとの対話（ヒアリング、確認、承認）
- サブエージェントのディスパッチ（プロンプト組み立て + Agent tool 呼び出し）
- サブエージェントの結果を統合して最終成果物を組み立てる

### サブエージェント（Sonnet）の責務

- 調査・診断・データ収集を実行し、構造化された結果を返す
- gh コマンド実行、ファイル探索、コード解析など I/O が多い作業

### 委譲するかどうかの判定基準

委譲する。

- 出力が大量になる作業。CI ログ、大きな diff、長い課題本文、Web ページ全文など
- 複数ファイル・複数ディレクトリを横断する探索
- 要約や判定だけ返せば足りる、自己完結した作業
- 独立した複数の調査。同一メッセージで並列に起動する

直接やる。

- 単一ファイルの確認や、既に場所が分かっている値の参照
- ユーザーとの対話往復が必要な作業
- レイテンシが結果の価値を左右する短い確認

サブエージェントは新しいコンテキストから始まるので、起動コストが作業量を上回る場合は直接やるほうが速い。

### プロンプトの書き方

- サブエージェントにメインの会話履歴は渡らない。起動時に読まれるのはシステムプロンプト、タスクメッセージ、CLAUDE.md 階層、git status、プリロードした skills だけ
- `rules/*.md` は CLAUDE.md からパス参照されているだけで本文は展開されない。守らせたいルールはプロンプトに書くか、サブエージェント定義に埋め込む
- 期待する出力形式を明記する（構造化テキストや JSON）
- 1つの診断フェーズは原則 1 サブエージェントにまとめる。タスクが独立している場合のみ並列化する
- コマンドの `allowed-tools` に `Agent` を含める。`Agent` は既定で承認プロンプトの対象外なので、`permissions.allow` への追加は不要

@RTK.md
