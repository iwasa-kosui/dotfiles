# rpt Rich Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rpt`へsafe HTML、safe inline style、Mermaid、Badge、Status、Icon、Timeline、CSS-only Tabsを追加し、Mermaid以外のJavaScriptを許可しない単一HTMLを生成する。

**Architecture:** 既存のremark-mdx AST allowlistを、safe HTML、component schema、Mermaid検証の小さなモジュールへ分割する。検証済みMDXだけをAstroへ渡し、Mermaidがある場合だけ固定CDNとnonce付き固定初期化scriptを出力する。最終DOM検査はbuild時に生成したpolicyを受け取り、入力検証と独立して出力契約を再検証する。

**Tech Stack:** Bun 1.3、TypeScript 5.9、Astro 5.18、remark-mdx 3.1、css-tree 3.2、parse5 8、WebcoreUI 1.5、Mermaid browser bundle 11.16.0（CDN）

## Global Constraints

- CLI入力は制限付きMDXだけとし、`.html`ファイル入力は追加しない。
- 入力上限は5MiB、画像は1件5MiB、合計20MiBを維持する。
- 未信頼入力はAstro実行前に拒否し、黙って削除・修復しない。
- safe HTMLはspecの小文字要素、静的属性、親子構造だけを許可し、`class`、`data-*`、event handler、式属性、spread属性を拒否する。
- inline styleはspecのproperty allowlistだけを許可し、URL、固定配置、重なり、動的CSSを拒否する。
- IconはWebcoreUI 1.5.0同梱の固定20種類だけを許可する。
- TabsはCSS radioで切り替え、JavaScriptを使わず、印刷時は全panelを表示する。
- Mermaidは小文字の`mermaid` fenced codeだけを対象とし、1図64KiB、1レポート20図までとする。
- Mermaid frontmatterとinit directiveを拒否し、`securityLevel: "strict"`を利用者が上書きできないようにする。
- Mermaid CDNは`https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js`へ固定する。
- Mermaidなしの出力はscript 0件かつ外部asset 0件、Mermaidありは固定CDN scriptと固定初期化scriptだけを許可する。
- 新しいnpm依存は追加しない。
- 既存のCallout、Metric、Evidence、Section、frontmatter、画像、atomic write、終了コードを維持する。

---

### Task 1: Safe inline style validator

**Files:**
- Create: `dot_local/lib/rpt/src/safe-style.ts`
- Create: `tests/rpt-safe-style.test.ts`

**Interfaces:**
- Consumes: CSS declaration list文字列。
- Produces: `safeStyleViolation(value: string): string | undefined`。`undefined`は許可、文字列は利用者向け診断。

- [ ] **Step 1: propertyとvalue境界の失敗テストを書く**

```ts
import { expect, test } from "bun:test";
import { safeStyleViolation } from "../dot_local/lib/rpt/src/safe-style.ts";

const allowed = [
  "color: #123; padding: 1rem; display: grid; gap: 0.5rem",
  "grid-template-columns: repeat(2, minmax(0, 1fr))",
  "color: var(--w-color-success)",
];

for (const value of allowed) {
  test("safe style accepts " + value, () => {
    expect(safeStyleViolation(value)).toBeUndefined();
  });
}

const rejected = [
  ["position: fixed", "style property position is not allowed"],
  ["background-color: url(https://example.com/x)", "style URLs are not allowed"],
  ["color: red !important", "style !important is not allowed"],
  ["--x: red", "custom style properties are not allowed"],
  ["color: var(--user-color)", "style variable is not allowed"],
  ["color: red; color: blue", "style property color may only be specified once"],
] as const;
```

- [ ] **Step 2: focused testを実行してmodule未作成でREDを確認する**

Run: `bun test tests/rpt-safe-style.test.ts`

Expected: FAIL with `Cannot find module '../dot_local/lib/rpt/src/safe-style.ts'`。

- [ ] **Step 3: css-treeを使う最小validatorを実装する**

```ts
export function safeStyleViolation(value: string): string | undefined {
  const ast = parseCss(value, {
    context: "declarationList",
    parseCustomProperty: true,
    onParseError(error) { throw error; },
  });
  // Declarationごとにdecoded propertyをallowlistと照合する。
  // duplicate、important、custom propertyを拒否する。
  // walkCssでUrlと禁止Functionを拒否し、var()は--w-*引数1件だけ許可する。
  return undefined;
}
```

property setはspecの色、文字、box、Flex/Grid、表、リストを完全に列挙する。shorthandの`margin`、`padding`、`border`は許可するが、`background`は許可しない。parse errorは`style is invalid CSS`へ正規化する。

- [ ] **Step 4: focused testをGREENにする**

Run: `bun test tests/rpt-safe-style.test.ts`

Expected: all pass。

- [ ] **Step 5: 型検査を実行する**

Run: `bun run --cwd dot_local/lib/rpt check`

Expected: 0 errors、0 warnings、0 hints。

- [ ] **Step 6: Task 1をコミットする**

```bash
git add dot_local/lib/rpt/src/safe-style.ts tests/rpt-safe-style.test.ts
git commit -m "feat(rpt): inline styleを安全なCSSに制限" -m "Co-Authored-By: Codex GPT-5 <noreply@openai.com>"
```

---

### Task 2: Safe semantic HTML allowlist

**Files:**
- Create: `dot_local/lib/rpt/src/validation-types.ts`
- Create: `dot_local/lib/rpt/src/safe-url.ts`
- Create: `dot_local/lib/rpt/src/safe-html.ts`
- Modify: `dot_local/lib/rpt/src/validate.ts:15-180`
- Modify: `dot_local/lib/rpt/src/inline-assets.ts:62-82,575-650`
- Modify: `tests/rpt.e2e.test.ts:230-345,577-640`

**Interfaces:**
- Consumes: remark-mdxの`TreeNode`、直近parent、既知HTML ID set。
- Produces: `validateSafeHtmlElement(node, parent, ids): ValidationIssue | undefined`、`isAllowedNavigationUrl(value): boolean`。
- Shared types: `Positioned`、`Attribute`、`TreeNode`、`ValidationIssue`を`validation-types.ts`からexportする。

- [ ] **Step 1: safe HTML成功E2Eを書く**

入力へ次を追加し、実CLI出力をparse5で確認する。

```mdx
<section id="details" role="region" aria-label="詳細" style="display: grid; gap: 1rem">
  <details open="true">
    <summary>内訳</summary>
    <table><tbody><tr><th scope="row">状態</th><td>正常</td></tr></tbody></table>
  </details>
</section>
```

期待値は終了コード`0`、`id="details"`、`aria-label="詳細"`、safe styleの保持、script不在とする。

- [ ] **Step 2: HTML拒否tableをE2Eへ追加する**

```ts
const rejectedSafeHtml = [
  ["script", '<script>alert(1)</script>', "element script is not allowed"],
  ["class", '<div class="x">x</div>', "attribute class is not allowed on div"],
  ["event", '<div onClick="x">x</div>', "attribute onClick is not allowed on div"],
  ["raw image", '<img src="x.png" />', "element img is not allowed"],
  ["heading", '<h2>Hidden outline</h2>', "element h2 is not allowed"],
  ["reserved id", '<div id="rpt-user">x</div>', "id prefix rpt- is reserved"],
  ["duplicate id", '<div id="same">a</div><span id="same">b</span>', "id may only be specified once"],
  ["invalid child", '<ul><div>x</div></ul>', "ul may only contain li elements"],
  ["unsafe style", '<div style="position: fixed">x</div>', "style property position is not allowed"],
] as const;
```

各caseで終了コード`3`、行列付きstderr、出力不存在を確認する。

- [ ] **Step 3: E2Eを実行してraw HTML拒否でREDを確認する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000 -t "safe HTML|HTML rejects"`

Expected: safe HTML成功caseが`raw HTML is not allowed`、拒否caseが旧診断または誤った診断でFAIL。

- [ ] **Step 4: shared AST型とURL policyを抽出する**

`validate.ts`の`Point`、`Positioned`、`Attribute`、`TreeNode`を`validation-types.ts`へ移す。既存`isAllowedLink`を次へ置換する。

```ts
export function isAllowedNavigationUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("#") || trimmed.toLowerCase().startsWith("mailto:")) return true;
  if (trimmed.startsWith("//")) return false;
  const scheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.exec(trimmed)?.[0];
  return scheme === undefined || scheme.toLowerCase() === "https:";
}
```

既存Markdown linkとsafe HTMLの`href`、`cite`で同じ関数を使う。

- [ ] **Step 5: safe HTML validatorを実装してvalidate.tsへ接続する**

```ts
export function validateSafeHtmlElement(
  node: TreeNode,
  parent: TreeNode | undefined,
  ids: Set<string>,
): ValidationIssue | undefined;
```

小文字nameだけを対象に、specのelement set、global attribute、element-specific attribute、role、ARIA、URL、parent-child ruleを照合する。属性は静的文字列だけを許可し、`style`は`safeStyleViolation`へ渡す。`id`は`rpt-`を拒否し、その場で`ids`へ登録する。`validateNode`は小文字nameをsafe HTML、大文字nameを専用componentへ振り分ける。`node.type === "html"`は引き続き拒否する。

- [ ] **Step 6: 最終DOMでもsafe styleを再検証する**

`inline-assets.ts`の「style属性はMarkdown table align以外拒否」を、`safeStyleViolation`が通るstyleだけ許可する処理へ置換する。Astroが生成したMarkdown tableの`text-align`も同じvalidatorを通す。最終DOMのnavigation URLも`safe-url.ts`へ統一する。

- [ ] **Step 7: E2Eと全回帰をGREENにする**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Expected: safe HTML追加caseと既存72件がすべてpass。

- [ ] **Step 8: 型検査とdiffを確認する**

Run: `bun run --cwd dot_local/lib/rpt check`

Run: `git diff --check`

Expected: errorsなし。

- [ ] **Step 9: Task 2をコミットする**

```bash
git add dot_local/lib/rpt/src/validation-types.ts dot_local/lib/rpt/src/safe-url.ts dot_local/lib/rpt/src/safe-html.ts dot_local/lib/rpt/src/validate.ts dot_local/lib/rpt/src/inline-assets.ts tests/rpt.e2e.test.ts
git commit -m "feat(rpt): セマンティックHTMLをallowlistで許可" -m "Co-Authored-By: Codex GPT-5 <noreply@openai.com>"
```

---

### Task 3: Component schema and Tabs source rewriting

**Files:**
- Create: `dot_local/lib/rpt/src/component-rules.ts`
- Modify: `dot_local/lib/rpt/src/validate.ts:30-175,300-470`
- Modify: `tests/rpt.e2e.test.ts:230-345,547-600`

**Interfaces:**
- Consumes: uppercase MDX JSX node、parent、section depth、source、ID allocator、outline/source insertion callbacks。
- Produces: `validateComponent(node, context): ValidationIssue | undefined`。
- `ValidatedReport.source`はSection anchorとTabs内部propsをoffset降順で挿入したsourceになる。

- [ ] **Step 1: component契約の拒否E2Eを追加する**

tableには最低限次を含める。

```ts
[
  ["Badge tone", '<Badge tone="other">x</Badge>', "Badge.tone must be neutral, info, success, warning, or danger"],
  ["Status block child", '<Status tone="success">\n\nparagraph\n\n</Status>', "Status must contain inline content"],
  ["Icon name", '<Icon name="custom" />', "Icon.name must be one of:"],
  ["Icon child", '<Icon name="check">x</Icon>', "Icon must not have children"],
  ["Timeline child", '<Timeline><div>x</div><TimelineItem>x</TimelineItem></Timeline>', "Timeline may only contain TimelineItem children"],
  ["Timeline icons", '<Timeline theme="icons"><TimelineItem>x</TimelineItem><TimelineItem>y</TimelineItem></Timeline>', "Timeline theme icons requires every TimelineItem.icon"],
  ["one Tab", '<Tabs><Tab label="A">a</Tab></Tabs>', "Tabs must contain between 2 and 10 Tab children"],
  ["two active Tabs", '<Tabs><Tab label="A" active="true">a</Tab><Tab label="B" active="true">b</Tab></Tabs>', "Tabs may only contain one active Tab"],
  ["nested Tabs", '<Tabs><Tab label="A"><Tabs><Tab label="B">b</Tab><Tab label="C">c</Tab></Tabs></Tab><Tab label="D">d</Tab></Tabs>', "Tabs must not be nested"],
] as const;
```

- [ ] **Step 2: component rejection testを実行してREDを確認する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000 -t "component|Tabs|Timeline|Icon|Badge|Status"`

Expected: 新規componentが`component X is not allowed`または誤った診断でFAIL。

- [ ] **Step 3: 既存ruleと新規ruleをcomponent-rules.tsへ移す**

```ts
export type ComponentContext = Readonly<{
  source: string;
  parent?: TreeNode;
  sectionDepth: number;
  tabsDepth: number;
  timelineDepth: number;
  allocateId(base: string): string;
  addOutline(item: Readonly<{ depth: 2 | 3; text: string; slug: string }>): void;
  insert(offset: number, text: string): void;
}>;

export function validateComponent(
  node: TreeNode,
  context: ComponentContext,
): ValidationIssue | undefined;
```

Callout、Metric、Evidence、Sectionの現契約をそのまま移し、Badge、Status、Icon、Timeline、TimelineItem、Tabs、Tabを追加する。whitespace-only text nodeをcontainer直下の件数から除外する。inline contentはparagraphを作らないtext-level nodeだけ許可する。

- [ ] **Step 4: Tabsの内部propsを一意に挿入する**

各Tabsに連番を割り当て、各Tabのopening tagへ次を挿入する。

```text
group="rpt-tabs-1"
controlId="rpt-tab-control-1-1"
labelId="rpt-tab-label-1-1"
panelId="rpt-tab-panel-1-1"
checked="true|false"
```

すべて`allocateId`を経由する。利用者が`group`、`controlId`、`labelId`、`panelId`、`checked`を指定した場合はreserved attributeとして拒否する。既存`anchorInsertions`を汎用`sourceInsertions: {offset,text}[]`へ変更する。

- [ ] **Step 5: 拒否E2Eと既存回帰をGREENにする**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Expected: 新規拒否caseと全既存caseがpass。

- [ ] **Step 6: 型検査とdiffを確認する**

Run: `bun run --cwd dot_local/lib/rpt check`

Run: `git diff --check`

Expected: errorsなし。

- [ ] **Step 7: Task 3をコミットする**

```bash
git add dot_local/lib/rpt/src/component-rules.ts dot_local/lib/rpt/src/validate.ts tests/rpt.e2e.test.ts
git commit -m "feat(rpt): リッチコンポーネントの入力契約を追加" -m "Co-Authored-By: Codex GPT-5 <noreply@openai.com>"
```

---

### Task 4: Static component rendering and CSS-only Tabs

**Files:**
- Create: `dot_local/lib/rpt/template/src/components/Badge.astro`
- Create: `dot_local/lib/rpt/template/src/components/Status.astro`
- Create: `dot_local/lib/rpt/template/src/components/Icon.astro`
- Create: `dot_local/lib/rpt/template/src/components/Timeline.astro`
- Create: `dot_local/lib/rpt/template/src/components/TimelineItem.astro`
- Create: `dot_local/lib/rpt/template/src/components/Tabs.astro`
- Create: `dot_local/lib/rpt/template/src/components/Tab.astro`
- Modify: `dot_local/lib/rpt/template/src/pages/index.astro:1-18`
- Modify: `dot_local/lib/rpt/template/src/styles/report.scss:74-140`
- Modify: `tests/rpt.e2e.test.ts:577-640,1075-1135`

**Interfaces:**
- MDX component mapへ`Badge`、`Status`、`Icon`、`Timeline`、`TimelineItem`、`Tabs`、`Tab`を追加する。
- Tabs/TabはTask 3で挿入した内部propsを消費し、scriptなしのradio/label/panelを出力する。

- [ ] **Step 1: 全component生成の失敗E2Eを書く**

```mdx
<Badge tone="success">承認済み</Badge>
<Status tone="warning">確認待ち</Status>
<Icon name="circle-check" label="完了" size="20" />
<Icon name="info" />
<Timeline theme="icons">
  <TimelineItem title="調査" icon="search">要件を確認します。</TimelineItem>
  <TimelineItem title="実装" icon="check">機能を追加します。</TimelineItem>
</Timeline>
<Tabs>
  <Tab label="概要" active="true">概要本文</Tab>
  <Tab label="詳細">詳細本文</Tab>
</Tabs>
```

終了コード`0`、各`data-rpt-component`、IconのARIA、Timelineの`ul`、radio group、label `for`、panel `aria-labelledby`、script不在をparse5でassertする。

- [ ] **Step 2: E2Eを実行してAstro component未登録でREDを確認する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000 -t "rich components"`

Expected: FAIL with Astro build errorまたはcomponent出力不在。

- [ ] **Step 3: WebcoreUI wrapperとStatusを実装する**

- Badge: WebcoreUI Badgeへ`neutral -> secondary`、`danger -> alert`をmapする。
- Icon: WebcoreUI Iconへ`type={name}`と数値化した`size`を渡し、wrapperへ`aria-hidden`または`role="img" aria-label`を付ける。
- Timeline/TimelineItem: WebcoreUIの静的Astro componentを直接wrapし、`default`ではthemeを渡さない。
- Status: `span[data-rpt-component="status"][data-tone]`内へ`aria-hidden`のdotとslotを置く。

- [ ] **Step 4: scriptなしTabsを実装する**

`Tabs.astro`は`div.rpt-tabs`とslotだけを出力する。`Tab.astro`は次の兄弟順を維持する。

```astro
<input class="rpt-tab-control" type="radio" name={group} id={controlId} checked={checked === "true"} aria-controls={panelId} />
<label class="rpt-tab-label" id={labelId} for={controlId}>{label}</label>
<section class="rpt-tab-panel" id={panelId} aria-labelledby={labelId}><slot /></section>
```

CSSは`.rpt-tabs { display:flex; flex-wrap:wrap }`、labelを`order:1`、panelを`order:2; width:100%`とし、未選択panelを隠す。focus-visible、checked label、tone、Timeline spacingを追加する。printではcontrol/labelを隠し、全panelを`display:block`に戻し、`::before`でlabel相当の見出しを出せるようTabへ安全な`data-label`を生成する。

- [ ] **Step 5: component mapを更新してE2EをGREENにする**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000 -t "rich components|responsive print"`

Expected: pass、生成HTMLにWebcoreUI Tabs由来のscriptが存在しない。

- [ ] **Step 6: 全E2EとAstro checkを実行する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Run: `bun run --cwd dot_local/lib/rpt check`

Expected: all pass、0 diagnostics。

- [ ] **Step 7: Task 4をコミットする**

```bash
git add dot_local/lib/rpt/template/src/components dot_local/lib/rpt/template/src/pages/index.astro dot_local/lib/rpt/template/src/styles/report.scss tests/rpt.e2e.test.ts
git commit -m "feat(rpt): 状態と時系列とCSSタブを静的表示" -m "Co-Authored-By: Codex GPT-5 <noreply@openai.com>"
```

---

### Task 5: Mermaid input validation

**Files:**
- Create: `dot_local/lib/rpt/src/mermaid.ts`
- Modify: `dot_local/lib/rpt/src/validate.ts:45-180`
- Modify: `tests/rpt.e2e.test.ts:315-575`

**Interfaces:**
- Consumes: remark code nodeの`lang`と`value`、Mermaid validation state。
- Produces: `validateMermaidNode(node, state): ValidationIssue | undefined`、`ValidatedReport.hasMermaid`。

- [ ] **Step 1: Mermaid上限と設定拒否E2Eを書く**

```ts
const rejectedMermaid = [
  ["oversized diagram", "x".repeat(64 * 1024 + 1), "Mermaid diagram exceeds the 64 KiB limit"],
  ["frontmatter", "---\ntheme: dark\n---\nflowchart LR\nA-->B", "Mermaid frontmatter is not allowed"],
  ["init directive", '%%{init: {"theme":"dark"}}%%\nflowchart LR\nA-->B', "Mermaid init directives are not allowed"],
] as const;
```

別testで21個の`mermaid` fenceを生成し、`Mermaid diagrams exceed the 20 diagram limit`をassertする。`Mermaid`のようにcaseが異なるlangは通常codeとして成功することも固定する。

- [ ] **Step 2: Mermaid validation E2Eを実行してREDを確認する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000 -t "Mermaid"`

Expected: 上限・directive caseが成功してしまいFAIL。

- [ ] **Step 3: mermaid.tsを実装してAST走査へ接続する**

```ts
export type MermaidValidationState = { count: number; hasMermaid: boolean };

export function validateMermaidNode(
  node: TreeNode,
  state: MermaidValidationState,
): ValidationIssue | undefined;
```

`node.type === "code" && node.lang === "mermaid"`だけを対象にする。`Buffer.byteLength(node.value ?? "", "utf8")`で64KiB、countで20図を検査する。source先頭のYAML delimiterと、大文字小文字・空白差を含む`%%{init:` directiveを拒否する。成功時だけ`hasMermaid = true`にする。

- [ ] **Step 4: ValidatedReportとbuild metadataへhasMermaidを通す**

`ValidatedReport`へ`hasMermaid: boolean`を追加し、`build.ts`が`report-data.json`へ書く。template側は次Taskまで未使用でよい。

- [ ] **Step 5: Mermaid validationと全回帰をGREENにする**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Run: `bun run --cwd dot_local/lib/rpt check`

Expected: all pass。

- [ ] **Step 6: Task 5をコミットする**

```bash
git add dot_local/lib/rpt/src/mermaid.ts dot_local/lib/rpt/src/validate.ts dot_local/lib/rpt/src/build.ts tests/rpt.e2e.test.ts
git commit -m "feat(rpt): Mermaid入力のサイズと設定を制限" -m "Co-Authored-By: Codex GPT-5 <noreply@openai.com>"
```

---

### Task 6: Conditional Mermaid CDN, CSP, and final DOM policy

**Files:**
- Create: `dot_local/lib/rpt/src/final-dom-policy.ts`
- Create: `dot_local/lib/rpt/template/src/rehype-mermaid.mjs`
- Create: `dot_local/lib/rpt/template/src/components/MermaidScripts.astro`
- Modify: `dot_local/lib/rpt/src/build.ts:17-100`
- Modify: `dot_local/lib/rpt/src/cli.ts:35-75`
- Modify: `dot_local/lib/rpt/src/inline-assets.ts:15-95,531-680`
- Modify: `dot_local/lib/rpt/template/astro.config.mjs:1-30`
- Modify: `dot_local/lib/rpt/template/src/layouts/ReportLayout.astro:1-75`
- Modify: `dot_local/lib/rpt/template/src/styles/report.scss:74-140`
- Modify: `tests/rpt.e2e.test.ts:577-700,917-1035`

**Interfaces:**
- Produces: CSPと許可scriptを完全に保持する`FinalDomPolicy`。
- `BuiltReport`へ`finalDomPolicy: FinalDomPolicy`を追加する。
- `inlineAssets(html, distDirectory, policy)`がpolicyに基づいてscript/CSPを検査する。

- [ ] **Step 1: Mermaidなしとありの出力契約E2Eを書く**

Mermaidなしではscript 0件、CSP meta 1件、外部asset 0件をassertする。Mermaidありでは次をassertする。

```ts
expect(scripts).toHaveLength(2);
expect(attributeValue(scripts[0], "src")).toBe(
  "https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js",
);
expect(attributeValue(scripts[0], "nonce")).toBeTruthy();
expect(attributeValue(scripts[1], "nonce")).toBe(attributeValue(scripts[0], "nonce"));
expect(html).toContain('data-rpt-mermaid');
expect(html).toContain('securityLevel: "strict"');
expect(html).toContain("flowchart LR");
```

CSPにnonce、`connect-src 'none'`、`object-src 'none'`、`base-uri 'none'`があることも確認する。

- [ ] **Step 2: final DOM policyの敵対的focused testを書く**

`runInlineFixture`へpolicy引数を追加し、次を拒否する。

- static policy内の任意script
- mermaid policy内の異なるCDN URL
- nonce不一致
- 3本目のscript
- 固定初期化内容から1文字変えたscript
- 欠落または複数のCSP meta
- 存在しない`aria-labelledby`、`aria-describedby`、`aria-details`

- [ ] **Step 3: 新規E2Eを実行してscript拒否またはmarker不在でREDを確認する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000 -t "Mermaid|CSP|ARIA IDREF"`

Expected: Mermaid出力不在、または`report HTML contains a script`でFAIL。

- [ ] **Step 4: rehype marker変換を実装する**

`rehype-mermaid.mjs`は`pre > code.language-mermaid`を見つけ、`pre`へ`data-rpt-mermaid`を付け、code textを維持する。外部plugin依存は追加せず、HASTを再帰走査する。`astro.config.mjs`で`mdx({ rehypePlugins: [rehypeMermaid] })`へ登録する。

- [ ] **Step 5: nonceとpolicyをbuild境界へ追加する**

```ts
export type FinalDomPolicy =
  | Readonly<{ kind: "static"; csp: string }>
  | Readonly<{
      kind: "mermaid";
      nonce: string;
      csp: string;
      cdnUrl: "https://cdn.jsdelivr.net/npm/mermaid@11.16.0/dist/mermaid.min.js";
      initScript: string;
    }>;
```

`createFinalDomPolicy(hasMermaid)`はstatic CSP、Mermaid CDN URL、固定初期化sourceを一か所で構築する。`buildReport`は`report.hasMermaid`時だけ`randomBytes(18).toString("base64url")`でnonceを作る。`report-data.json`へpolicyを渡し、同じ値を`BuiltReport.finalDomPolicy`で返す。`cli.ts`はそのpolicyを`inlineAssets`へ渡す。

static CSPは次へ固定する。

```text
default-src 'none'; img-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

Mermaid CSPは同じdirectivesへ次を追加する。

```text
script-src 'nonce-${nonce}'
```

`initScript`は次の処理を固定sourceとして生成し、入力値を補間しない。

```js
(() => {
  const showError = (element) => {
    const error = document.createElement("p");
    error.setAttribute("role", "alert");
    error.textContent = "Mermaid diagram could not be rendered.";
    element.after(error);
  };
  const elements = document.querySelectorAll("[data-rpt-mermaid]");
  const nonce = document.currentScript?.nonce ?? "";
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) {
    elements.forEach(showError);
    return;
  }
  const mermaid = window.mermaid;
  if (mermaid === undefined) {
    elements.forEach(showError);
    return;
  }
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  const renderIdPrefix = "rpt-mermaid-" + nonce + "-";
  elements.forEach(async (element, index) => {
    const source = element.textContent ?? "";
    try {
      const { svg } = await mermaid.render(renderIdPrefix + index, source);
      element.innerHTML = svg;
    } catch {
      showError(element);
    }
  });
})();
```

- [ ] **Step 6: CSPとMermaid scriptsをtemplateへ追加する**

`ReportLayout.astro`は`policy.csp`を使って全ページにCSP metaを1件出す。Mermaid時だけ`MermaidScripts.astro`をbody末尾へ置く。componentはpolicy内の固定CDN URL、nonce、固定init sourceだけを生成する。init scriptはCDN取得失敗も検出し、各`[data-rpt-mermaid]`のtextContentを読み、`mermaid.render`成功後だけSVGへ置換し、失敗時は元codeを残して`role="alert"`を追加する。

- [ ] **Step 7: final DOM validatorをpolicy-awareにする**

policyを`processChildren`と`processElement`にも渡し、asset inline処理のscript branchで許可済み2件だけを通す。その後のfinal DOM検査でもscriptを収集し、policyごとの本数、順序、src、nonce、固定textを完全一致で検査する。scriptを汎用active element setから単純に除外してはならない。CSP metaを完全一致で検査する。ARIA IDREFは空白区切りの各IDが`idCounts === 1`であることを検査する。

- [ ] **Step 8: Mermaid/CSP E2Eと全回帰をGREENにする**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Run: `bun run --cwd dot_local/lib/rpt check`

Expected: all pass、0 diagnostics。

- [ ] **Step 9: Task 6をコミットする**

```bash
git add dot_local/lib/rpt/src/final-dom-policy.ts dot_local/lib/rpt/src/build.ts dot_local/lib/rpt/src/cli.ts dot_local/lib/rpt/src/inline-assets.ts dot_local/lib/rpt/template/astro.config.mjs dot_local/lib/rpt/template/src/rehype-mermaid.mjs dot_local/lib/rpt/template/src/components/MermaidScripts.astro dot_local/lib/rpt/template/src/layouts/ReportLayout.astro dot_local/lib/rpt/template/src/styles/report.scss tests/rpt.e2e.test.ts
git commit -m "feat(rpt): Mermaidだけ固定CDNで安全に描画" -m "Co-Authored-By: Codex GPT-5 <noreply@openai.com>"
```

---

### Task 7: AI authoring help and contract synchronization

**Files:**
- Modify: `dot_local/lib/rpt/src/args.ts:14-65`
- Modify: `tests/rpt.e2e.test.ts:192-225`
- Modify: `docs/superpowers/specs/2026-08-09-rpt-html-report-cli-design.md:5-145,245-275`

**Interfaces:**
- 引数なしと`--help`が同じ更新済みauthoring contractをstdoutへ返す。

- [ ] **Step 1: helpの失敗E2Eを書く**

既存`no arguments displays the detailed AI authoring guide`へ次を追加する。

```ts
expect(result.stdout).toContain("Safe HTML:");
expect(result.stdout).toContain("Badge, Status, Icon, Timeline, TimelineItem, Tabs, Tab");
expect(result.stdout).toContain("```mermaid");
expect(result.stdout).toContain("Mermaid uses a pinned CDN and client-side JavaScript");
expect(result.stdout).toContain("class and event attributes are not allowed");
```

- [ ] **Step 2: focused help testを実行してREDを確認する**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000 -t "detailed AI authoring guide"`

Expected: 新規section不在でFAIL。

- [ ] **Step 3: usageを自己完結した契約へ更新する**

frontmatter、Markdown、safe HTMLカテゴリ、safe style制約、全componentの最小例、Mermaid fence、CDN例外、入力・画像上限、output規則を掲載する。完全なIcon name一覧とCSS property一覧は長すぎるため、helpには`See the validation error for the fixed catalog`ではなく、利用頻度の高い例と「fixed WebcoreUI icon catalog」を記載する。

- [ ] **Step 4: 基本設計との矛盾を解消する**

元specの「初期版に含めないMermaid」「raw HTML禁止」「外部script禁止」を、リッチコンテンツspecへの参照と条件付きMermaid例外へ更新する。既存の安全原則と上限は削除しない。

- [ ] **Step 5: help、全E2E、型検査をGREENにする**

Run: `bun test tests/rpt.e2e.test.ts --timeout 120000`

Run: `bun test tests/rpt-safe-style.test.ts`

Run: `bun run --cwd dot_local/lib/rpt check`

Run: `git diff --check`

Expected: all pass、0 diagnostics、whitespace errorなし。

- [ ] **Step 6: Task 7をコミットする**

```bash
git add dot_local/lib/rpt/src/args.ts tests/rpt.e2e.test.ts docs/superpowers/specs/2026-08-09-rpt-html-report-cli-design.md
git commit -m "docs(rpt): AI向けリッチコンテンツ契約を案内" -m "Co-Authored-By: Codex GPT-5 <noreply@openai.com>"
```

---

### Task 8: Full verification, chezmoi deployment, and draft PR update

**Files:**
- Verify: all files changed by Tasks 1-7
- Deploy: `~/.local/bin/rpt`, `~/.local/lib/rpt/`
- Update: existing draft PR #139

**Interfaces:**
- Deployed `rpt`がsource worktreeと同じhelp、validation、HTML生成を提供する。

- [ ] **Step 1: fresh full verificationを実行する**

Run: `bun test tests/rpt.e2e.test.ts tests/rpt-safe-style.test.ts --timeout 120000`

Expected: 0 fail。

Run: `bun run --cwd dot_local/lib/rpt check`

Expected: TypeScript/Astroとも0 errors、0 warnings、0 hints。

Run: `git diff --check`

Expected: outputなし、exit 0。

- [ ] **Step 2: source差分とcommit範囲を監査する**

Run: `git status --short --branch`

Run: `git diff origin/main...HEAD --stat`

Run: `git log --oneline origin/main..HEAD`

Expected: `.Codex/`以外に意図しないuntracked fileがなく、各Taskが独立commitになっている。

- [ ] **Step 3: chezmoi差分を対象限定で確認する**

Run: `chezmoi diff -S "/Users/kosui/.local/share/chezmoi/.wt/codex/feat-rpt-ai-native-help" "/Users/kosui/.local/bin/rpt" "/Users/kosui/.local/lib/rpt"`

Expected: Tasks 1-7のrpt変更だけを表示する。

- [ ] **Step 4: chezmoiで実環境へ適用する**

Run: `chezmoi apply -S "/Users/kosui/.local/share/chezmoi/.wt/codex/feat-rpt-ai-native-help" "/Users/kosui/.local/bin/rpt" "/Users/kosui/.local/lib/rpt"`

Expected: exit 0。

- [ ] **Step 5: deployed CLIをsmoke testする**

Run: `/Users/kosui/.local/bin/rpt`

Expected: exit 0、更新済みAI authoring contractをstdoutへ表示、stderrなし。

- [ ] **Step 6: branchをpushする**

Run: `git push origin codex/feat-rpt-ai-native-help`

Expected: remote branchがlocal HEADへ更新される。

- [ ] **Step 7: draft PR本文を全変更へ更新する**

`gh pr edit 139 --title "feat(rpt): AI向けリッチコンテンツ契約を追加" --body-file /private/tmp/rpt-rich-content-pr-body.md`を使う。本文は「背景／内容／論点／Test Plan」とし、MermaidだけCDN・client JavaScriptを許可するトレードオフを論点に記載する。

- [ ] **Step 8: PR状態を確認する**

Run: `gh pr view 139 --json url,isDraft,title,headRefName,baseRefName,commits`

Expected: draft、head=`codex/feat-rpt-ai-native-help`、base=`main`、Tasks 1-7のcommitを含む。
