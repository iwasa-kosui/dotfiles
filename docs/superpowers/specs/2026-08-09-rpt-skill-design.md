# rpt skill design

## Goal

Codex、Claude、Cursorへ共通の`rpt`スキルを配布し、「レポートを作って」「HTML報告書にして」「モバイルで見せて」のような依頼から、安全なMDX作成、単一HTML生成、必要に応じたモバイルプレビューまでを一貫して実行できるようにします。

スキルは`rpt` CLIの契約を複製しません。実行時に引数なしの`rpt`を呼び、そのstdoutを最新のauthoring contractとして扱います。

## Trigger contract

スキル名は`rpt`です。次の依頼で自動適用し、`$rpt`による明示呼び出しも受け付けます。

- レポート、報告書、分析結果、調査結果をHTMLにする依頼
- `rpt`でMDXまたは単一HTMLを生成する依頼
- 生成したレポートをモバイルでプレビューする依頼
- 既存の`.mdx`レポートを修正または再生成する依頼

単なるMarkdown回答や、既存HTMLを閲覧するだけの依頼では自動適用しません。

## Distribution

同一内容の`SKILL.md`を次へ配置します。

- `dot_codex/skills/rpt/SKILL.md`
- `dot_claude/skills/rpt/SKILL.md`
- `dot_cursor/skills/rpt/SKILL.md`

Codex向けに`dot_codex/skills/rpt/agents/openai.yaml`を追加し、UI表示名、短い説明、`$rpt`を明示したdefault promptを定義します。スキル固有のscript、reference、assetは持ちません。構文の正本は常に`rpt`の引数なしhelpです。

## Workflow

1. 依頼から目的、読者、判断したいこと、入力資料、出力先を抽出します。不足が結果を大きく変える場合だけ、一度に一つ質問します。「なんかレポート」のように裁量を委ねられた場合は、短い構成案を示して進めます。
2. ユーザーが指定したファイル、ローカル情報、Web調査から材料を集めます。Web調査は依頼された場合、最新性が必要な場合、または正確な出典が必要な場合に限ります。
3. `rpt`を引数なしで実行し、現在のfrontmatter、Safe HTML、inline style、component、Mermaid、画像、出力規則を読みます。記憶やスキル本文の例よりhelpを優先します。
4. 作業用`.mdx`を作成します。構造は内容に合わせ、Badge、Status、Icon、Timeline、Tabs、Mermaid、Safe HTMLは情報を分かりやすくするときだけ使います。
5. `rpt build <input> -o <output>`を実行します。終了コード3は位置付き入力診断を読んでMDXを修正します。終了コード4は`--debug`で原因を調べ、validatorを迂回する入力へ弱めません。
6. HTMLとMDXの絶対パスを返します。Mermaidを使った場合は描画に固定CDNへの接続が必要で、失敗時もsourceが残ることを伝えます。
7. モバイルプレビューを求められた場合は、生成HTMLだけを専用ディレクトリの`index.html`へコピーし、`0.0.0.0`で配信して`mobile-preview-url <port>`を実行します。`/private/tmp`や作業tree全体は配信しません。

## Error handling

- `rpt`が見つからない場合は、インストールまたはchezmoi適用が必要であることを報告します。
- authoring contractの取得に失敗した場合はMDXを推測で生成しません。
- buildの入力エラーは診断箇所だけを最小修正し、禁止されたscript、式、属性、URL、CSSを別表記で通そうとしません。
- buildの内部エラーは`--debug`で原因を確認します。依存関係や実行権限の問題は入力内容と分離して報告します。
- モバイル接続でHTTP serverへTLS bytesが届いた場合は、HTTPSへの自動upgradeと判断し、Meshnet IPの`http://` URLを案内します。

## Deployment prerequisite

現在のchezmoi配布版では、`bun install`後の`node_modules/astro/astro.js`が実行不可になり、`.bin/astro`経由のbuildが`Permission denied`になります。スキルの実環境forward testを成立させるため、`rpt`のbuild処理を実行bitに依存しない`bun node_modules/astro/astro.js build`相当へ変更します。

この修正はsource版とdeployed版の両方で同じbuild pathを使い、既存の一時build directory隔離とexit code契約を維持します。

## Validation

### Baseline RED

スキルを見せないfresh subagentへ、材料付きの「`rpt`でレポートを作り、HTMLとMDXを返して」という依頼を渡します。次のいずれかを失敗として記録します。

- 引数なしhelpを読まず、存在しない構文または禁止構文を使う
- MDXを書くだけで`rpt build`を実行しない
- HTMLだけを返してMDXを残さない
- モバイルプレビューで広いdirectoryを配信する
- build失敗時に診断を調べず回避する

### GREEN

同じ依頼を`$rpt`と新スキルpath付きでfresh subagentへ渡し、help取得、MDX作成、build、HTML/MDX返却まで完了することを確認します。モバイル用scenarioではHTMLだけの専用directoryを配信対象にすることを確認します。

### Automated checks

- 3環境の`SKILL.md`がbyte-identicalであること
- frontmatterのnameとdescription、主要trigger、必須workflow、error handlingを検証すること
- `agents/openai.yaml`をskill-creatorのvalidatorで検証すること
- source版とchezmoi適用後の`rpt build`が同じfixtureを生成できること
- 既存のrpt E2E、safe style test、TypeScript/Astro checkがすべて成功すること

## Acceptance criteria

- `rpt`スキルがCodex、Claude、Cursorへchezmoi配布されます。
- 明示呼び出しとレポート作成依頼の両方で発見できるdescriptionになります。
- スキルは実行時の`rpt` helpを正本として使い、契約を重複保持しません。
- レポート作成、HTML生成、MDX返却、任意の安全なモバイルプレビューを完遂します。
- deployed `rpt build`がAstroの実行bitに依存せず成功します。
- baseline failureとforward-test successの証拠が残ります。
