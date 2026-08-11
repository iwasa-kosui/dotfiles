# コーディングエージェント設定最適化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex、Claude Code、Cursor の共通ポリシーと Draft ship を一貫させ、未配備・他 runtime の参照を契約テストで防止する。

**Architecture:** `agent_policy/` に人間向けポリシーと機械可読 manifest を置き、各 runtime の既存設定を adapter として維持する。Bun test は manifest と実ファイルを照合し、共有ポリシーの欠落と cross-runtime 参照を検出する。hook のプロトコルは runtime 固有のままにする。

**Tech Stack:** Chezmoi、Markdown、JSON、TypeScript、Bun test、GitHub CLI。

## Global Constraints

- 既存の worktree `/Users/kosui/.local/share/chezmoi/.wt/docs/plan-agent-config-optimization` だけを変更する。
- 秘密情報ファイルや値を read、copy、test fixture に含めない。
- 実装・設定変更後は、検証済みなら scope 付き Conventional Commit、push、Draft PR を自動実行する。
- Ready 化、merge、force push、保護ブランチへの直接変更は実行しない。
- Codex の hook matcher は未確認の仕様を推測して追加せず、既存登録との整合だけを検証する。
- 設定の振る舞いを変更する各タスクは、Bun test の RED → GREEN を記録する。

---

### Task 1: 共通ポリシー台帳と契約テスト

**Files:**
- Create: `agent_policy/contract.md`
- Create: `agent_policy/runtime-manifest.json`
- Create: `tests/agent-config-contract.test.ts`

**Interfaces:**
- Produces: `runtime-manifest.json` with a `runtimes` object containing `codex`, `claude`, and `cursor`, each with `home`, `rules`, `skills`, and `hooks` fields.
- Produces: `bun test tests/agent-config-contract.test.ts`, which reads only repository-managed configuration files.

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, test } from "bun:test";

const manifest = await Bun.file("agent_policy/runtime-manifest.json").json();

describe("agent runtime contract", () => {
  test("defines all supported runtimes and Draft ship policy", async () => {
    expect(Object.keys(manifest.runtimes).sort()).toEqual(["claude", "codex", "cursor"]);
    const policy = await Bun.file("agent_policy/contract.md").text();
    expect(policy).toContain("Draft PR");
    expect(policy).toContain("Ready 化");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `bun test tests/agent-config-contract.test.ts`

Expected: FAIL because `agent_policy/runtime-manifest.json` does not exist.

- [ ] **Step 3: Add the manifest and human-readable policy**

```json
{
  "runtimes": {
    "codex": { "home": "~/.codex", "rules": "dot_codex/rules", "skills": "dot_codex/skills", "hooks": "dot_codex/hooks.json" },
    "claude": { "home": "~/.claude", "rules": "dot_claude/rules", "skills": "dot_claude/skills", "hooks": "dot_claude/modify_settings.json.tmpl" },
    "cursor": { "home": "~/.cursor", "rules": "dot_cursor/rules", "skills": "dot_cursor/skills", "hooks": "dot_cursor/hooks.json" }
  }
}
```

`contract.md` must define Draft ship, no-ship task types, and the explicit-approval boundary for Ready/merge/force-push/protected branches.

- [ ] **Step 4: Extend the test with adapter assertions and verify GREEN**

Add assertions that the currently materialized Claude and Cursor manifest paths exist and that `dot_cursor/rules/auto-ship.mdc` contains the same Draft/Ready boundary as `contract.md`. Codex rules are intentionally excluded here because Task 2 creates and validates `dot_codex/rules/`.

Run: `bun test tests/agent-config-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent_policy/contract.md agent_policy/runtime-manifest.json tests/agent-config-contract.test.ts
git commit -m "feat(agents): add runtime policy contract"
```

### Task 2: Codex instructions and managed rules

**Files:**
- Modify: `AGENTS.md`
- Modify: `dot_codex/AGENTS.md`
- Create: `dot_codex/rules/communication-style.md`
- Create: `dot_codex/rules/shell-command-style.md`
- Create: `dot_codex/rules/subagent-tool-usage.md`
- Create: `dot_codex/rules/secret-file-access.md`
- Create: `dot_codex/rules/commit-message.md`
- Create: `dot_codex/rules/worktree-workflow.md`
- Modify: `tests/agent-config-contract.test.ts`

**Interfaces:**
- Consumes: the Codex runtime entry from `agent_policy/runtime-manifest.json`.
- Produces: a Codex instruction index referring only to `~/.codex` files and generic Codex capabilities.

- [ ] **Step 1: Add a failing Codex adapter test**

```ts
test("Codex instructions have managed rules and no Claude-only execution API", async () => {
  const instructions = await Bun.file("dot_codex/AGENTS.md").text();
  expect(instructions).not.toContain("CLAUDE_CODE_SUBAGENT_MODEL");
  expect(instructions).not.toContain("@RTK.md");
  expect(instructions).toContain("~/.codex/rules/");
  for (const rule of manifest.runtimes.codex.requiredRules) {
    expect(await Bun.file(`dot_codex/rules/${rule}`).exists()).toBe(true);
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test tests/agent-config-contract.test.ts`

Expected: FAIL because the Codex rules directory and required rule list do not exist.

- [ ] **Step 3: Implement the Codex adapter**

Add `requiredRules` to the Codex manifest entry. Port the listed common rules from `dot_claude/rules/`, changing only runtime-specific path and tool references. Rewrite `dot_codex/AGENTS.md` to list those actual files, use `~/.codex` consistently, describe Codex subagents without Claude model/environment names, and retain the Draft ship policy. Correct `AGENTS.md` so its Codex path is `dot_codex/` and its Neovim integration is `claudecode.lua`.

- [ ] **Step 4: Run focused and existing safety tests**

Run: `bun test tests/agent-config-contract.test.ts tests/branch-guard-lib.test.ts`

Expected: PASS with no missing Codex rule or Claude-only execution reference.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md dot_codex/AGENTS.md dot_codex/rules tests/agent-config-contract.test.ts agent_policy/runtime-manifest.json
git commit -m "fix(codex): manage runtime rules locally"
```

### Task 3: Skills and hook ownership normalisation

**Files:**
- Modify: `dot_codex/skills/pr/SKILL.md`
- Modify: `dot_codex/skills/pr-autofix/SKILL.md`
- Modify: `dot_cursor/skills/pr/SKILL.md`
- Modify: `dot_cursor/skills/pr-autofix/SKILL.md`
- Modify: `dot_codex/hooks/executable_plan-export.ts`
- Modify: `dot_codex/hooks/executable_worktree.ts`
- Delete: `dot_codex/hooks/executable_rtk-rewrite.sh`
- Modify: `agent_policy/runtime-manifest.json`
- Modify: `tests/agent-config-contract.test.ts`

**Interfaces:**
- Consumes: each runtime’s `home`, `skills`, and `hooks` values from the manifest.
- Produces: skill dependencies that are conditional when not deployed, and hook files whose state paths match their runtime ownership.

- [ ] **Step 1: Add failing cross-runtime reference tests**

```ts
test("Codex and Cursor adapters do not hard-code Claude runtime state", async () => {
  const files = [
    "dot_codex/skills/pr/SKILL.md",
    "dot_codex/skills/pr-autofix/SKILL.md",
    "dot_cursor/skills/pr/SKILL.md",
    "dot_cursor/skills/pr-autofix/SKILL.md",
    "dot_codex/hooks/executable_plan-export.ts",
    "dot_codex/hooks/executable_worktree.ts"
  ];
  for (const path of files) {
    expect(await Bun.file(path).text()).not.toContain("~/.claude");
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test tests/agent-config-contract.test.ts`

Expected: FAIL with the current `~/.claude` references.

- [ ] **Step 3: Normalize ownership and optional dependencies**

Replace each hard-coded runtime home with the adapter’s own home. Replace fixed `Codex <noreply@openai.com>` attribution with the actual executing agent convention described in the common policy. Turn non-deployed review and SonarCloud skills into existence-checked optional dependencies. Remove the unregistered Claude-only RTK rewrite hook, and add each retained hook’s role to the manifest.

- [ ] **Step 4: Verify the contract and relevant skill suites**

Run: `bun test tests/agent-config-contract.test.ts tests/rpt-skill.test.ts`

Expected: PASS with no forbidden cross-runtime home in the checked adapters.

- [ ] **Step 5: Commit**

```bash
git add dot_codex/skills dot_cursor/skills dot_codex/hooks agent_policy/runtime-manifest.json tests/agent-config-contract.test.ts
git commit -m "fix(agents): isolate runtime skill ownership"
```

### Task 4: Cursor and Claude policy parity

**Files:**
- Modify: `dot_cursor/rules/auto-ship.mdc`
- Modify: `dot_cursor/rules/communication-style.mdc`
- Modify: `dot_cursor/rules/secret-file-access.mdc`
- Modify: `dot_claude/rules/secret-file-access.md`
- Modify: `tests/agent-config-contract.test.ts`

**Interfaces:**
- Consumes: common safety and ship boundaries in `agent_policy/contract.md`.
- Produces: Cursor and Claude documents that expose the same Draft ship and secret-file scope to agents before hooks enforce it.

- [ ] **Step 1: Add failing parity tests**

```ts
test("all runtime policy adapters preserve Draft ship and explicit escalation", async () => {
  for (const path of [
    "dot_codex/AGENTS.md",
    "dot_cursor/rules/auto-ship.mdc",
    "dot_claude/CLAUDE.md"
  ]) {
    const text = await Bun.file(path).text();
    expect(text).toContain("Draft");
    expect(text).toMatch(/Ready|merge|force push/);
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test tests/agent-config-contract.test.ts`

Expected: FAIL because Claude’s index does not expose the shared ship boundary and the documents do not yet use the same terms.

- [ ] **Step 3: Implement parity without erasing runtime-specific syntax**

Update Cursor’s auto-ship rule to state the shared boundaries precisely. Restore the intentionally shared communication and secret-file exclusions that are missing from Cursor’s adapters. Update Claude’s index to reference the common ship boundary, and synchronize the prose secret-file list with the hook-protected list without naming secret values.

- [ ] **Step 4: Run focused policy, hook, and skill tests**

Run: `bun test tests/agent-config-contract.test.ts tests/branch-guard-lib.test.ts tests/rpt-skill.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dot_cursor/rules dot_claude/CLAUDE.md dot_claude/rules/secret-file-access.md tests/agent-config-contract.test.ts
git commit -m "fix(agents): align Draft ship safety boundaries"
```

### Task 5: Deployment verification and Draft PR

**Files:**
- Verify: `agent_policy/`
- Verify: `dot_codex/`
- Verify: `dot_claude/`
- Verify: `dot_cursor/`
- Verify: `tests/agent-config-contract.test.ts`

**Interfaces:**
- Consumes: all earlier commits.
- Produces: a pushed branch and a Draft PR; no Ready PR or merge action.

- [ ] **Step 1: Run the complete relevant test suite**

Run: `bun test tests/agent-config-contract.test.ts tests/branch-guard-lib.test.ts tests/rpt-skill.test.ts`

Expected: PASS with zero failures.

- [ ] **Step 2: Review generated deployment differences**

Run: `chezmoi diff --source /Users/kosui/.local/share/chezmoi/.wt/docs/plan-agent-config-optimization`

Expected: only the policy, runtime rule, skill, and hook files named in Tasks 1–4 change.

- [ ] **Step 3: Inspect staged history and publish**

Run:

```bash
git status --short
git log --oneline main..HEAD
git push -u origin docs/plan-agent-config-optimization
gh pr create --draft --title "fix(agents): align coding agent policies" --body-file /tmp/agent-runtime-pr.md
```

Expected: branch push succeeds and the PR is Draft.
