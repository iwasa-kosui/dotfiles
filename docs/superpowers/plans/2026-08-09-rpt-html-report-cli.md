# rpt HTML Report CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 制限付きMDXをAstroとWebcoreUIで読みやすい自己完結型HTMLへ変換する`rpt` CLIを実装します。

**Architecture:** chezmoiで`~/.local/bin/rpt`と独立したAstroパッケージを配布します。CLIはMDXを実行せずASTとして検証し、一意な一時Astroプロジェクトで静的ビルドしてから全アセットをHTMLへ埋め込みます。

**Tech Stack:** Bun 1.3.14、TypeScript 5.9.3、Astro 5.18.2、`@astrojs/mdx` 4.3.13、WebcoreUI 1.5.0、Sass 1.100.0、unified/remark、parse5 8.0.1、`bun:test`

## Global Constraints

- 初期版の動作保証対象はmacOSとBunです。
- CLI名は`rpt`、基本形は`rpt build <input.mdx|-> -o <output.html>`です。
- `title`だけを必須frontmatterとし、未知のfrontmatterキーを拒否します。
- MDX import、export、JavaScript式、生HTML、未登録タグ、動的属性をAstro実行前に拒否します。
- 許可する専用タグは`Callout`、`Metric`、`Evidence`、`Section`だけです。
- 画像は入力基準ディレクトリ内の相対パスまたはbase64 raster data URLだけを許可します。MIME typeはPNG、JPEG、GIF、WebP、AVIFに限定し、magic bytesと照合します。
- 生成物はCSSと画像を埋め込んだ単一HTMLとし、クライアントJavaScriptと外部アセットを含めません。
- UIはPCで固定目次を持つ読み物型、スマートフォンで1列、印刷時にA4向けとなる構成です。
- 入力と画像1件の上限は5MiB、decode後画像合計の上限は20MiBです。data URL画像も合計へ含めます。
- 既存出力は`--force`がない限り変更しません。
- 初期版の自動テストは実際のCLIプロセスを起動するE2Eを中心にします。制限付きMDXから生成できない敵対的HTMLとpublish raceだけはfocused boundary testを許可します。
- 依存関係は`dot_local/lib/rpt/package.json`と`bun.lock`へ正確なバージョンで固定します。

---

## File Structure

- `dot_local/bin/executable_rpt`: Bun shebangを持つ薄いCLIエントリーポイントです。
- `dot_local/lib/rpt/package.json`, `bun.lock`, `tsconfig.json`: 独立Astroパッケージの依存と検証設定です。
- `dot_local/lib/rpt/src/result.ts`: 成功値と利用者向け失敗の判別共用体です。
- `dot_local/lib/rpt/src/args.ts`: CLI引数を`Command`へ変換します。
- `dot_local/lib/rpt/src/input.ts`: ファイルまたはstdinをdescriptorから上限付きで読み、5MiB制限を適用します。
- `dot_local/lib/rpt/src/validate.ts`: frontmatter、MDX AST、URL、専用タグを検証します。
- `dot_local/lib/rpt/src/build.ts`: 一時Astroプロジェクトを作り、静的ビルドを実行します。
- `dot_local/lib/rpt/src/inline-assets.ts`: ローカルアセットをdata URLへ変換します。
- `dot_local/lib/rpt/src/output.ts`: 既存ファイル保護とatomic writeを担当します。
- `dot_local/lib/rpt/src/cli.ts`: 処理順、診断表示、終了コードを統合します。
- `dot_local/lib/rpt/template/`: Astro config、MDX host page、layout、components、SCSSを保持します。
- `tests/rpt.e2e.test.ts`: 全受入条件をCLIの外側から検証します。
- `run_onchange_after_install-rpt-dependencies.sh.tmpl`: packageとlockfileの変更時に固定依存を導入します。

## Shared Interfaces

```ts
export type ExitCode = 2 | 3 | 4 | 5;
export type Failure = Readonly<{
  kind: "usage" | "input" | "build" | "io";
  exitCode: ExitCode;
  message: string;
  hint?: string;
  location?: Readonly<{ line: number; column: number }>;
  cause?: unknown;
}>;
export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Failure }>;
export type ReportMetadata = Readonly<{
  title: string;
  summary?: string;
  author?: string;
  createdAt?: string;
  status?: "draft" | "final" | "archived";
  tags?: readonly string[];
}>;
export type OutlineItem = Readonly<{ depth: 2 | 3; text: string; slug: string }>;
export type AssetReference = Readonly<{ sourcePath: string; relativePath: string }>;
export type ValidatedReport = Readonly<{
  source: string;
  baseDirectory: string;
  metadata: ReportMetadata;
  outline: readonly OutlineItem[];
  assets: readonly AssetReference[];
  decodedDataImageBytes: number;
  mainContentId: string;
}>;
```

---

### Task 1: CLI契約と独立パッケージ

**Files:**
- Create: `tests/rpt.e2e.test.ts`
- Create: `dot_local/bin/executable_rpt`
- Create: `dot_local/lib/rpt/package.json`
- Create: `dot_local/lib/rpt/bun.lock`
- Create: `dot_local/lib/rpt/tsconfig.json`
- Create: `dot_local/lib/rpt/src/result.ts`
- Create: `dot_local/lib/rpt/src/args.ts`
- Create: `dot_local/lib/rpt/src/cli.ts`

**Interfaces:**
- Consumes: なし。
- Produces: `parseArgs(argv: readonly string[]): Result<Command>`、`runCli(argv: readonly string[]): Promise<number>`、`Failure`、`Result<T>`。

- [ ] **Step 1: CLIプロセスを起動するE2Eヘルパーと失敗テストを書く**

```ts
const repositoryRoot = join(import.meta.dir, "..");
const cliPath = join(repositoryRoot, "dot_local/bin/executable_rpt");

async function runRpt(args: readonly string[], options: { cwd?: string; stdin?: string } = {}) {
  const process = Bun.spawn(["bun", cliPath, ...args], {
    cwd: options.cwd ?? repositoryRoot,
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.stdin !== undefined) {
    process.stdin.write(options.stdin);
    process.stdin.end();
  }
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}
```

`--help`がusageを返すこと、`--version`が`0.1.0`を返すこと、`rpt build report.mdx`が終了コード`2`と`rpt: --output is required`を返すことをテストします。

- [ ] **Step 2: テストを実行してCLI未作成で失敗することを確認する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Expected: FAIL。`dot_local/bin/executable_rpt`が存在しません。

- [ ] **Step 3: packageと固定依存を作る**

`package.json`を`name: rpt`、`version: 0.1.0`、`private: true`、`type: module`で作ります。scriptsは`check: tsc --noEmit && astro check --root template`と`test:e2e: bun test ../../../tests/rpt.e2e.test.ts --timeout 120000`です。

```sh
bun add --cwd dot_local/lib/rpt --exact astro@5.18.2 @astrojs/mdx@4.3.13 webcoreui@1.5.0 sass@1.100.0 typescript@5.9.3 parse5@8.0.1 @astrojs/check unified remark-parse remark-mdx remark-frontmatter remark-gfm yaml github-slugger
```

生成された正確なバージョンを`package.json`と`bun.lock`へ追跡します。`tsconfig.json`は`astro/tsconfigs/strict`を継承します。

- [ ] **Step 4: CLI契約を最小実装する**

```ts
export type Command =
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "version" }>
  | Readonly<{ kind: "build"; input: string; output: string; force: boolean; debug: boolean }>;
```

未知option、余分な位置引数、`-o`の値不足は`usage`失敗にします。Task 1では正しいbuildを`rpt: report build is not implemented`、終了コード`4`で止めます。

```ts
#!/usr/bin/env bun
import { runCli } from "../lib/rpt/src/cli.ts";
process.exitCode = await runCli(Bun.argv.slice(2));
```

- [ ] **Step 5: CLI契約テストを通す**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Expected: help、version、usageの3ケースがPASSします。

- [ ] **Step 6: Task 1をコミットする**

```sh
git add tests/rpt.e2e.test.ts dot_local/bin/executable_rpt dot_local/lib/rpt
git commit -m "feat(rpt): CLI契約と固定依存パッケージを追加"
```

---

### Task 2: 制限付きMDXの入力検証

**Files:**
- Modify: `tests/rpt.e2e.test.ts`
- Create: `dot_local/lib/rpt/src/input.ts`
- Create: `dot_local/lib/rpt/src/validate.ts`
- Modify: `dot_local/lib/rpt/src/cli.ts`

**Interfaces:**
- Consumes: Task 1の`Result<T>`、`Failure`、`Command`。
- Produces: `readInput(input: string, cwd: string): Promise<Result<ReportInput>>`、`validateReport(input: ReportInput): Result<ValidatedReport>`。

- [ ] **Step 1: 禁止入力のE2E失敗テストを書く**

一時MDXを作る`createCase(source)`を追加し、次のtable-driven casesを実際の`rpt`で実行します。

```ts
const rejectedMdx = [
  ["missing title", "---\nsummary: x\n---\n# Report", "frontmatter.title is required"],
  ["import", "---\ntitle: X\n---\nimport x from 'node:fs'", "import and export are not allowed"],
  ["expression", "---\ntitle: X\n---\n{process.cwd()}", "JavaScript expressions are not allowed"],
  ["raw HTML", "---\ntitle: X\n---\n<script>alert(1)</script>", "raw HTML is not allowed"],
  ["unknown tag", "---\ntitle: X\n---\n<Button>run</Button>", "component Button is not allowed"],
] as const;
```

各ケースで終了コード`3`、行・列付きstderr、出力ファイル不存在を確認します。さらに未知frontmatter、無効な日付・status・tags、動的属性、`style`、`on*`、非HTTPS Evidence source、remote image、基準外画像、5MiB超過、不正なdata URL画像を追加します。

- [ ] **Step 2: テストを実行して未検証入力がbuild失敗へ進むことを確認する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Expected: 新しい拒否ケースが終了コード`4`または不正な診断でFAILします。

- [ ] **Step 3: 入力読込と5MiB制限を実装する**

```ts
export type ReportInput = Readonly<{ source: string; baseDirectory: string }>;
export async function readInput(input: string, cwd: string): Promise<Result<ReportInput>>;
```

ファイル入力では入力ファイルの親、stdinではcwdを`baseDirectory`にします。path-levelの`stat`と`readFile`に分けず、nonblockingで開いたdescriptorがregular fileであることを確認します。descriptor sizeを確認したうえで最大5MiB+1byteだけを読み、超過は`input`失敗、FIFO、device、directory、ファイル不存在、読取失敗は`io`失敗にします。

- [ ] **Step 4: 実行しないMDX allowlist検証を実装する**

```ts
const tree = unified()
  .use(remarkParse)
  .use(remarkMdx)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .parse(input.source);
```

最初の`yaml` nodeを`yaml.parseDocument(value, { uniqueKeys: true })`で解析し、`document.toJS({ maxAliasCount: 0 })`で値へ変換します。`mdxjsEsm`、`mdxFlowExpression`、`mdxTextExpression`、`html`を拒否します。MDX JSXは`attributes`配列も明示的に走査し、expression/spread属性を拒否します。

```ts
const componentRules = {
  Callout: { required: ["tone"], optional: ["title"], tones: ["info", "success", "warning", "danger"] },
  Metric: { required: ["label", "value"], optional: [], children: false },
  Evidence: { required: ["title", "source"], optional: [], sourceProtocol: "https:" },
  Section: { required: ["title"], optional: [], topLevelOnly: true, nested: false },
} as const;
```

リンクは相対URL、fragment、HTTPS、`mailto:`だけを許可します。画像はbase64形式のPNG、JPEG、GIF、WebP、AVIF data URLまたは基準内相対パスだけを許可します。data URLはdecode後のmagic bytesと宣言MIMEを照合し、1件5MiBと全画像20MiBの上限を適用します。見出しは`github-slugger`でslug化します。`Section`には`section-`接頭辞のslugを割り当て、利用者が指定できない内部`anchor`属性を開始タグへ後ろのoffsetから挿入します。見出しと`Section`の全IDを使って衝突しない`mainContentId`を割り当てます。

- [ ] **Step 5: CLIへ検証を接続する**

`readInput`、`validateReport`の順で呼びます。診断を`rpt: <line>:<column>: <message>`と任意の`hint:`へ統一します。`--debug`時だけcause stackを追記します。検証成功後はTask 1のbuild未実装エラーへ進めます。

- [ ] **Step 6: 入力拒否E2Eを通す**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Expected: Task 1とすべての入力拒否ケースがPASSします。

- [ ] **Step 7: Task 2をコミットする**

```sh
git add tests/rpt.e2e.test.ts dot_local/lib/rpt/src
git commit -m "feat(rpt): 未信頼MDXを実行前にallowlist検証"
```

---

### Task 3: AstroとWebcoreUIによる読み物型レポート

**Files:**
- Modify: `tests/rpt.e2e.test.ts`
- Create: `dot_local/lib/rpt/src/build.ts`
- Modify: `dot_local/lib/rpt/src/cli.ts`
- Create: `dot_local/lib/rpt/template/package.json`
- Create: `dot_local/lib/rpt/template/astro.config.mjs`
- Create: `dot_local/lib/rpt/template/webcore.config.scss`
- Create: `dot_local/lib/rpt/template/src/content/report.mdx`
- Create: `dot_local/lib/rpt/template/src/content/report-data.json`
- Create: `dot_local/lib/rpt/template/src/pages/index.astro`
- Create: `dot_local/lib/rpt/template/src/layouts/ReportLayout.astro`
- Create: `dot_local/lib/rpt/template/src/components/Callout.astro`
- Create: `dot_local/lib/rpt/template/src/components/Metric.astro`
- Create: `dot_local/lib/rpt/template/src/components/Evidence.astro`
- Create: `dot_local/lib/rpt/template/src/components/Section.astro`
- Create: `dot_local/lib/rpt/template/src/styles/report.scss`

**Interfaces:**
- Consumes: Task 2の`ValidatedReport`。
- Produces: `buildReport(report: ValidatedReport, packageRoot: string): Promise<Result<BuiltReport>>`。

- [ ] **Step 1: 読み物型HTML生成のE2E失敗テストを書く**

次の要素を含む有効MDXを実際のCLIへ渡します。

```mdx
---
title: 開発環境の移行調査
summary: 段階的な移行を推奨します。
author: Platform Team
createdAt: 2026-08-09
status: final
tags: [migration, tooling]
---

## 結論

<Callout tone="success" title="推奨案">段階的に移行します。</Callout>

<Metric label="削減工数" value="24%" />

<Evidence title="試行結果" source="https://example.com/evidence">重大な障害はありませんでした。</Evidence>

<Section title="次の対応">
2週間の試行を開始します。
</Section>
```

```ts
expect(result.exitCode).toBe(0);
expect(result.stdout).toBe(`${testCase.output}\n`);
const html = await Bun.file(testCase.output).text();
expect(html).toContain("<title>開発環境の移行調査</title>");
expect(html).toContain('data-rpt-component="callout"');
expect(html).toContain('data-rpt-component="metric"');
expect(html).toContain('data-rpt-component="evidence"');
expect(html).toContain('id="section-次の対応"');
expect(html).toContain('aria-label="目次"');
expect(html).toContain('class="rpt-skip-link"');
expect(html).not.toContain("<script");
```

- [ ] **Step 2: テストを実行してbuild未実装で失敗することを確認する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Expected: 成功生成ケースだけが`rpt: report build is not implemented`でFAILします。

- [ ] **Step 3: 再現可能な一時Astroビルドを実装する**

```ts
export type BuiltReport = Readonly<{
  html: string;
  distDirectory: string;
  cleanup: () => Promise<void>;
}>;
export async function buildReport(
  report: ValidatedReport,
  packageRoot: string,
): Promise<Result<BuiltReport>>;
```

`mkdtemp(join(tmpdir(), "rpt-build-"))`へ`template`を再帰コピーし、`report.mdx`と`report-data.json`だけを置き換えます。`node_modules`は`symlink(join(packageRoot, "node_modules"), join(temp, "node_modules"), "dir")`で固定済み依存を参照します。

```ts
const process = Bun.spawn(["bun", "--cwd", temporaryRoot, "run", "astro", "build"], {
  stdout: "pipe",
  stderr: "pipe",
});
```

終了コードが0以外、`dist/index.html`がない、複数HTMLを生成した場合は`build`失敗にします。一時ディレクトリの削除は`cleanup()`へ集約します。

- [ ] **Step 4: Astro、MDX、WebcoreUIテンプレートを実装する**

```js
import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";
import { webcore } from "webcoreui/integration";

export default defineConfig({
  output: "static",
  outDir: "./dist",
  cacheDir: "./.astro-cache",
  integrations: [mdx(), webcore()],
  build: { format: "file", inlineStylesheets: "always" },
});
```

共有`node_modules/.astro`へ書かないよう`cacheDir`をtemp内へ固定します。AI入力にはimportさせず、host pageから安全なcomponent mapを渡します。

```astro
---
import { Content } from "../content/report.mdx";
import reportData from "../content/report-data.json";
import Callout from "../components/Callout.astro";
import Evidence from "../components/Evidence.astro";
import Metric from "../components/Metric.astro";
import Section from "../components/Section.astro";
import ReportLayout from "../layouts/ReportLayout.astro";
---
<ReportLayout metadata={reportData.metadata} outline={reportData.outline} mainContentId={reportData.mainContentId}>
  <Content components={{ Callout, Evidence, Metric, Section }} />
</ReportLayout>
```

WebcoreUI対応は次へ限定します。

- `Callout`: `Alert`を使い、`danger`だけ`theme="alert"`へ変換します。利用者titleはraw HTML対応propへ渡さず本文内でescaped textとして表示します。
- `Metric`: `Card compact flat`を使い、labelとvalueをescaped textとして表示します。
- `Evidence`: `Card flat`を使います。WebcoreUI 1.5.0の`Card.title`は`set:html`を使うため渡しません。
- `Section`: semantic `section`と`h2`を使い、内部`anchor`だけをidへ設定します。
- status: 検証済みenumだけを`Badge`へ渡します。

- [ ] **Step 5: 読み物型、スマートフォン、印刷CSSを実装する**

`report.scss`で`@use "webcoreui/styles" as *;`と引数なし`@include setup();`を使い、font URLを生成しません。

```scss
.rpt-shell { max-width: 72rem; margin-inline: auto; }
.rpt-grid { display: grid; grid-template-columns: 15rem minmax(0, 47.5rem); gap: 3rem; }
.rpt-toc { position: sticky; top: 1rem; align-self: start; }
.rpt-article { min-width: 0; overflow-wrap: anywhere; }
.rpt-skip-link:not(:focus) { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; }
@media (max-width: 48rem) {
  .rpt-grid { grid-template-columns: 1fr; gap: 1.5rem; }
  .rpt-toc { position: static; }
}
@media print {
  @page { size: A4; margin: 18mm; }
  .rpt-toc, .rpt-skip-link { display: none; }
  .rpt-grid { display: block; }
}
```

目次は`nav aria-label="目次"`とし、スマートフォンでは`details`/`summary`だけで折りたたみます。layoutの`main` IDとskip linkは検証時に割り当てた同じ`mainContentId`を使います。Astro client directiveとscriptは追加しません。

- [ ] **Step 6: CLIへbuildを接続して生成E2Eを通す**

`cli.ts`で検証後に`buildReport`を呼びます。Task 3では返されたHTMLを直接出力先へ書き、Task 4で単一HTML化とatomic writeへ置き換えます。成功時は`resolve(output)`をstdoutへ表示し、`cleanup()`を`finally`で実行します。

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Expected: 読み物型生成ケースとTask 1・2の全ケースがPASSします。

- [ ] **Step 7: Task 3をコミットする**

```sh
git add tests/rpt.e2e.test.ts dot_local/lib/rpt/src dot_local/lib/rpt/template
git commit -m "feat(rpt): AstroとWebcoreUIで読み物型レポートを生成"
```

---

### Task 4: 自己完結HTMLと安全な出力

**Files:**
- Modify: `tests/rpt.e2e.test.ts`
- Create: `dot_local/lib/rpt/src/inline-assets.ts`
- Create: `dot_local/lib/rpt/src/output.ts`
- Modify: `dot_local/lib/rpt/src/build.ts`
- Modify: `dot_local/lib/rpt/src/cli.ts`

**Interfaces:**
- Consumes: Task 3の`BuiltReport`。
- Produces: `inlineAssets(html: string, distDirectory: string): Promise<Result<string>>`、`writeOutput(html: string, output: string, force: boolean): Promise<Result<string>>`。

- [ ] **Step 1: 画像、stdin、上書き、同時実行のE2E失敗テストを書く**

テスト内で1x1 PNGを入力ディレクトリへ書きます。

```ts
const png = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
  (character) => character.charCodeAt(0),
);
await Bun.write(join(testCase.directory, "pixel.png"), png);
```

次を実CLIで検証します。

- `![pixel](./pixel.png)`が`data:image/png;base64,`へ変換されます。
- HTMLにscript、外部stylesheet、外部画像、CSS `@import`、非data `url()`が残りません。
- `rpt build - -o report.html`がstdinから生成します。
- `--force`なしでは既存出力を終了コード`5`で拒否し、元内容を維持します。
- `--force`付きでは既存出力を置き換えます。
- 無効入力では不完全な出力を残しません。
- 異なるtitleの2プロセスを`Promise.all`で実行しても内容が混ざりません。

- [ ] **Step 2: テストを実行して単一HTML契約と安全な書込が未実装で失敗することを確認する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Expected: 画像埋め込み、stdin、上書き、同時実行の新規ケースがFAILします。

- [ ] **Step 3: 入力画像を一時Astroプロジェクトへ安全にコピーする**

`AssetReference`ごとに`sourcePath`を一時projectの`src/content/<relativePath>`へコピーします。親ディレクトリを作り、コピー直前に`realpath(sourcePath)`が`realpath(baseDirectory)`配下であることを再確認します。nonblockingで開いたdescriptorのidentityとregular fileを確認し、descriptor sizeと最大5MiB+1byteの実読込を検査します。data URLのdecode後byte数を含め、合計20MiBを超えた時点で拒否します。

許可MIME typeはPNG、JPEG、GIF、WebP、AVIFです。拡張子だけでなくmagic bytesを確認し、SVGと未知形式は入力エラーとして拒否します。

- [ ] **Step 4: parse5でローカルアセットをdata URLへ変換する**

```ts
export async function inlineAssets(
  html: string,
  distDirectory: string,
): Promise<Result<string>>;
```

`parse5.parse(html, { scriptingEnabled: false, sourceCodeLocationInfo: true })`でdocumentを作り、再帰走査します。`img[src]`と`source[src]`のローカルファイルを読み、MIME typeとbase64からdata URLへ変換します。`srcset`は各候補を変換します。

変換後に次を拒否します。

- stylesheetの`link[href]`
- inline scriptと`script[src]`
- 非dataの`img/src|srcset`、`source/src|srcset`、`video/src|poster`、`audio[src]`
- `iframe[src]`、`embed[src]`、`object[data]`
- SVG `use[href|xlink:href]`
- style属性
- style本文の`@import`とdata URL以外の`url(...)`

通常の`a[href]`にあるHTTPS Evidence参照はfragmentを含めて維持します。最終DOMの全`id`が一意であること、`href`が内部fragmentの場合は対象IDがちょうど1件あることを確認します。最後に`parse5.serialize(document)`を返します。

- [ ] **Step 5: 同一ディレクトリの一時ファイルを使う出力を実装する**

```ts
export async function writeOutput(
  html: string,
  output: string,
  force: boolean,
): Promise<Result<string>>;
```

出力先を絶対パス化し、親ディレクトリが存在することを確認します。`--force`なしで出力が存在すれば書込前に`io`失敗を返します。`.<basename>.rpt-<random>.tmp`を同じディレクトリへexclusive createし、HTMLを書いてcloseした後、`--force`なしはexclusive hard linkでno-replace publishして成功後にtempをunlinkし、`--force`ありだけrenameで置換します。失敗時は一時ファイルだけを削除します。

- [ ] **Step 6: CLI処理順を完成させて全E2Eを通す**

```text
parse args → reject existing output → read input → validate MDX
→ build Astro → inline assets → write output → print absolute path
```

すべての一時ディレクトリと一時出力を`finally`で片付けます。入力、build、I/Oをそれぞれ終了コード`3`、`4`、`5`へ対応付けます。

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Expected: 全E2EテストPASS。

- [ ] **Step 7: Task 4をコミットする**

```sh
git add tests/rpt.e2e.test.ts dot_local/lib/rpt/src
git commit -m "feat(rpt): アセット埋め込みと安全なHTML出力を追加"
```

---

### Task 5: chezmoi配布と完了検証

**Files:**
- Modify: `tests/rpt.e2e.test.ts`
- Modify: `dot_local/lib/rpt/package.json`
- Create: `run_onchange_after_install-rpt-dependencies.sh.tmpl`

**Interfaces:**
- Consumes: Task 1〜4の完成したCLI。
- Produces: chezmoi apply後に固定依存が導入され、全受入条件を満たす`rpt`。

- [ ] **Step 1: 残りの最終受入条件をE2Eへ追加する**

次を実CLIで検証します。

- `--debug`なしではstackを表示せず、`--debug`では存在しない入力ファイルの読取causeを表示します。
- 長いURL、コードブロック、GFM table、footnoteを含むMDXが成功します。
- 出力に`@media (max-width: 48rem)`、`@media print`、`@page`が含まれます。
- 出力に目次、skip link、`main`、`article`が含まれます。
- `Callout tone="danger"`がWebcoreUIの`alert` themeへ変換されます。
- `## report-content`、`Section`、footnoteを含むHTMLで全IDが一意になり、skip link、目次、footnoteのfragmentがそれぞれ1件のIDへ解決します。
- 生成HTML以外の一時ファイルが出力先へ残りません。

- [ ] **Step 2: 最終E2Eを実行して未対応契約を確認する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Expected: 未対応の新規受入条件だけがFAILします。すでにすべて満たす場合はその結果を記録してStep 3へ進みます。

- [ ] **Step 3: E2Eが示した外部挙動だけを完成させる**

内部専用テストや追加機能は作りません。`package.json`のscriptsは次へ揃えます。

```json
{
  "scripts": {
    "check": "tsc --noEmit && astro check --root template",
    "test:e2e": "bun test ../../../tests/rpt.e2e.test.ts --timeout 120000"
  }
}
```

- [ ] **Step 4: chezmoiのonchange依存導入を追加する**

既存の`run_onchange_after_sheldon-lock.sh.tmpl`と同じhash埋込構文を使います。

```gotemplate
{{ if eq .chezmoi.os "darwin" -}}
#!/bin/zsh
# rpt package.json hash: {{ include "dot_local/lib/rpt/package.json" | sha256sum }}
# rpt bun.lock hash: {{ include "dot_local/lib/rpt/bun.lock" | sha256sum }}
set -euo pipefail

if command -v bun &> /dev/null; then
  cd "{{ .chezmoi.homeDir }}/.local/lib/rpt"
  bun install --frozen-lockfile
fi
{{ end -}}
```

`bun`がない場合はchezmoi apply全体を壊さず、CLI利用時に依存不足を明示します。

- [ ] **Step 5: 型、Astro、E2E、配布差分を検証する**

```sh
bun --cwd dot_local/lib/rpt run check
bun test tests/rpt.e2e.test.ts --timeout 120000
git diff --check
chezmoi diff -S /Users/kosui/.local/share/chezmoi/.wt/feat/mdx-astro-webcore-report-cli ~/.local/bin/rpt ~/.local/lib/rpt
```

Expected: type/astro checkと全E2Eが成功し、whitespace errorがありません。chezmoi差分は`rpt`エントリーポイント、`~/.local/lib/rpt`、依存導入スクリプトだけです。

- [ ] **Step 6: 仕様書との最終照合を行う**

`docs/superpowers/specs/2026-08-09-rpt-html-report-cli-design.md`の完了条件を上から確認し、各条件をE2E結果またはStep 5の結果へ対応付けます。未対応条件があれば完了を宣言せず、該当タスクへ戻ります。

- [ ] **Step 7: Task 5をコミットする**

```sh
git add tests/rpt.e2e.test.ts dot_local/lib/rpt/package.json run_onchange_after_install-rpt-dependencies.sh.tmpl
git commit -m "chore(rpt): chezmoi適用時に固定依存を導入"
```

---

## Final Verification

```sh
bun --cwd dot_local/lib/rpt run check
bun test tests/rpt.e2e.test.ts --timeout 120000
git diff --check
git status --short
```

仕様書、本計画、`dot_local/bin/executable_rpt`、`dot_local/lib/rpt/**`、`tests/rpt.e2e.test.ts`、`run_onchange_after_install-rpt-dependencies.sh.tmpl`以外の追跡ファイルが変更されていないことを確認します。
