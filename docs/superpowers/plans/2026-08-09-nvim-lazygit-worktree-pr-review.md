# Neovim LazyGit・worktree・PRレビュー導線 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Neovim起動時の右DockをWorktrees中心のLazyGitにし、選択branchまたはPR一覧から`<leader>p`だけでOctoレビューへ入り、終了時にLazyGitへ戻れるようにする。

**Architecture:** chezmoi管理のLazyGit YAMLはpanel順と選択branchを渡すcustom commandだけを担当し、Bun製bridgeが`$NVIM`のNeovimへ安全なbase64 JSONを送る。Neovim側は`user.lazygit_dock`、`user.dock`、`user.pr_review`へ、terminal生成、fallback状態、GitHub/Octo操作を分離する。既存のOcto既定キーマップとPR #133以前のキーマップを維持し、未使用のSnacks Picker用`<leader>p`だけを削除する。

**Tech Stack:** Neovim Lua、LazyVim、Snacks.nvim、LazyGit 0.64.0、Octo.nvim、GitHub CLI、Bun/TypeScript、chezmoi、StyLua

## Global Constraints

- 作業は`/Users/kosui/.local/share/chezmoi/.wt/fix/nvim-leader-find-files`だけで行い、main worktreeを変更しない。
- PR #133で削除・変更された従来キーマップは、`<leader>p`のSnacks Pickerを除いて復元状態を維持する。
- activeな`<leader>p`単体にはactionを登録せず、WhichKeyのPRグループとして予約する。PR #133で復元済みだが読み込まれていない`user/vscode_keymaps.lua`のclipboard定義は維持する。
- Octoの`mappings_disable_default`は設定せず、既定キーマップを残したまま`<leader>p...`をaliasとして追加する。
- LazyGitの`Space`、`n`、`o`、`d`、`G`、`P`を上書きしない。
- 他者のPRや選択branchを自動checkoutせず、worktreeも自動作成しない。
- headless、Git repository外、`lazygit`未導入環境ではLazyGitを自動表示しない。
- Neovim起動時はExplorerとLazyGitを表示するが、focusはEditorに残す。
- Claude Code、Codex、PR/Reviewを閉じたらLazyGitを復元する。LazyGit自体を明示的に閉じた場合は再表示しない。
- LazyGit custom commandのplaceholderは必ず`quote` filterを通し、bridge以降はshellを使わずargvとbase64 JSONで渡す。
- LazyGit設定とbridgeはchezmoi sourceを変更し、最後に`chezmoi apply`で配備する。
- `.Codex/settings.local.json`はworktree専用の未追跡ファイルとして残し、stageしない。

---

## File Structure

### Create

- `Library/Application Support/lazygit/config.yml` — Worktrees優先panelと、選択branchをbridgeへ渡す非公開F12 custom command。
- `dot_local/lib/nvim-pr-review-bridge.ts` — CLI引数検証、payload生成、Neovim remote expression生成。
- `dot_local/bin/executable_nvim-pr-review` — `$NVIM`へremote expressionを送るchezmoi配備用CLI。
- `dot_config/nvim/lua/user/lazygit_dock.lua` — LazyGit terminalの生成・再利用・起動条件・terminal-local mapping。
- `tests/lazygit-config.test.ts` — YAMLがLazyGit 0.64.0で読め、panel順と安全なcustom commandを保つことの検証。
- `tests/nvim-pr-review-bridge.test.ts` — bridgeのarity、特殊文字保持、remote argvの検証。
- `tests/nvim/restored_keymaps_spec.lua` — PR #133以前のキーマップ復元状態とSnacks Picker例外の固定。
- `tests/nvim/lazygit_dock_spec.lua` — 自動起動条件、再利用、focus、terminal-local mappingの検証。

### Modify

- `dot_config/nvim/lua/config/keymaps.lua` — 重複する`<leader>p` Snacks Picker mappingを削除。
- `dot_config/nvim/lua/config/autocmds.lua` — VeryLazy時にExplorerとLazyGitをbackgroundでensure。
- `dot_config/nvim/lua/plugins/plugin.lua` — Snacks側の`<leader>p`を削除し、WhichKeyのPRグループを登録。
- `dot_config/nvim/lua/plugins/octo.lua` — 既存Octo keysを残し、PR一覧・対象PRのglobal aliasとreview buffer attachを追加。
- `dot_config/nvim/lua/plugins/claudecode.lua` — Claude terminalを隠したことをDock controllerへ通知。
- `dot_config/nvim/lua/user/dock.lua` — default/fallback handle、deactivate、明示closeを管理。
- `dot_config/nvim/lua/user/workspace.lua` — Git Dock実装を`user.lazygit_dock`へ委譲。
- `dot_config/nvim/lua/user/pr_review.lua` — branch指定PR、一覧、review alias、Octo surface lifecycleを管理。
- `dot_config/nvim/lua/user/ai_dock.lua` — Claude/Codexのhide・失敗・buffer終了時にLazyGitを復元。
- `tests/nvim/keymaps_spec.lua` — `<leader>p`単体が消え、既存config keyが残ることを検証。
- `tests/nvim/dock_spec.lua` — fallbackの再表示・再生成・無効化を検証。
- `tests/nvim/workspace_spec.lua` — LazyGit moduleへの委譲を検証。
- `tests/nvim/pr_review_spec.lua` — gh argv、cwd、整数検証、fallback、review aliasを検証。
- `tests/nvim/octo_spec.lua` — Octo既定mapping維持と新しいPR aliasを検証。
- `tests/nvim/ai_dock_spec.lua` — AI終了時と起動失敗時のLazyGit復帰を検証。
- `tests/nvim/claudecode_spec.lua` — Claude hide callbackのDock通知を検証。
- `docs/vim-cheatsheet.md` — 起動時LazyGit、Worktrees、`<leader>p`レビュー手順を記載。

---

### Task 1: PR #133以前のキーマップを固定し、`<leader>p`をPR専用にする

**Files:**
- Create: `tests/nvim/restored_keymaps_spec.lua`
- Modify: `tests/nvim/keymaps_spec.lua:17-29`
- Modify: `dot_config/nvim/lua/config/keymaps.lua:39-41`
- Modify: `dot_config/nvim/lua/plugins/plugin.lua:12-18`

**Interfaces:**
- Consumes: 現在のbranchにある`73a81ec`のキーマップ復元結果。
- Produces: `<leader>p`単体が空き、他の復元済みキーを回帰テストで固定した状態。

- [ ] **Step 1: 復元済みplugin keyとSnacks Picker例外を表す失敗テストを書く**

`tests/nvim/restored_keymaps_spec.lua`を作成する。

```lua
local t = require("testlib")
local root = vim.fn.getcwd() .. "/dot_config/nvim/lua/plugins/"

local function index(keys)
  local result = {}
  for _, mapping in ipairs(keys or {}) do
    result[mapping[1]] = mapping
  end
  return result
end

local snacks = dofile(root .. "plugin.lua")[1]
local snacks_keys = index(snacks.keys)
for _, lhs in ipairs({ "<leader>e", "<leader>D", "<leader>;", "<leader>b", "<leader>f", "<leader>g", "<leader>T", "gR", "gF" }) do
  t.truthy(snacks_keys[lhs], lhs .. " from before PR #133 must remain")
end
t.eq(nil, snacks_keys["<leader>p"], "unused Snacks Picker mapping must be removed")

local git = dofile(root .. "git.lua")
local git_keys = {}
for _, plugin in ipairs(git) do
  for lhs, mapping in pairs(index(plugin.keys)) do
    git_keys[lhs] = mapping
  end
end
for _, lhs in ipairs({ "<leader>gg", "<leader>gz", "<leader>gh", "<leader>gH", "<leader>gw" }) do
  t.truthy(git_keys[lhs], lhs .. " from before PR #133 must remain")
end

local claude = index(dofile(root .. "claudecode.lua")[1].keys)
for _, lhs in ipairs({ "<leader>a", "<leader>aa", "<leader>af", "<leader>ar", "<leader>aC", "<leader>ab", "<leader>as", "<leader>aA", "<leader>ad", "<C-,>" }) do
  t.truthy(claude[lhs], lhs .. " from before PR #133 must remain")
end

local minuet = dofile(root .. "minuet.lua")[1]
local minuet_keys = index(minuet.keys)
for _, lhs in ipairs({ "<leader>mp", "<leader>ma", "<leader>md" }) do
  t.truthy(minuet_keys[lhs], lhs .. " from before PR #133 must remain")
end

local multicursors = dofile(root .. "multicursors.lua")[1]
t.truthy(index(multicursors.keys)["<Leader>M"], "multicursor mapping from before PR #133 must remain")

local vscode_keymaps = vim.fn.getcwd() .. "/dot_config/nvim/lua/user/vscode_keymaps.lua"
t.eq(1, vim.fn.filereadable(vscode_keymaps), "PR #133 must not remove the legacy keymap file")
local vscode_source = table.concat(vim.fn.readfile(vscode_keymaps), "\n")
for _, snippet in ipairs({ [["<leader>y", '"+y']], [["<leader>p", '"+p']], [["<Esc>", "<Esc>:noh<CR>"]] }) do
  t.truthy(vscode_source:find(snippet, 1, true), snippet .. " must remain in vscode_keymaps.lua")
end
```

`tests/nvim/keymaps_spec.lua`の`expected`から`["<leader>p"] = "Picker"`を削除し、末尾へ次を追加する。

```lua
local removed = vim.fn.maparg("<leader>p", "n", false, true)
t.eq({}, removed, "<leader>p must be reserved for the PR group")
```

- [ ] **Step 2: keymapテストがSnacks Pickerの重複で失敗することを確認する**

Run:

```bash
NVIM_TEST_SPEC=restored_keymaps_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=keymaps_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: 最初は`unused Snacks Picker mapping must be removed`、次は`<leader>p must be reserved`でFAILする。

- [ ] **Step 3: `config/keymaps.lua`とSnacks plugin specからPicker mappingだけを削除する**

`dot_config/nvim/lua/config/keymaps.lua`から次のmappingを削除する。

```lua
vim.keymap.set("n", "<leader>p", function()
  Snacks.picker()
end, { desc = "Picker" })
```

`dot_config/nvim/lua/plugins/plugin.lua`から次のkey specを削除する。

```lua
{
  "<leader>p",
  function()
    require("snacks").picker()
  end,
  desc = "Picker",
},
```

`<leader>f`、`<leader>b`、`<leader>D`など個別Pickerと、`user/vscode_keymaps.lua`を含む他の復元済みmappingは変更しない。

- [ ] **Step 4: 復元baselineと`<leader>p`予約がPASSすることを確認する**

Run:

```bash
NVIM_TEST_SPEC=restored_keymaps_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=keymaps_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=octo_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: 3コマンドともPASSし、Octoの既存`<leader>o...` keysも残る。

- [ ] **Step 5: キーマップbaselineをコミットする**

```bash
git add dot_config/nvim/lua/config/keymaps.lua dot_config/nvim/lua/plugins/plugin.lua tests/nvim/keymaps_spec.lua tests/nvim/restored_keymaps_spec.lua
git commit -m "fix(nvim): 従来キーを保ってPR用prefixを予約"
```

---

### Task 2: Worktrees優先LazyGit設定と安全なNeovim bridgeを追加する

**Files:**
- Create: `Library/Application Support/lazygit/config.yml`
- Create: `dot_local/lib/nvim-pr-review-bridge.ts`
- Create: `dot_local/bin/executable_nvim-pr-review`
- Create: `tests/lazygit-config.test.ts`
- Create: `tests/nvim-pr-review-bridge.test.ts`

**Interfaces:**
- Consumes: LazyGit custom commandの`SelectedWorktree.Branch`、`SelectedLocalBranch.Name`、`CheckedOutBranch.Name`。
- Produces: `nvim-pr-review open <branch>` CLIと、`require('user.pr_review').receive({cwd, branch})`を`$NVIM`へ送るremote expression。

- [ ] **Step 1: bridgeのarityとpayloadを表す失敗テストを書く**

`tests/nvim-pr-review-bridge.test.ts`を作成する。

```ts
import { describe, expect, test } from "bun:test";
import {
  buildRemoteCommand,
  parseBridgeArgs,
} from "../dot_local/lib/nvim-pr-review-bridge";

describe("nvim PR review bridge", () => {
  test("accepts exactly open and one branch argument", () => {
    expect(parseBridgeArgs(["open", "feat/review"])).toEqual({ branch: "feat/review" });
    expect(parseBridgeArgs(["open"])).toBeUndefined();
    expect(parseBridgeArgs(["open", "feat/review", "extra"])).toBeUndefined();
    expect(parseBridgeArgs(["list", "feat/review"])).toBeUndefined();
  });

  test("preserves special branch characters in a base64 JSON payload", () => {
    const branch = "feat/$(touch hacked);quote'and\"double";
    const command = buildRemoteCommand("/tmp/nvim.sock", "/repo path", branch);
    expect(command.slice(0, 4)).toEqual(["nvim", "--server", "/tmp/nvim.sock", "--remote-expr"]);

    const encoded = command[4].match(/, \"([A-Za-z0-9+/=]+)\"\)$/)?.[1];
    expect(encoded).toBeDefined();
    expect(JSON.parse(Buffer.from(encoded!, "base64").toString("utf8"))).toEqual({
      cwd: "/repo path",
      branch,
    });
  });
});
```

- [ ] **Step 2: LazyGit設定のpanel順とquote filterを表す失敗テストを書く**

`tests/lazygit-config.test.ts`を作成する。

```ts
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const config = join(import.meta.dir, "..", "Library", "Application Support", "lazygit", "config.yml");

describe("lazygit config", () => {
  test("uses Worktrees as the third side panel", async () => {
    const yaml = await readFile(config, "utf8");
    expect(yaml).toContain("- [status]");
    expect(yaml).toContain("- [files, submodules]");
    expect(yaml).toContain("- [worktrees, branches, remotes, tags]");
    expect(yaml.indexOf("[worktrees")).toBeLessThan(yaml.indexOf("[commits"));
  });

  test("quotes every selected branch passed to the bridge", async () => {
    const yaml = await readFile(config, "utf8");
    expect(yaml).toContain(".SelectedWorktree.Branch | quote");
    expect(yaml).toContain(".SelectedLocalBranch.Name | quote");
    expect(yaml).toContain(".CheckedOutBranch.Name | quote");
    expect(yaml.match(/key: <f12>/g)).toHaveLength(3);
  });
});
```

- [ ] **Step 3: 新規テストがmissing moduleとmissing configで失敗することを確認する**

Run:

```bash
bun test tests/nvim-pr-review-bridge.test.ts tests/lazygit-config.test.ts
```

Expected: `nvim-pr-review-bridge`と`config.yml`が存在しないためFAILする。

- [ ] **Step 4: bridge libraryとCLIを実装する**

`dot_local/lib/nvim-pr-review-bridge.ts`へ次のinterfaceを実装する。

```ts
export type BridgeArgs = { branch: string };

export function parseBridgeArgs(args: string[]): BridgeArgs | undefined {
  if (args.length !== 2 || args[0] !== "open") return undefined;
  return { branch: args[1] };
}

export function buildRemoteCommand(server: string, cwd: string, branch: string): string[] {
  const payload = Buffer.from(JSON.stringify({ cwd, branch }), "utf8").toString("base64");
  const expression =
    `luaeval("require('user.pr_review').receive(vim.json.decode(vim.base64.decode(_A)))", "${payload}")`;
  return ["nvim", "--server", server, "--remote-expr", expression];
}
```

`dot_local/bin/executable_nvim-pr-review`を次のCLIにする。

```ts
#!/usr/bin/env bun

import { realpath } from "node:fs/promises";
import {
  buildRemoteCommand,
  parseBridgeArgs,
} from "../lib/nvim-pr-review-bridge";

const usage = "usage: nvim-pr-review open <branch>\n";
const parsed = parseBridgeArgs(process.argv.slice(2));
if (!parsed) {
  process.stderr.write(usage);
  process.exit(2);
}

const server = process.env.NVIM;
if (!server) {
  process.stderr.write("nvim-pr-review: NVIM server is not available\n");
  process.exit(1);
}

const cwd = await realpath(process.cwd()).catch(() => process.cwd());
const child = Bun.spawn(buildRemoteCommand(server, cwd, parsed.branch), {
  stdin: "ignore",
  stdout: "ignore",
  stderr: "inherit",
});
process.exitCode = await child.exited;
```

- [ ] **Step 5: LazyGit YAMLを実装する**

`Library/Application Support/lazygit/config.yml`を次の構成にする。

```yaml
gui:
  sidePanels:
    - [status]
    - [files, submodules]
    - [worktrees, branches, remotes, tags]
    - [commits, reflog]
    - [stash]

customCommands:
  - key: <f12>
    context: worktrees
    description: Open selected worktree PR in Neovim
    command: "nvim-pr-review open {{.SelectedWorktree.Branch | quote}}"
    output: none
  - key: <f12>
    context: localBranches
    description: Open selected branch PR in Neovim
    command: "nvim-pr-review open {{.SelectedLocalBranch.Name | quote}}"
    output: none
  - key: <f12>
    context: "status, files, submodules, remotes, remoteBranches, tags, commits, reflogCommits, subCommits, commitFiles, stash"
    description: Open checked out branch PR in Neovim
    command: "nvim-pr-review open {{.CheckedOutBranch.Name | quote}}"
    output: none
```

F12はユーザー向けキーにせず、Task 4のterminal-local`<leader>po`からだけ送る。標準`Space`、`G`、`P`はYAMLで変更しない。

- [ ] **Step 6: bridgeとYAMLがPASSし、LazyGit 0.64.0が設定を読めることを確認する**

Run:

```bash
bun test tests/nvim-pr-review-bridge.test.ts tests/lazygit-config.test.ts
lazygit --use-config-file "Library/Application Support/lazygit/config.yml" --config
```

Expected: BunテストがPASSし、LazyGitがexit 0でmerged configを表示する。

- [ ] **Step 7: LazyGit設定とbridgeをコミットする**

```bash
git add "Library/Application Support/lazygit/config.yml" dot_local/lib/nvim-pr-review-bridge.ts dot_local/bin/executable_nvim-pr-review tests/lazygit-config.test.ts tests/nvim-pr-review-bridge.test.ts
git commit -m "feat(lazygit): worktreeからPRを開くbridgeを追加"
```

---

### Task 3: Dock controllerへLazyGit fallbackを追加する

**Files:**
- Modify: `tests/nvim/dock_spec.lua:1-39`
- Modify: `dot_config/nvim/lua/user/dock.lua:1-33`

**Interfaces:**
- Consumes: 既存`prepare(name)`、`activate(name, handle)`と、`hide/show`を持つSnacks handle。
- Produces: `set_default(name, factory, is_live)`、`restore_default()`、`deactivate(name, handle, opts)`、`disable_default()`。

- [ ] **Step 1: fallback再表示・再生成・明示closeの失敗テストを書く**

`tests/nvim/dock_spec.lua`の既存assertionの後へ追加する。

```lua
local fallback_dock = require("user.dock").new()
local created = 0
local lazygit = { hidden = 0, shown = 0, live = true }
function lazygit:hide() self.hidden = self.hidden + 1 end
function lazygit:show() self.shown = self.shown + 1 end

fallback_dock:set_default("lazygit", function()
  created = created + 1
  return lazygit
end, function(handle)
  return handle.live
end)
fallback_dock:activate("lazygit", lazygit)

local codex = { hide = function() end }
fallback_dock:activate("codex", codex)
t.eq(1, lazygit.hidden)
fallback_dock:deactivate("codex", codex)
t.eq(1, lazygit.shown, "closing Codex must restore the live LazyGit handle")
t.eq(lazygit, fallback_dock.active.handle)

lazygit.live = false
fallback_dock:activate("codex", codex)
local replacement = { shown = 0, live = true, hide = function() end }
function replacement:show() self.shown = self.shown + 1 end
fallback_dock.default.factory = function()
  created = created + 1
  return replacement
end
fallback_dock:deactivate("codex", codex)
t.eq(replacement, fallback_dock.active.handle, "dead LazyGit must be recreated")
t.eq(1, replacement.shown)

fallback_dock:deactivate("lazygit", replacement, { explicit = true, restore = false })
fallback_dock:restore_default()
t.eq(nil, fallback_dock.active, "explicit LazyGit close must disable automatic restore")
```

- [ ] **Step 2: Dockテストがmissing methodsで失敗することを確認する**

Run:

```bash
NVIM_TEST_SPEC=dock_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: `set_default`が存在しないためFAILする。

- [ ] **Step 3: default/fallback lifecycleを実装する**

`dot_config/nvim/lua/user/dock.lua`へ次の責務を追加する。

```lua
local function show(handle)
  if handle and type(handle.show) == "function" then
    pcall(handle.show, handle)
  end
end

function Controller:set_default(name, factory, is_live)
  local previous = self.default and self.default.name == name and self.default.handle or nil
  self.default = {
    name = name,
    factory = factory,
    is_live = is_live or function(handle) return handle ~= nil end,
    handle = previous,
    enabled = true,
  }
end

function Controller:disable_default()
  if self.default then self.default.enabled = false end
end

function Controller:restore_default()
  local default = self.default
  if not default or not default.enabled then return nil end
  local handle = default.handle
  if not handle or not default.is_live(handle) then
    handle = default.factory()
    default.handle = handle
  end
  if not handle then return nil end
  show(handle)
  return self:activate(default.name, handle)
end

function Controller:deactivate(name, handle, opts)
  opts = opts or {}
  local was_active = self.active and self.active.name == name and self.active.handle == handle
  if was_active then self.active = nil end
  if self.default and self.default.name == name then
    if opts.explicit then self:disable_default() end
    return nil
  end
  if was_active and opts.restore ~= false then return self:restore_default() end
  return nil
end
```

`activate`でdefault名をactivateした場合は`default.handle = handle`と`default.enabled = true`を更新する。`M.new()`は`{ active = nil, default = nil }`を返す。既存のsame-name handle切替testを壊さない。

- [ ] **Step 4: Dock lifecycle testがPASSすることを確認する**

Run:

```bash
NVIM_TEST_SPEC=dock_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: 既存の排他表示testと新しいfallback testがすべてPASSする。

- [ ] **Step 5: Dock controllerをコミットする**

```bash
git add dot_config/nvim/lua/user/dock.lua tests/nvim/dock_spec.lua
git commit -m "feat(nvim): Dockの通常表示を復元可能にする"
```

---

### Task 4: LazyGitを起動時の右Dockへ表示する

**Files:**
- Create: `dot_config/nvim/lua/user/lazygit_dock.lua`
- Create: `tests/nvim/lazygit_dock_spec.lua`
- Modify: `dot_config/nvim/lua/user/workspace.lua:93-109`
- Modify: `tests/nvim/workspace_spec.lua:91-112`
- Modify: `dot_config/nvim/lua/config/autocmds.lua:1-6`

**Interfaces:**
- Consumes: `dock:set_default`、`dock:activate`、`Snacks.lazygit(opts)`、`user.worktree_root.resolve`。
- Produces: `lazygit_dock.ensure(opts?, adapter?)`、`lazygit_dock.open(opts?, adapter?)`、`lazygit_dock.is_terminal_live(handle, adapter?)`。

- [ ] **Step 1: 起動条件・右Dock・focus・再利用の失敗テストを書く**

`tests/nvim/lazygit_dock_spec.lua`を作成する。adapterは次のfieldを使う。

```lua
local t = require("testlib")
local dock = require("user.dock").new()
local lazygit_dock = require("user.lazygit_dock")

local created = 0
local registered = {}
local terminal = {
  buf = 51,
  live = true,
  show = function() end,
  focus = function() error("background startup must not focus LazyGit") end,
  hide = function() end,
}
local adapter = {
  root = function() return "/repo/.wt/feature" end,
  has_ui = function() return true end,
  executable = function() return true end,
  is_git_repo = function(path)
    t.eq("/repo/.wt/feature", path)
    return true
  end,
  dock = dock,
  lazygit = function(opts)
    created = created + 1
    t.eq("/repo/.wt/feature", opts.cwd)
    t.eq("right", opts.win.position)
    t.eq(0.36, opts.win.width)
    t.eq(false, opts.win.enter)
    return terminal
  end,
  terminal_live = function(value) return value.live end,
  set_keymap = function(mode, lhs, rhs, opts)
    registered[mode .. lhs] = { rhs = rhs, opts = opts }
  end,
  register_cleanup = function(_, callback) terminal.cleanup = callback end,
  ensure_explorer = function() end,
}

local first = lazygit_dock.ensure({ focus = false }, adapter)
local second = lazygit_dock.ensure({ focus = false }, adapter)
t.eq(terminal, first)
t.eq(terminal, second)
t.eq(1, created, "startup ensure must run once per canonical root")
t.truthy(registered["t<leader>pp"])
t.eq("<F12>", registered["t<leader>po"].rhs)
t.eq("q", registered["tq"].rhs(), "q must be forwarded after marking an explicit close")
t.eq("<C-c>", registered["t<C-c>"].rhs(), "Ctrl-c must keep LazyGit's alternate quit")
t.eq(true, registered["tq"].opts.expr)
t.eq(terminal, dock.active.handle)

lazygit_dock.reset_for_tests()
adapter.has_ui = function() return false end
t.eq(nil, lazygit_dock.ensure({ focus = false }, adapter))
t.eq(1, created, "headless ensure must not create another terminal")
```

同じspecで`executable=false`と`is_git_repo=false`も作成数が増えないこと、`terminal.live=false`の後に`open`すると新handleを生成することをassertする。

- [ ] **Step 2: workspace委譲の失敗テストへ変更する**

`tests/nvim/workspace_spec.lua`の既存`git_dock` blockを、module adapterを注入する形へ変更する。

```lua
local delegated
local result = workspace.git_dock({ focus = true }, {
  lazygit_dock = {
    open = function(opts)
      delegated = opts
      return git_terminal
    end,
  },
})
t.eq({ focus = true }, delegated)
t.eq(git_terminal, result)
```

- [ ] **Step 3: 新規LazyGit Dock testがmissing moduleで失敗することを確認する**

Run:

```bash
NVIM_TEST_SPEC=lazygit_dock_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=workspace_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: `user.lazygit_dock`が存在しない、または`workspace.git_dock`が委譲しないためFAILする。

- [ ] **Step 4: `user.lazygit_dock`を実装する**

module stateと公開interfaceを次の形にする。

```lua
local M = {}
local terminals = {}
local started = {}

function M.is_terminal_live(terminal, adapter)
  adapter = adapter or {}
  local buf_valid = adapter.buf_valid or vim.api.nvim_buf_is_valid
  local channel_of = adapter.channel_of or function(buffer) return vim.bo[buffer].channel end
  local jobwait = adapter.jobwait or vim.fn.jobwait
  if not terminal or not terminal.buf or not buf_valid(terminal.buf) then return false end
  local channel = channel_of(terminal.buf)
  if type(channel) ~= "number" or channel <= 0 then return false end
  local ok, status = pcall(jobwait, { channel }, 0)
  return ok and status[1] == -1
end

function M.reset_for_tests()
  terminals = {}
  started = {}
end
```

`defaults(adapter)`には`root`、`has_ui`、`executable`、`is_git_repo`、`dock`、`lazygit`、`terminal_live`、`set_keymap`、`register_cleanup`、`ensure_explorer`を定義する。`is_git_repo`はargvで`git -C <root> rev-parse --is-inside-work-tree`を実行し、worktreeの`.git` fileにも対応する。

terminal作成時は次のoptionsとbuffer-local mappingを使う。

```lua
local terminal = runtime.lazygit({
  cwd = root,
  auto_close = false,
  win = {
    position = "right",
    width = 0.36,
    height = 1,
    border = "rounded",
    enter = opts.focus ~= false,
  },
})

runtime.set_keymap("t", "<leader>pp", function()
  require("user.pr_review").list()
end, { buffer = terminal.buf, desc = "List pull requests" })
runtime.set_keymap("t", "<leader>po", "<F12>", {
  buffer = terminal.buf,
  desc = "Open selected pull request",
})
```

`q`と`<C-c>`はLazyGitの終了操作を保ったまま、root単位の`explicit_closes` flagだけを立てるexpr mappingにする。

```lua
runtime.set_keymap("t", "q", function()
  explicit_closes[root] = true
  return "q"
end, { buffer = terminal.buf, expr = true, desc = "Quit LazyGit" })
runtime.set_keymap("t", "<C-c>", function()
  explicit_closes[root] = true
  return "<C-c>"
end, { buffer = terminal.buf, expr = true, desc = "Quit LazyGit" })
```

`open`はlive handleを再利用し、dead handleを破棄して再生成する。手動の`<leader>gg`を含めて表示に成功した時点で`explicit_closes[root] = false`へ戻す。`dock:set_default("lazygit", factory, terminal_live)`へfactoryを登録し、`dock:activate("lazygit", terminal)`する。cleanupではcacheを消し、`explicit_closes[root] == true`の場合だけ`dock:deactivate("lazygit", terminal, { explicit = true, restore = false })`を呼ぶ。異常終了または隠れている間のprocess終了では`explicit = false`にし、後でClaude/Codex/PRを閉じた際にfactoryから再生成できる状態を残す。

`ensure`はUI、executable、Git repositoryを確認した後だけrootを`started`へ記録する。失敗時は通知を一度だけ出し、`started`を無限retryに使わない。

- [ ] **Step 5: workspaceとVeryLazy起動を接続する**

`workspace.git_dock`を薄い委譲に変える。

```lua
function M.git_dock(opts, adapter)
  adapter = adapter or {}
  local lazygit_dock = adapter.lazygit_dock or require("user.lazygit_dock")
  return lazygit_dock.open(opts or { focus = true })
end
```

`config/autocmds.lua`のVeryLazy callbackを次にする。

```lua
callback = function()
  local workspace = require("user.workspace")
  workspace.ensure_explorer({ focus = false })
  require("user.lazygit_dock").ensure({ focus = false })
end,
```

- [ ] **Step 6: LazyGit Dock関連testがPASSすることを確認する**

Run:

```bash
NVIM_TEST_SPEC=lazygit_dock_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=workspace_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=dock_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: 右Dock options、background focus、rootごとの一回起動、headless skip、Dock fallbackがPASSする。

- [ ] **Step 7: 起動時LazyGitをコミットする**

```bash
git add dot_config/nvim/lua/user/lazygit_dock.lua dot_config/nvim/lua/user/workspace.lua dot_config/nvim/lua/config/autocmds.lua tests/nvim/lazygit_dock_spec.lua tests/nvim/workspace_spec.lua
git commit -m "feat(nvim): 起動時の右DockへLazyGitを表示"
```

---

### Task 5: branch対応PR表示と`<leader>p` review aliasを実装する

**Files:**
- Modify: `dot_config/nvim/lua/user/pr_review.lua:1-61`
- Modify: `dot_config/nvim/lua/plugins/octo.lua:8-45`
- Modify: `dot_config/nvim/lua/plugins/plugin.lua:1-113`
- Modify: `tests/nvim/pr_review_spec.lua:1-9`
- Modify: `tests/nvim/octo_spec.lua:1-35`

**Interfaces:**
- Consumes: bridge payload `{ cwd: string, branch: string }`、Dock fallback、Octo review public functions。
- Produces: `pr_review.receive(payload)`、`list(adapter?)`、`open(target?, adapter?)`、`attach(buffer, adapter?)`、`attach_if_review(buffer)`、`on_tab_closed(tab)`、`close(adapter?)`。

- [ ] **Step 1: branch指定gh argvと失敗時restoreのテストを書く**

`tests/nvim/pr_review_spec.lua`へ次のadapter testを追加する。

```lua
local calls = {}
local restored = 0
local commands = {}
local adapter = {
  root = function() return "/repo/.wt/feature" end,
  dock = {
    prepare = function(_, name) calls[#calls + 1] = "prepare:" .. name end,
    activate = function(_, name) calls[#calls + 1] = "activate:" .. name end,
    deactivate = function() restored = restored + 1 end,
  },
  system = function(argv, opts, callback)
    t.eq({ "gh", "pr", "view", "feat/review", "--json", "number" }, argv)
    t.eq("/repo/.wt/feature", opts.cwd)
    callback({ code = 0, stdout = '{"number":133}', stderr = "" })
  end,
  schedule = function(callback) callback() end,
  command = function(command) commands[#commands + 1] = command end,
  notify = function(message) error(message) end,
}

review.open({ cwd = "/repo/.wt/feature", branch = "feat/review" }, adapter)
t.eq({ "prepare:pr", "activate:pr" }, calls)
t.eq({ "Octo pr edit 133" }, commands)

commands = {}
adapter.system = function(_, _, callback)
  callback({ code = 1, stdout = "", stderr = "no pull requests found" })
end
adapter.notify = function(message)
  t.truthy(message:find("feat/review", 1, true))
end
review.open({ cwd = "/repo/.wt/feature", branch = "feat/review" }, adapter)
t.eq(1, restored, "missing PR must restore LazyGit")
t.eq({}, commands, "invalid gh output must never reach Octo")
```

同じtestでbranchが空のときargvからbranchを省略し、`gh pr view --json number`をcurrent branch fallbackとして使うこと、`{"number":"1"}`や`{"number":1.5}`がOcto commandへ到達しないことをassertする。

- [ ] **Step 2: review aliasとOcto既定mapping維持の失敗テストを書く**

`tests/nvim/octo_spec.lua`の`expected`へ次を追加する。

```lua
["<leader>pp"] = "List PRs for review",
["<leader>po"] = "Open branch PR for review",
```

function mappingの比較はdescriptionを使う。既存の次のassertionは維持する。

```lua
t.eq(nil, plugin.opts.mappings_disable_default, "Octo default mappings must stay enabled")
t.eq(nil, plugin.opts.mappings, "Octo review mappings must use the original defaults")
```

`tests/nvim/pr_review_spec.lua`ではtemporary bufferへ`review.attach(buffer, adapter)`し、`maparg`または注入した`set_keymap`から次をassertする。

```lua
local expected_aliases = {
  ["n<leader>pr"] = "Start or resume review",
  ["x<leader>pc"] = "Add review comment",
  ["x<leader>ps"] = "Add review suggestion",
  ["n<leader>pS"] = "Submit review",
  ["n<leader>pd"] = "Discard review",
  ["n<leader>pq"] = "Close review",
}
```

- [ ] **Step 3: PR review testが新interface不足で失敗することを確認する**

Run:

```bash
NVIM_TEST_SPEC=pr_review_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=octo_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: `open`のtarget/adapter、`attach`、新しい`<leader>p` keysが未実装のためFAILする。

- [ ] **Step 4: branch指定PR表示とbridge receiverを実装する**

`pr_review.lua`のadapterは`root`、`dock`、`system`、`schedule`、`defer`、`command`、`notify`、`set_keymap`、`register_cleanup`を持つ。`open`は次のargvをshellなしで構築する。

```lua
local args = { "gh", "pr", "view" }
if type(target.branch) == "string" and target.branch ~= "" then
  args[#args + 1] = target.branch
end
vim.list_extend(args, { "--json", "number" })
runtime.system(args, { cwd = target.cwd or runtime.root(), text = true }, callback)
```

PR session開始時はtoken handleでDockを切り替える。

```lua
local pr_handle = { hide = function() end }

local function enter(runtime)
  runtime.dock:prepare("pr")
  runtime.dock:activate("pr", pr_handle)
end

local function finish(runtime)
  runtime.dock:deactivate("pr", pr_handle)
end
```

`M.receive(payload)`はtable、non-empty cwd、string branchだけを受け付け、不正payloadは通知してreturnする。正常時は`M.open({ cwd = payload.cwd, branch = payload.branch })`へ渡す。`parse_pr`が返したpositive integerだけを`("Octo pr edit %d"):format(number)`へ渡す。

`M.list()`は`enter`後に`Octo pr list`を実行し、失敗時は`finish`する。picker bufferをschedule後に記録し、BufWipeout後50msでOcto bufferまたはreview tabがなければ`finish`する。

- [ ] **Step 5: review buffer-local aliasとsurface cleanupを実装する**

`M.attach(buffer, adapter)`はOcto既定mappingを変更せずaliasを追加する。

```lua
runtime.set_keymap("n", "<leader>pr", function()
  runtime.command("Octo review")
end, { buffer = buffer, desc = "Start or resume review" })
runtime.set_keymap("x", "<leader>pc", function()
  require("octo.reviews").add_review_comment(false)
end, { buffer = buffer, desc = "Add review comment" })
runtime.set_keymap("x", "<leader>ps", function()
  require("octo.reviews").add_review_comment(true)
end, { buffer = buffer, desc = "Add review suggestion" })
runtime.set_keymap("n", "<leader>pS", function()
  require("octo.reviews").submit_review()
end, { buffer = buffer, desc = "Submit review" })
runtime.set_keymap("n", "<leader>pd", function()
  require("octo.reviews").discard_review()
end, { buffer = buffer, desc = "Discard review" })
runtime.set_keymap("n", "<leader>pq", M.close, {
  buffer = buffer,
  desc = "Close review",
})
```

FileType `octo`/`octo_panel`で`attach`し、BufEnter時に`octo.reviews.get_current_review()`が存在すればdiff bufferにも`attach`する。bufferごとのmarkerで二重登録を防ぐ。review tabを記録し、既定`<C-c>`でTabClosedした場合も`finish`する。`<leader>pq`はreview中なら`octo.reviews.close(current_tab)`、PR bufferなら`bdelete`し、その後`finish`する。

BufEnterとTabClosedから呼ぶ公開functionを次の形で定義する。

```lua
function M.attach_if_review(buffer)
  local ok, reviews = pcall(require, "octo.reviews")
  if ok and reviews.get_current_review() then
    M.attach(buffer)
    review_tabs[tostring(vim.api.nvim_get_current_tabpage())] = true
  end
end

function M.on_tab_closed(_)
  schedule_surface_check()
end
```

`schedule_surface_check()`は50ms debounce後に無効なtab handleを`review_tabs`から除き、tracked picker buffer、Octo PR buffer、liveな`review_tabs`がすべて空の場合だけ`finish(defaults())`を呼ぶ。

- [ ] **Step 6: Octo plugin keyとWhichKey groupを接続する**

`plugins/octo.lua`へ既存keysを残したまま次を追加する。

```lua
{
  "<leader>pp",
  function() require("user.pr_review").list() end,
  desc = "List PRs for review",
},
{
  "<leader>po",
  function() require("user.pr_review").open() end,
  desc = "Open branch PR for review",
},
```

既存`OctoReviewExplorer` augroupを`OctoReviewWorkflow`へ広げ、FileTypeでは`attach`と`ensure_review_explorer`、BufEnterでは`attach_if_review(args.buf)`、TabClosedでは`on_tab_closed(args.match)`を呼ぶ。`opts.mappings_disable_default`と`opts.mappings`は追加しない。

`plugins/plugin.lua`へWhichKey specを追加する。

```lua
{
  "folke/which-key.nvim",
  opts = {
    spec = {
      { "<leader>p", group = "pull request" },
    },
  },
},
```

- [ ] **Step 7: branch PR、review alias、既定mapping維持がPASSすることを確認する**

Run:

```bash
NVIM_TEST_SPEC=pr_review_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=octo_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=restored_keymaps_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: gh argv/cwd、整数検証、missing PR restore、6個のreview alias、既存Octo keysがすべてPASSする。

- [ ] **Step 8: PRレビュー導線をコミットする**

```bash
git add dot_config/nvim/lua/user/pr_review.lua dot_config/nvim/lua/plugins/octo.lua dot_config/nvim/lua/plugins/plugin.lua tests/nvim/pr_review_spec.lua tests/nvim/octo_spec.lua
git commit -m "feat(nvim): PRレビュー操作をleader配下へ統一"
```

---

### Task 6: Claude CodeとCodex終了時にLazyGitへ戻す

**Files:**
- Modify: `dot_config/nvim/lua/user/ai_dock.lua:95-299`
- Modify: `dot_config/nvim/lua/plugins/claudecode.lua:44-56`
- Modify: `tests/nvim/ai_dock_spec.lua:46-276`
- Modify: `tests/nvim/claudecode_spec.lua:27-39`

**Interfaces:**
- Consumes: `dock:deactivate(provider, handle)`と`dock:restore_default()`。
- Produces: `ai_dock.on_hidden(provider, target, adapter?)`と、Codex/Claudeのhide・cleanup・失敗時fallback。

- [ ] **Step 1: Codex hideと失敗時restoreの失敗テストを書く**

`tests/nvim/ai_dock_spec.lua`へ次のassertionを追加する。

```lua
local deactivated = {}
local visible_codex = {
  buf = 88,
  hide = function(self) self.hidden = true end,
}
ai.toggle({
  provider = function() return "codex" end,
  root = function() return "/repo" end,
  terminal_get = function() return visible_codex end,
  terminal_visible = function() return true end,
  deactivate_dock = function(name, handle)
    deactivated[#deactivated + 1] = { name, handle }
  end,
})
t.eq(true, visible_codex.hidden)
t.eq({ { "codex", visible_codex } }, deactivated)

local restored = 0
ai.toggle({
  provider = function() return "codex" end,
  root = function() return "/repo" end,
  ensure_explorer = function() end,
  prepare_dock = function() end,
  terminal_get = function() error("terminal failed") end,
  restore_dock = function() restored = restored + 1 end,
  notify = function() end,
})
t.eq(1, restored, "Codex creation failure must restore LazyGit")
```

既存`terminal_visible`がlocal functionの場合はadapter defaultへ昇格して注入可能にする。

- [ ] **Step 2: Claude hide callbackの失敗テストを書く**

`tests/nvim/claudecode_spec.lua`でplugin optionsから`snacks_win_opts.keys.claude_hide[2]`を取得し、fake windowを渡す。

```lua
local hidden = 0
local notified = 0
package.loaded["user.ai_dock"] = {
  attach = function() end,
  on_hidden = function(provider, buffer)
    t.eq("claude", provider)
    t.eq(77, buffer)
    notified = notified + 1
  end,
}
local hide = plugin[1].opts.terminal.snacks_win_opts.keys.claude_hide[2]
hide({ buf = 77, hide = function() hidden = hidden + 1 end })
t.eq(1, hidden)
t.eq(1, notified)
```

- [ ] **Step 3: AI Dock testがdeactivate/restore未実装で失敗することを確認する**

Run:

```bash
NVIM_TEST_SPEC=ai_dock_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=claudecode_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: Codex hideがDockへ通知せず、Claude hide keyも`on_hidden`を呼ばないためFAILする。

- [ ] **Step 4: AI adapterへdeactivate/restoreを追加する**

`ai_dock.lua`のdefault adapterへ追加する。

```lua
deactivate_dock = function(name, handle)
  return dock:deactivate(name, handle)
end,
restore_dock = function()
  return dock:restore_default()
end,
terminal_visible = terminal_visible,
```

`M.on_hidden(provider, target, adapter)`はClaudeならbuffer cacheからhandleを解決し、Codexならtargetをhandleとして`runtime.deactivate_dock(provider, handle)`を呼ぶ。対象がactiveでない場合はDock controllerが何もしない。

Codexがvisibleな`toggle` branchは次の順にする。

```lua
terminal:hide()
runtime.deactivate_dock("codex", terminal)
return
```

Claude/Codexのcommand、terminal取得、show/focusが`prepare_dock`後に失敗した全経路で、通知後に`runtime.restore_dock()`を呼ぶ。buffer cleanupでもcacheを消した後に`deactivate_dock`する。

- [ ] **Step 5: Claude terminal hide keyをDock lifecycleへ接続する**

`plugins/claudecode.lua`の`claude_hide` callbackを次にする。

```lua
function(self)
  self:hide()
  require("user.ai_dock").on_hidden("claude", self.buf)
end,
```

既存`<C-,>`、`<leader>aa/af/ar/aC/ab/as/aA/ad` mappingsは変更しない。

- [ ] **Step 6: AI終了時fallback testがPASSすることを確認する**

Run:

```bash
NVIM_TEST_SPEC=ai_dock_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=claudecode_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
NVIM_TEST_SPEC=dock_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: Claude/Codex hide、process cleanup、起動失敗のすべてでlive LazyGitが復元される。

- [ ] **Step 7: AI Dock fallbackをコミットする**

```bash
git add dot_config/nvim/lua/user/ai_dock.lua dot_config/nvim/lua/plugins/claudecode.lua tests/nvim/ai_dock_spec.lua tests/nvim/claudecode_spec.lua
git commit -m "fix(nvim): AI Dock終了後にLazyGitへ戻す"
```

---

### Task 7: チートシート、chezmoi配備、総合検証を完了する

**Files:**
- Modify: `docs/vim-cheatsheet.md:5-124`
- Verify: all files from Tasks 1-6

**Interfaces:**
- Consumes: 起動時LazyGit、Worktrees panel、`<leader>p` aliases、Dock fallback。
- Produces: 実際のホームディレクトリへ配備済みのNeovim/LazyGit/bridge設定と、再現可能な操作説明。

- [ ] **Step 1: チートシートを新しい通常画面とPR操作へ更新する**

`docs/vim-cheatsheet.md`のUtility Dock説明へ「Git repositoryではLazyGitが通常表示で、Claude/Codex/PRを閉じると戻る」を追加する。Git・worktree表を次の内容へ更新する。

```markdown
| キー | 説明 |
|---|---|
| `<leader>gg` | 右DockのLazyGitを開く / フォーカス |
| `<C-l>` | Editorから右DockのLazyGitへ移動 |
| LazyGitの`3` | Worktreesを先頭tabにした3番目のpanelへ移動 |
| LazyGit Worktreesの`Space` | 選択worktreeへ切り替え |
| `<leader>gw` | AIが最近使った順でworktree workspaceを選択 |
```

GitHub・PRレビュー表の先頭へ次を追加し、既存`<leader>o...`は「Octo互換キー」として残す。

```markdown
| `<leader>pp` | リポジトリのPR一覧を開く |
| `<leader>po` | LazyGit選択branch、または現在branchのPRを開く |
| `<leader>pr` | レビューを開始 / 再開 |
| Visualモードの`<leader>pc` | pending commentを追加 |
| Visualモードの`<leader>ps` | pending suggestionを追加 |
| `<leader>pS` | レビューを送信 |
| `<leader>pd` | pending reviewを破棄 |
| `<leader>pq` | PR/reviewを閉じてLazyGitへ戻る |
```

ファイル・検索表から`<leader>p | Snacks Pickerの一覧`を削除する。

- [ ] **Step 2: LuaとTypeScriptの対象testを個別に実行する**

Run:

```bash
bun test tests/nvim-pr-review-bridge.test.ts tests/lazygit-config.test.ts tests/worktree-activity.test.ts
nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: Bunと全Neovim specsがPASSする。

- [ ] **Step 3: formatとheadless config loadを検証する**

Run:

```bash
stylua --check dot_config/nvim/lua tests/nvim
XDG_CONFIG_HOME=/Users/kosui/.local/share/chezmoi/.wt/fix/nvim-leader-find-files/dot_config nvim --headless +qa
git diff --check
```

Expected: StyLua、module load、whitespace checkがすべてexit 0。

- [ ] **Step 4: LazyGit設定を実binaryで検証する**

Run:

```bash
lazygit --use-config-file "Library/Application Support/lazygit/config.yml" --config
```

Expected: exit 0。出力の`gui.sidePanels`でWorktrees groupが3番目にあり、customCommandsが3件表示される。

- [ ] **Step 5: chezmoi差分を確認して配備する**

Run:

```bash
chezmoi diff
chezmoi apply
cmp "Library/Application Support/lazygit/config.yml" "/Users/kosui/Library/Application Support/lazygit/config.yml"
cmp dot_local/bin/executable_nvim-pr-review /Users/kosui/.local/bin/nvim-pr-review
```

Expected: diffが今回のNeovim、LazyGit、bridge、docsだけで、apply後の2つの`cmp`がexit 0。

- [ ] **Step 6: interactive smoke testを実行する**

Git repositoryで`nvim .`を起動し、次を順に確認する。

```text
1. 左Explorer、中央Editor、右LazyGitが表示され、cursorはEditorにある
2. <C-l>、3でWorktrees panelへ移動できる
3. Space、n、o、d、G、PがLazyGit標準どおり動く
4. WorktreesまたはLocal Branchesで<leader>poを押すと選択branchのPRがOctoで開く
5. <leader>ppでcheckoutしていない他者PRを一覧から開ける
6. <leader>pr、Visual <leader>pc/ps、<leader>pSでレビューを完了できる
7. <leader>pqまたはOcto既定<C-c>で閉じるとLazyGitが戻る
8. Claude CodeとCodexをそれぞれ開閉するとLazyGitが戻る
9. LazyGit自体をqで閉じた場合は勝手に再表示されない
```

- [ ] **Step 7: 最終差分と未追跡ファイルを監査する**

Run:

```bash
git status --short
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

Expected: `.Codex/`以外に意図しない未追跡ファイルがなく、PR #133の復元キーマップ、今回のLazyGit/PR変更、仕様・計画・docsだけが含まれる。

- [ ] **Step 8: docsと配備検証結果をコミットする**

```bash
git add docs/vim-cheatsheet.md
git commit -m "docs(nvim): LazyGit中心のPRレビュー手順を追加"
```

---

## References

- Design spec: `docs/superpowers/specs/2026-08-09-nvim-lazygit-worktree-pr-review-design.md`
- Prior keymap change: <https://github.com/iwasa-kosui/dotfiles/pull/133>
- LazyGit configuration: <https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md>
- LazyGit custom commands: <https://github.com/jesseduffield/lazygit/blob/master/docs/Custom_Command_Keybindings.md>
- LazyGit keybindings: <https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md>
- Snacks LazyGit local docs: `/Users/kosui/.local/share/nvim/lazy/snacks.nvim/docs/lazygit.md`
- Octo default mappings: `/Users/kosui/.local/share/nvim/lazy/octo.nvim/lua/octo/config.lua`
