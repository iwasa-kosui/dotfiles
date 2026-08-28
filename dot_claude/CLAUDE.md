# ルールファイルへのリファレンス

各種ルールは `~/.claude/rules/` 配下に配置。詳細は各ファイルを参照。

**`~/.claude/rules/` のファイルは、既定で全文が毎コール読み込まれます。** `alwaysApply` は Claude Code が解釈しないフィールドなので、`false` にしても読み込みは止まりません。読み込みを絞れるのは `paths` frontmatter だけで、指定したグロブに一致するファイルを触るときだけ本文が入ります。

したがって rules にファイルを足すと、全セッションの全コールに乗ります。追加するときは常時必要かを判断し、発動条件がファイルパスで表せるなら `paths` を付け、操作のタイミングで決まるなら skill か hook に置きます。

## 常時読み込まれるもの

- `communication-style.md` — 対話と文体・用語の共通ルール
- `scope-discipline.md` — 設計判断の確認とスコープの絞り込み
- `shell-command-style.md` — シェルコマンドの書き方（権限プロンプト回避）
- `subagent-tool-usage.md` — 専用ツールを優先し Bash パイプラインを避ける
- `secret-file-access.md` — 秘密情報ファイルへのアクセス禁止
- `worktree-workflow.md` — git worktreeの運用ルール
- `repo-account-scope.md` — 変更が別リポジトリに属すると結論する前の確認
- `doc-driven.md` — ドキュメント駆動開発
- `jira-markdown.md` — JIRA課題の記法
- `confluence-jira-cli.md` — Confluence/Jira CLIのエラーハンドリング

## paths で絞っているもの

- `writing-artifacts.md` — 成果物テキストの構成と事実確認。`**/*.md` `**/*.mdx`
- `typescript-discriminated-union.md` — TypeScript判別共用体。`**/*.ts` `**/*.tsx`

## skill と hook に移したもの

固定文脈から外すため、発動条件が操作タイミングで決まるものは移しました。

- コミットメッセージと分割、PR の Ready 化条件 → `pr` スキル
- bot レビュー指摘の検証手順、GitHub コメントの details 書式 → `pr-autofix` スキルと `gh-comment-format-guard.ts` hook

移動元のファイルはリポジトリの `.chezmoiremove` に列挙します。`chezmoi apply` は管理対象から外れただけのファイルを削除しないため、ソースから消しても `~/.claude/rules/` に実体が残り、読み込まれ続けます。

## コンテキスト予算

コストの過半は「同じ履歴の読み直し」です。読み直しの費用はその時点の文脈量にほぼ比例し、ツールを叩くたびに1回発生します。文脈を太らせないことが最も効きます。

- **固定文脈だけで毎コール約 50k tok を払っています。** 会話を切るとこれを払い直すので、話題が続いているなら `/clear` より `/compact <残したい話題>` を先に使います。話題が完全に変わったときだけ新しい会話にします
- メインの文脈は 200k tok を目安に畳みます。実測では 100コールを超えた会話が文脈 300k まで伸び、1コールあたりの費用が短い会話の約1.4倍になっています
- **メインに入るツール出力の8割が Read と Bash です。** ファイルの読み取りは `doc-reader` と `code-analyzer` に委譲し、メインでは Read しません。委譲すればファイル全文はサブエージェントのコンテキストで消え、メインには結論と `file:line` だけが残ります
- `grep` や `cat` を Bash で実行しません。Grep / Read ツールは出力が絞られるぶん文脈に残る量が少なく、権限プロンプトも出ません
- 自動 compact は無効にしています（`autoCompactEnabled: false`）。畳むのは手動なので、`context-guard` hook の警告か statusline の文脈量を見て自分で判断します

## シェルは zsh。PowerShell ツールを使わない

`CLAUDE_CODE_USE_POWERSHELL_TOOL` が空でない値だと、macOS でも PowerShell ツールとその説明文が読み込まれます。組織配信の `~/.claude/remote-settings.json` はこの変数に `"0"` を設定していますが、判定は値ではなく空かどうかなので、`"0"` でも有効になります。

この設定はユーザー側から打ち消せません。[設定の優先順位](https://code.claude.com/docs/en/settings.md)は managed settings が最上位で、組織配信の `env` はユーザーの `~/.claude/settings.json` の `env` より強く効きます。settings の `env` はシェルから継承した環境変数も上書きするため、`~/.zshrc` で空文字を export しても届きません。実測でも子プロセスに渡る値は `1` になります。

したがって PowerShell ツールは出続けます。出ていても使いません。このマシンに `pwsh` は入っておらず実行できないうえ、シェルは zsh なので、ツール説明にある Windows 前提の記法・制約は当てはまりません。コマンドは Bash ツールで実行します。

- 複数行のコミットメッセージを here-string `@'...'@` で渡さない。zsh はこれを here-string と解釈せず、単なるクォート連結として扱うため、本文の先頭と末尾に `@` が残る。一時ファイルに書いて `git commit -F <file>` で渡す。`commit-message-guard.ts` hook が `@` で始まるコミットメッセージをブロックする
- `&&` `||` `??` `?.` は使える。「PowerShell 5.1 では parser error になる」という制約は当てはまらない
- 環境変数の読み書き、パス区切り、`Get-ChildItem` 系 cmdlet の代替も zsh の記法を使う

## Ship 境界

共通方針はリポジトリの `agent_policy/contract.md` を正本とする。

実装、設定変更、バグ修正は、必要な検証後に Draft PR まで進めてよいです。Draft PR はレビュー可能な下書きであり、ユーザーの明示的な承認を置き換えません。

Ready 化、merge、force-push、保護ブランチへの直接変更は、ユーザーから明示的な承認を受けるまで行いません。

質問への回答、調査、コードレビュー、設計相談、変更を伴わない状況確認では ship しません。ユーザーがコミット、push、PR 作成を止めるよう指定した場合も ship しません。

## コマンド/スキル設計原則: サブエージェント駆動

コマンドやスキルを設計する際は、Opus（司令塔）と、より安価なモデル（実行者）の役割を分離する。実行者は既定で Sonnet、整形や書き出しのように判断を伴わない作業は Haiku にする。

### モデルと effort の決まり方

`CLAUDE_CODE_SUBAGENT_MODEL` に具体的なモデル名を入れると、それがモデル解決の最優先になり、サブエージェント定義の `model` frontmatter と Agent 呼び出し時の `model` パラメータの両方を上書きする。エージェントごとにモデルを選べなくなるので、この変数は `inherit` にしている。`inherit` を未設定と同じ扱いにする挙動は v2.1.196 以降。

したがってモデルは `~/.claude/agents/*.md` の `model:` frontmatter で決まる。収集・診断系は `sonnet`、整形と書き出しだけの `handoff-writer` は `haiku` を指定している。

**builtin の `Explore` / `Plan` / `general-purpose` は frontmatter を持たない。** 指定しないとセッションのモデル（Opus）を継承するので、builtin を使う場合は Agent 呼び出し時に `model: "sonnet"` を明示する。役割別の専用エージェントを定義してあるのは、この明示を忘れる余地を消すためでもある。

`effort` frontmatter はセッションの `effortLevel` を上書きする。サブエージェントは既定でセッションの effort を継承するため、機械的な収集作業には `effort: low` / `medium` を明示してコストを抑える。判断を伴う照合には `high` を残す。

### 定義済みサブエージェント

`~/.claude/agents/` に配置。

役割別。読み取り・調査・編集はすべてここに委譲する。

- `doc-reader` — ドキュメント・設定ファイル・ログの読み取りと要約。結論と `file:line` の根拠だけを返す。Haiku
- `code-analyzer` — コードの調査と分析。定義箇所の特定、呼び出し関係の追跡、条件分岐の洗い出し、不具合の原因箇所の絞り込み
- `code-editor` — コードと設定ファイルの編集・新規作成。適用した変更を `file:line` と変更後の該当行の引用で返す
- `doc-editor` — Markdown の編集・新規作成。文体ルールを定義本文に埋め込んであるため、司令塔が毎回指示しなくてよい

ドメイン特化。

- `gh-collector` — PR の基本情報、CI 失敗ログ、レビューコメント、ブランチのコミット群と差分の要約
- `fact-checker` — 主張を一次情報と照合し、判定・根拠 URL・原文引用を返す
- `doc-style-checker` — 日本語の長文ドキュメントを `communication-style.md` の検査項目に照らして検査
- `atlassian-collector` — Jira 課題と Confluence ページの取得・検索・要約
- `handoff-writer` — 司令塔が確定した handoff のブリーフを、メタデータを補完してテンプレートに整形し書き出す

builtin で使うのは `Plan`（実装方針の設計）だけ。コード探索は `Explore` ではなく `code-analyzer`、雑多な作業も `general-purpose` ではなく役割別のエージェントに振る。

### 司令塔（Opus）の責務

司令塔が自分でツールを叩くのは、この4つだけ。

- ユーザーとの対話。ヒアリング、確認、承認
- サブエージェントのディスパッチ。プロンプトの組み立てと Agent tool 呼び出し
- サブエージェントの結果を統合して最終成果物を組み立てる
- git / gh / chezmoi の実行。commit、push、PR 操作、`chezmoi apply` はサブエージェントに任せない

### サブエージェント（Sonnet / Haiku）の責務

- ファイルの読み取りと要約。全文をメインに載せない
- 調査・診断・データ収集を実行し、構造化された結果を返す
- コードとドキュメントの編集。司令塔が確定した変更内容を適用する
- 司令塔が確定した内容の整形とファイルへの書き出し。判断が要らないので Haiku で足りる

### 必ず委譲する作業

以下はメインで実行しない。Read / Grep / Glob / Edit / Write を呼びそうになったら、対応するエージェントに振る。

- ファイルの内容を知る → `doc-reader`
- コードの場所と挙動を知る → `code-analyzer`
- コードと設定ファイルを書き換える、新規作成する → `code-editor`
- Markdown を書き換える、新規作成する → `doc-editor`
- PR、CI、レビューコメントの状況を知る → `gh-collector`
- Jira 課題と Confluence ページを読む → `atlassian-collector`
- 主張の裏取り → `fact-checker`
- 長文ドキュメントの文体検査 → `doc-style-checker`

独立した複数の作業は、同一メッセージで並列に起動する。

委譲の代償は把握しておく。サブエージェントは起動ごとに固定文脈を払うため、1行の修正でも1回分かかり、メインで Read と Edit を続けたほうが安く済むケースは残る。それでも委譲に寄せるのは、毎回コストを比べる運用だと判断が漏れ、漏れたときの損失が大きいからである。メインに載ったファイル全文は以降の全コールで読み直され、会話が続くかぎり課金され続ける。

編集を委譲すると司令塔は差分を直接読まない。だから `code-editor` と `doc-editor` には、変更した `file:line` と変更後の該当行の引用を返させる。それでも足りないときは `git diff --stat` で範囲を確認する。

### プロンプトの書き方

- サブエージェントにメインの会話履歴は渡らない。起動時に読まれるのはシステムプロンプト、タスクメッセージ、CLAUDE.md 階層、git status、プリロードした skills だけ
- サブエージェントの固定文脈は実測で 20〜32k tok。メインの 42〜62k より軽いのは、skills の一覧・MCP の定義・SessionStart hook の出力が入らないため。委譲が安いのは主にこの差から来る
- `rules/*.md` がサブエージェントで展開されるかは未確認。守らせたいルールはプロンプトに書くか、サブエージェント定義に埋め込む
- 期待する出力形式を明記する（構造化テキストや JSON）
- 1つの診断フェーズは原則 1 サブエージェントにまとめる。タスクが独立している場合のみ並列化する
- コマンドの `allowed-tools` に `Agent` を含める。`Agent` は既定で承認プロンプトの対象外なので、`permissions.allow` への追加は不要
