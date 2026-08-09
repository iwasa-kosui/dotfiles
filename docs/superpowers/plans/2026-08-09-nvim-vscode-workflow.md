# Neovim VSCodeライクワークフロー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 常設Explorer、少数のグローバル操作、base差分表示、worktree切替、共通AI Dock、PRレビューを一つのNeovimワークフローとして実装します。

**Architecture:** LazyVimと既存プラグインを残し、`lua/user/`配下の小さなモジュールで画面、Git、worktree、AI、PRを分離します。外部コマンドの出力解析と並び順は純粋関数へ分けてheadlessテストを行い、Snacks、Octo、cmuxとの接続は薄いadapterに限定します。

**Tech Stack:** Neovim 0.12、Lua、LazyVim、Snacks.nvim、Grug-far、Bufferline、Diffview、Octo.nvim、claudecode.nvim、Bun、cmux CLI、chezmoi

## Global Constraints

- 作業場所は`/Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow`に固定します。
- LazyVimと既存プラグインを残し、新しいNeovimプラグインは追加しません。
- Explorerは通常画面とPRレビュー画面の左側へ常設します。
- 一つのworktreeを一つのcmux workspaceとNeovimプロセスへ対応させ、Neovim内でworktreeのcwdを切り替えません。
- Vim標準操作、Insertモードの補完、buffer-local操作は残し、グローバル`<leader>`操作だけを許可リストで整理します。
- Claude CodeとCodexの活動記録へプロンプト、会話、ファイル内容を保存しません。
- PRレビューコメントはpending reviewへ追加し、明示的な送信操作まで公開しません。
- 自動LSPホバーを削除し、`K`による明示表示とinlay hintsを残します。
- 削除操作はmacOSのゴミ箱を使い、直接削除しません。
- 成果物とコメントは日本語で書き、コミットはConventional Commits形式にします。
- commitのamendとforce pushは行いません。

## File Map

- `dot_config/nvim/lua/user/keymap_policy.lua`: 許可するグローバルマッピングと不要マッピングの削除を管理します。
- `dot_config/nvim/lua/user/workspace.lua`: Explorer、検索、置換、ファイル移動、分割、Git Dockの入口を提供します。
- `dot_config/nvim/lua/user/base_diff.lua`: base解決、Git出力解析、Explorer用状態キャッシュを管理します。
- `dot_config/nvim/lua/user/worktrees.lua`: worktree一覧、活動順ソート、cmux workspace選択を管理します。
- `dot_config/nvim/lua/user/ai_dock.lua`: Claude CodeとCodexの共通コンテキストとDock表示を管理します。
- `dot_config/nvim/lua/user/pr_review.lua`: 現在ブランチのPR解決とOctoレビュー開始を管理します。
- `dot_local/lib/worktree-activity.ts`: worktree活動記録の保存と読み込みを担当します。
- `dot_local/bin/executable_worktree-activity`: Claude、Codex、Neovimから共通利用するCLIです。
- `tests/nvim/`: 純粋Luaモジュールとグローバルマッピングをheadless Neovimで検証します。
- `tests/worktree-activity.test.ts`: 活動記録の保存、破損データの無視、最新時刻の選択を検証します。

---

### Task 1: Core Workspace UI and Curated Keymaps

**Files:**
- Create: `dot_config/nvim/lua/user/keymap_policy.lua`
- Create: `dot_config/nvim/lua/user/workspace.lua`
- Create: `tests/nvim/testlib.lua`
- Create: `tests/nvim/run.lua`
- Create: `tests/nvim/keymap_policy_spec.lua`
- Modify: `dot_config/nvim/lua/config/keymaps.lua`
- Modify: `dot_config/nvim/lua/config/autocmds.lua`
- Modify: `dot_config/nvim/lua/plugins/plugin.lua`
- Modify: `dot_config/nvim/lua/plugins/multicursors.lua`
- Modify: `dot_config/nvim/lua/plugins/minuet.lua`
- Delete: `dot_config/nvim/lua/user/vscode_keymaps.lua`

**Interfaces:**
- Produces: `require("user.keymap_policy").prune()`
- Produces: `require("user.keymap_policy").is_allowed(mode, lhs) -> boolean`
- Produces: `require("user.workspace").ensure_explorer(opts?)`
- Produces: `require("user.workspace").focus_explorer()`
- Produces: `require("user.workspace").files()`
- Produces: `require("user.workspace").search()`
- Produces: `require("user.workspace").replace()`
- Produces: `require("user.workspace").next_file()`
- Produces: `require("user.workspace").previous_file()`
- Produces: `require("user.workspace").git_dock()`

- [ ] **Step 1: Add the headless Lua test runner**

`tests/nvim/testlib.lua`へ比較helperを追加します。

```lua
local M = {}

function M.eq(expected, actual, message)
  if not vim.deep_equal(expected, actual) then
    error((message or "values differ") .. "\nexpected: " .. vim.inspect(expected) .. "\nactual: " .. vim.inspect(actual))
  end
end

function M.truthy(value, message)
  if not value then
    error(message or "expected a truthy value")
  end
end

return M
```

`tests/nvim/run.lua`は`*_spec.lua`を名前順に実行します。

```lua
local root = vim.fn.getcwd()
package.path = table.concat({
  root .. "/dot_config/nvim/lua/?.lua",
  root .. "/dot_config/nvim/lua/?/init.lua",
  root .. "/tests/nvim/?.lua",
  package.path,
}, ";")

local specs = {}
for name, kind in vim.fs.dir(root .. "/tests/nvim") do
  if kind == "file" and name:match("_spec%.lua$") then
    specs[#specs + 1] = name
  end
end
table.sort(specs)

for _, name in ipairs(specs) do
  local ok, err = pcall(dofile, root .. "/tests/nvim/" .. name)
  if not ok then
    error(name .. ": " .. tostring(err))
  end
end
```

- [ ] **Step 2: Write the failing keymap policy test**

`tests/nvim/keymap_policy_spec.lua`へ許可キーと拒否キーを固定します。

```lua
local t = require("testlib")
local policy = require("user.keymap_policy")

for _, lhs in ipairs({
  "<leader>e", "<leader>f", "<leader>s", "<leader>r",
  "<leader>w", "<leader>a", "<leader>g", "<leader>p",
  "<leader>bn", "<leader>bp", "<leader>bd", "<leader>wd",
  "<leader>|", "<leader>-",
}) do
  t.truthy(policy.is_allowed("n", lhs), lhs .. " must remain")
end

t.truthy(policy.is_allowed("x", "<leader>as"), "visual AI send must remain")
t.eq(false, policy.is_allowed("n", "<leader>opl"))
t.eq(false, policy.is_allowed("n", "<leader>gg"))
t.eq(false, policy.is_allowed("n", "<leader>mp"))
t.eq(false, policy.is_allowed("x", "<leader>r"))

vim.g.mapleader = " "
vim.keymap.set("n", "<leader>e", function() end)
vim.keymap.set("n", "<leader>opl", function() end)
policy.prune()
t.truthy(vim.fn.maparg("<leader>e", "n") ~= "", "allowed mapping must survive pruning")
t.eq("", vim.fn.maparg("<leader>opl", "n"), "rejected mapping must be removed")
```

- [ ] **Step 3: Run the test and verify that the module is missing**

Run:

```bash
cd /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow
nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: FAIL with `module 'user.keymap_policy' not found`.

- [ ] **Step 4: Implement the keymap allowlist and pruning**

`keymap_policy.lua`では`<leader>`表記と実際のleader文字を正規化し、Normal、Visual、Operator-pendingのグローバルマッピングだけを整理します。Insert、Command-line、Terminal、buffer-localマッピングは対象外にします。

```lua
local M = {}

local allowed = {
  n = {
    ["<leader>e"] = true, ["<leader>f"] = true,
    ["<leader>s"] = true, ["<leader>r"] = true,
    ["<leader>w"] = true, ["<leader>a"] = true,
    ["<leader>af"] = true, ["<leader>g"] = true,
    ["<leader>p"] = true, ["<leader>bn"] = true,
    ["<leader>bp"] = true, ["<leader>bd"] = true,
    ["<leader>wd"] = true, ["<leader>|"] = true,
    ["<leader>-"] = true,
  },
  x = { ["<leader>as"] = true },
  o = {},
}

function M.is_allowed(mode, lhs)
  return allowed[mode] and allowed[mode][lhs] == true or false
end

local function display_lhs(lhs)
  local leader = vim.g.mapleader or "\\"
  if lhs:sub(1, 7) == "<Space>" and leader == " " then
    return "<leader>" .. lhs:sub(8)
  end
  if lhs:sub(1, #leader) == leader then
    return "<leader>" .. lhs:sub(#leader + 1)
  end
  return lhs
end

function M.prune()
  for _, mode in ipairs({ "n", "x", "o" }) do
    for _, mapping in ipairs(vim.api.nvim_get_keymap(mode)) do
      local lhs = display_lhs(mapping.lhs)
      if lhs:sub(1, 8) == "<leader>" and not M.is_allowed(mode, lhs) then
        pcall(vim.keymap.del, mode, mapping.lhs)
      end
    end
  end
end

return M
```

- [ ] **Step 5: Implement the workspace entry points**

`workspace.lua`はプラグインの公開APIだけを呼びます。Git DockもUtility Dockと同じ右側へ表示します。

```lua
local M = {}

local function root()
  return require("lazyvim.util").root.get({ normalize = true }) or vim.uv.cwd()
end

function M.ensure_explorer(opts)
  opts = opts or {}
  local current = vim.api.nvim_get_current_win()
  Snacks.explorer({ cwd = root() })
  if opts.focus == false then
    vim.schedule(function()
      if vim.api.nvim_win_is_valid(current) then
        vim.api.nvim_set_current_win(current)
      end
    end)
  end
end

function M.focus_explorer()
  Snacks.explorer.reveal({ file = vim.api.nvim_buf_get_name(0) })
end

function M.files()
  Snacks.picker.files({ cwd = root() })
end

function M.search()
  Snacks.picker.grep({ cwd = root() })
end

function M.replace()
  require("grug-far").open({ transient = true, prefills = { paths = root() } })
end

function M.next_file()
  vim.cmd.bnext()
end

function M.previous_file()
  vim.cmd.bprevious()
end

function M.git_dock()
  Snacks.lazygit({ cwd = root(), win = { position = "right", width = 0.36, height = 1 } })
end

return M
```

- [ ] **Step 6: Replace the global keymap definitions**

`config/keymaps.lua`を短い入口だけに置き換えます。`<C-Tab>`と`<leader>bn`、`<C-S-Tab>`と`<leader>bp`は同じ関数を呼びます。

```lua
local workspace = require("user.workspace")
local map = vim.keymap.set

map("n", "<leader>e", workspace.focus_explorer, { desc = "Explorer" })
for _, lhs in ipairs({ "<C-p>", "<leader>f" }) do
  map("n", lhs, workspace.files, { desc = "Find files" })
end
for _, lhs in ipairs({ "<C-S-f>", "<leader>s" }) do
  map("n", lhs, workspace.search, { desc = "Search text" })
end
map("n", "<leader>r", workspace.replace, { desc = "Replace across files" })
for _, lhs in ipairs({ "<C-Tab>", "<leader>bn" }) do
  map("n", lhs, workspace.next_file, { desc = "Next file" })
end
for _, lhs in ipairs({ "<C-S-Tab>", "<leader>bp" }) do
  map("n", lhs, workspace.previous_file, { desc = "Previous file" })
end
map("n", "<leader>bd", function() Snacks.bufdelete() end, { desc = "Close file" })
map("n", "<leader>|", "<C-w>v", { remap = true, desc = "Split right" })
map("n", "<leader>-", "<C-w>s", { remap = true, desc = "Split below" })
map("n", "<leader>wd", "<C-w>c", { remap = true, desc = "Close editor group" })
map("n", "<leader>g", workspace.git_dock, { desc = "Git dock" })

vim.schedule(function()
  require("user.keymap_policy").prune()
end)
```

Keep LazyVim's existing `<C-h/j/k/l>`, `K`, `gd`, `gr`, `[d`, `]d`, `<leader>ca`, and `<leader>cr` mappings. Remove the path-copy and browser-PR mappings from the old file.

- [ ] **Step 7: Configure the persistent Explorer and curated Which-key**

In `plugins/plugin.lua`, remove its entire `keys` block, including `gR` and `gF`, and configure Snacks through `opts`. LazyVim's remaining global leader mappings are removed later by `keymap_policy.prune()`:

```lua
{
  "folke/snacks.nvim",
  opts = function(_, opts)
    opts.explorer = vim.tbl_deep_extend("force", opts.explorer or {}, { trash = true })
    opts.picker = opts.picker or {}
    opts.picker.sources = opts.picker.sources or {}
    opts.picker.sources.explorer = vim.tbl_deep_extend("force", opts.picker.sources.explorer or {}, {
      auto_close = false,
      jump = { close = false },
      follow_file = true,
      git_status = true,
      layout = {
        preset = "sidebar",
        preview = false,
        layout = { width = 32, min_width = 32, max_width = 32 },
      },
      win = {
        list = {
          keys = {
            a = "explorer_add",
            r = "explorer_rename",
            m = "explorer_move",
            d = "explorer_del",
            c = "explorer_copy",
            p = "explorer_paste",
            v = "edit_vsplit",
            s = "edit_split",
            ["?"] = "toggle_help_list",
            q = false,
            ["<Esc>"] = false,
          },
        },
      },
    })
  end,
}
```

Register a `User VeryLazy` callback that calls `workspace.ensure_explorer({ focus = false })`. Reset Which-key's inherited `opts.spec` to the single `<leader>b` file group; descriptions for the top-level workflow keys come from `config/keymaps.lua`.

```lua
{
  "folke/which-key.nvim",
  opts = function(_, opts)
    opts.spec = { { "<leader>b", group = "file" } }
  end,
}
```

Remove the global key specs from `multicursors.lua` and the Minuet duet commands from `minuet.lua`. Keep Minuet's Insert-mode virtual-text keys. Delete the unloaded `lua/user/vscode_keymaps.lua` file.

- [ ] **Step 8: Remove automatic hover**

Delete the `CursorHold` LSP hover autocmd and `popup_replace_inspect_with_hover` menu override from `config/autocmds.lua`. Do not change `lsp.lua`; its inlay hints and diagnostic configuration remain.

- [ ] **Step 9: Run focused verification**

Run:

```bash
cd /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow
nvim --headless -u NONE -l tests/nvim/run.lua
/Users/kosui/.local/share/nvim/mason/bin/stylua --check dot_config/nvim/lua
```

Expected: all Lua specs pass and StyLua exits 0.

- [ ] **Step 10: Commit the core workspace UI**

```bash
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow add \
  dot_config/nvim/lua/config \
  dot_config/nvim/lua/plugins/plugin.lua \
  dot_config/nvim/lua/plugins/multicursors.lua \
  dot_config/nvim/lua/plugins/minuet.lua \
  dot_config/nvim/lua/user \
  tests/nvim
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow commit \
  -m "feat(nvim): 常設Explorerと厳選キーマップへ操作を統一"
```

### Task 2: Base-Branch Git Decorations

**Files:**
- Create: `dot_config/nvim/lua/user/base_diff.lua`
- Create: `tests/nvim/base_diff_spec.lua`
- Modify: `dot_config/nvim/lua/plugins/plugin.lua`
- Modify: `dot_config/nvim/lua/plugins/git.lua`

**Interfaces:**
- Produces: `require("user.base_diff").parse_name_status(lines) -> table<string, string>`
- Produces: `require("user.base_diff").parse_porcelain(lines) -> table<string, string>`
- Produces: `require("user.base_diff").base_candidates(pr_base, origin_head) -> string[]`
- Produces: `require("user.base_diff").refresh(cwd, callback?)`
- Produces: `require("user.base_diff").status(path) -> "A"|"M"|"R"|nil`
- Produces: `require("user.base_diff").format(item, picker) -> snacks.picker.Highlight[]`

- [ ] **Step 1: Write failing parser and fallback tests**

```lua
local t = require("testlib")
local diff = require("user.base_diff")

t.eq({
  ["lua/new.lua"] = "A",
  ["lua/edit.lua"] = "M",
  ["lua/moved.lua"] = "R",
}, diff.parse_name_status({
  "A\tlua/new.lua",
  "M\tlua/edit.lua",
  "R100\tlua/old.lua\tlua/moved.lua",
  "D\tlua/gone.lua",
}))

t.eq({
  ["lua/edit.lua"] = "M",
  ["lua/untracked.lua"] = "A",
}, diff.parse_porcelain({ " M lua/edit.lua", "?? lua/untracked.lua" }))

t.eq(
  { "origin/develop", "origin/main", "origin/master" },
  diff.base_candidates("develop", nil)
)
```

- [ ] **Step 2: Run the test and verify that `user.base_diff` is missing**

Run `nvim --headless -u NONE -l tests/nvim/run.lua` and expect failure for `user.base_diff`.

- [ ] **Step 3: Implement parsing and base resolution**

Use these Git commands in order:

```text
gh pr view --json baseRefName
git symbolic-ref --short refs/remotes/origin/HEAD
git merge-base HEAD <base>
git diff --name-status --find-renames <merge-base>
git status --porcelain=v1 --untracked-files=all
```

`parse_name_status` records the destination path for rename rows and omits deleted paths because no Explorer node exists. `parse_porcelain` maps `??` to `A` and collapses staged and unstaged codes into one `M/A/D/R` marker. Implement both parsers without invoking Git so the tests remain deterministic:

```lua
function M.parse_name_status(lines)
  local result = {}
  for _, line in ipairs(lines) do
    local columns = vim.split(line, "\t", { plain = true })
    local code = columns[1] and columns[1]:sub(1, 1)
    local path = code == "R" and columns[3] or columns[2]
    if path and code ~= "D" then
      result[path] = code
    end
  end
  return result
end
```

`refresh` runs the commands with `vim.system`, merges untracked files into the base map, stores results by normalized absolute path, and invokes the callback through `vim.schedule`. Preserve the last successful cache if a refresh fails.

- [ ] **Step 4: Add base-diff highlights to the Explorer formatter**

Define these highlight links once:

```lua
vim.api.nvim_set_hl(0, "ExplorerBaseAdded", { link = "GitSignsAdd" })
vim.api.nvim_set_hl(0, "ExplorerBaseModified", { link = "GitSignsChange" })
vim.api.nvim_set_hl(0, "ExplorerBaseRenamed", { link = "GitSignsChange" })
```

`base_diff.format` wraps `Snacks.picker.format.file(item, picker)`. For every returned chunk whose `field` is `file`, replace its highlight with the base-status highlight. Leave `item.status` unchanged so Snacks can render the working-tree `M/A/D/R` marker separately.

Configure `picker.sources.explorer.format = require("user.base_diff").format` and keep `git_status = true` plus `git_status_hl = false`. The custom formatter owns filename color; the built-in status column owns the right-side marker.

- [ ] **Step 5: Refresh without blocking the UI**

Add one augroup with `BufWritePost`, `FocusGained`, and `ShellCmdPost`. Debounce refreshes by 200 ms with one `vim.uv.new_timer()` per worktree. Trigger an initial refresh after Explorer opens.

- [ ] **Step 6: Simplify the Git plugin surface**

Remove the old `<leader>gg`, `<leader>gz`, `<leader>gh`, `<leader>gH`, and `<leader>gw` global keys from `plugins/git.lua`. Keep Diffview and lazygit command loading, because Git Dock and Octo still use them. Worktree mapping is added in Task 3.

- [ ] **Step 7: Run tests and formatting**

```bash
cd /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow
nvim --headless -u NONE -l tests/nvim/run.lua
/Users/kosui/.local/share/nvim/mason/bin/stylua --check dot_config/nvim/lua
```

Expected: base parsing and all earlier specs pass.

- [ ] **Step 8: Commit base-aware Git decoration**

```bash
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow add \
  dot_config/nvim/lua/user/base_diff.lua \
  dot_config/nvim/lua/plugins/plugin.lua \
  dot_config/nvim/lua/plugins/git.lua \
  tests/nvim/base_diff_spec.lua
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow commit \
  -m "feat(nvim): base差分と未コミット状態をExplorerで分離"
```

### Task 3: Recent Worktree Activity and cmux Switching

**Files:**
- Create: `dot_local/lib/worktree-activity.ts`
- Create: `dot_local/bin/executable_worktree-activity`
- Create: `tests/worktree-activity.test.ts`
- Create: `dot_config/nvim/lua/user/worktrees.lua`
- Create: `tests/nvim/worktrees_spec.lua`
- Modify: `dot_claude/hooks/executable_session-init.ts`
- Modify: `dot_codex/hooks/executable_session-init.ts`
- Modify: `dot_config/nvim/lua/config/keymaps.lua`
- Modify: `dot_config/nvim/lua/plugins/git.lua`

**Interfaces:**
- Produces: `recordActivity(cwd: string, source: "claude"|"codex"|"nvim", options?) -> Promise<Activity>`
- Produces: `readActivities(options?) -> Promise<Activity[]>`
- Produces CLI: `worktree-activity record <claude|codex|nvim> <cwd>`
- Produces CLI: `worktree-activity list`
- Produces: `require("user.worktrees").parse_porcelain(lines) -> Worktree[]`
- Produces: `require("user.worktrees").sort(items, activities, current) -> Worktree[]`
- Produces: `require("user.worktrees").open()`

- [ ] **Step 1: Write failing Bun tests for activity state**

Use a test-owned temporary state directory and never read real Claude or Codex state.

```ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readActivities, recordActivity } from "../dot_local/lib/worktree-activity";

describe("worktree activity", () => {
  test("keeps one latest record per worktree and source", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "worktree-activity-"));
    await recordActivity("/repo/.wt/feat-a", "claude", { stateDir, now: 10 });
    await recordActivity("/repo/.wt/feat-a", "claude", { stateDir, now: 20 });
    expect(await readActivities({ stateDir })).toEqual([
      expect.objectContaining({ path: "/repo/.wt/feat-a", source: "claude", lastUsedAt: 20 }),
    ]);
  });

  test("ignores malformed records", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "worktree-activity-"));
    await writeFile(join(stateDir, "broken.json"), "{");
    expect(await readActivities({ stateDir })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run Bun tests and verify the module is missing**

Run `bun test tests/worktree-activity.test.ts` and expect module resolution failure.

- [ ] **Step 3: Implement the activity library and CLI**

Store one JSON file per normalized path and source under `${XDG_STATE_HOME:-~/.local/state}/worktree-activity/`. Hash `path + "\0" + source` with SHA-256 for the filename. Write to a sibling temporary file and rename it atomically.

```ts
export type ActivitySource = "claude" | "codex" | "nvim";

export type Activity = {
  path: string;
  source: ActivitySource;
  lastUsedAt: number;
};

export type ActivityOptions = {
  stateDir?: string;
  now?: number;
};
```

The executable imports from `../lib/worktree-activity`, accepts only `record` and `list`, and starts with `#!/usr/bin/env bun`. `record` emits the saved record as JSON. `list` emits a JSON array sorted by `path` and then `source` for deterministic output. Invalid sources and missing arguments exit 2 with a concise usage message.

- [ ] **Step 4: Record Claude and Codex SessionStart activity**

After each `session-init.ts` confirms it is inside a Git repository, import `homedir` from `node:os` and add one non-fatal call:

```ts
await runSafe([
  join(homedir(), ".local", "bin", "worktree-activity"),
  "record",
  "claude",
  cwd,
]);
```

Import `join` from `node:path`. Use `codex` as the source in the Codex copy. Failure must not prevent the existing worktree, PR, or Jira context from being printed.

- [ ] **Step 5: Write failing Lua tests for worktree parsing and sorting**

```lua
local t = require("testlib")
local worktrees = require("user.worktrees")

local items = worktrees.parse_porcelain({
  "worktree /repo",
  "HEAD aaaa",
  "branch refs/heads/main",
  "",
  "worktree /repo/.wt/feat-a",
  "HEAD bbbb",
  "branch refs/heads/feat/a",
  "",
  "worktree /repo/.wt/feat-b",
  "HEAD cccc",
  "branch refs/heads/feat/b",
  "",
})

local sorted = worktrees.sort(items, {
  { path = "/repo/.wt/feat-b", source = "codex", lastUsedAt = 30 },
  { path = "/repo/.wt/feat-a", source = "claude", lastUsedAt = 20 },
}, "/repo/.wt/feat-a")

t.eq({ "feat/a", "feat/b", "main" }, vim.tbl_map(function(item) return item.branch end, sorted))
```

- [ ] **Step 6: Implement the worktree picker and cmux adapter**

`worktrees.open()` performs these commands with JSON decoding and explicit error notifications:

```text
git worktree list --porcelain
worktree-activity list
cmux workspace list --json
cmux tree --all --json
```

Resolve the cmux executable from `vim.fn.exepath("cmux")`, then fall back to `/Applications/cmux.app/Contents/Resources/bin/cmux`.

Recursively walk `tree --all --json` and match a workspace object whose `cwd` or `working_directory` normalizes to the selected path. Cross-check its ID against `workspace list --json` before selecting it. Do not use the display name for matching.

Select or create with these argv arrays:

```lua
{ cmux, "workspace", "select", workspace_id }
{ cmux, "workspace", "create", "--name", repo .. ":" .. branch, "--cwd", path, "--command", "nvim", "--json" }
```

Never call `vim.cmd.cd`. If cmux fails, close no buffers and leave the current worktree unchanged.

- [ ] **Step 7: Add Neovim activity recording and the picker mapping**

On `VimEnter` and `FocusGained`, call the CLI asynchronously:

```lua
vim.system({ "worktree-activity", "record", "nvim", vim.uv.cwd() }, { text = true })
```

Map `<leader>w` to `require("user.worktrees").open`. Replace the old picker implementation in `plugins/git.lua` with the new module.

- [ ] **Step 8: Run TypeScript, Lua, and CLI tests**

```bash
cd /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow
bun test tests/worktree-activity.test.ts
nvim --headless -u NONE -l tests/nvim/run.lua
activity_test_state="$(mktemp -d)"
XDG_STATE_HOME="$activity_test_state" bun dot_local/bin/executable_worktree-activity list
```

Expected: tests pass and the CLI prints a JSON array without reading any conversation files.

- [ ] **Step 9: Commit worktree activity and switching**

```bash
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow add \
  dot_local/lib/worktree-activity.ts \
  dot_local/bin/executable_worktree-activity \
  dot_claude/hooks/executable_session-init.ts \
  dot_codex/hooks/executable_session-init.ts \
  dot_config/nvim/lua/config/keymaps.lua \
  dot_config/nvim/lua/plugins/git.lua \
  dot_config/nvim/lua/user/worktrees.lua \
  tests/worktree-activity.test.ts \
  tests/nvim/worktrees_spec.lua
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow commit \
  -m "feat(worktree): AI活動順のcmux切替を追加"
```

### Task 4: Shared Claude Code and Codex Dock

**Files:**
- Create: `dot_config/nvim/lua/user/ai_dock.lua`
- Create: `tests/nvim/ai_dock_spec.lua`
- Modify: `dot_config/nvim/lua/config/keymaps.lua`
- Modify: `dot_config/nvim/lua/plugins/claudecode.lua`

**Interfaces:**
- Consumes: `require("user.workspace").ensure_explorer(opts?)`
- Produces: `require("user.ai_dock").context(path, start_line, end_line, text) -> AiContext`
- Produces: `require("user.ai_dock").codex_prompt(context, root) -> string`
- Produces: `require("user.ai_dock").toggle()`
- Produces: `require("user.ai_dock").send_file()`
- Produces: `require("user.ai_dock").send_selection()`

- [ ] **Step 1: Write failing context and Codex prompt tests**

```lua
local t = require("testlib")
local ai = require("user.ai_dock")

local context = ai.context("/repo/lua/keymaps.lua", 10, 12, "local x = 1")
t.eq({
  path = "/repo/lua/keymaps.lua",
  startLine = 10,
  endLine = 12,
  text = "local x = 1",
}, context)

t.eq(
  "@lua/keymaps.lua 10-12行を確認してください。\n\n```\nlocal x = 1\n```",
  ai.codex_prompt(context, "/repo")
)
```

- [ ] **Step 2: Run the Lua suite and verify `user.ai_dock` is missing**

Run `nvim --headless -u NONE -l tests/nvim/run.lua` and expect module resolution failure.

- [ ] **Step 3: Implement normalized AI context**

Define this type in LuaLS annotations and keep provider-independent logic pure:

```lua
---@class AiContext
---@field path string
---@field startLine integer?
---@field endLine integer?
---@field text string?
```

`send_file` uses the current buffer path. `send_selection` reads the Visual marks with `vim.fn.getpos("'<")` and `vim.fn.getpos("'>")`, normalizes their order, and joins the selected lines with newlines.

- [ ] **Step 4: Implement the Codex terminal adapter**

Create the terminal with a stable command and cwd so Snacks reuses the same session:

```lua
local opts = {
  cwd = root,
  auto_close = false,
  win = {
    position = "right",
    width = 0.36,
    height = 1,
    border = "rounded",
  },
}
local terminal = Snacks.terminal.get({ "codex", "-C", root }, opts)
assert(terminal, "failed to create Codex terminal")
terminal:show()
terminal:focus()
```

Send prompts through the terminal buffer channel:

```lua
local channel = vim.bo[terminal.buf].channel
vim.api.nvim_chan_send(channel, prompt .. "\n")
```

Before showing Codex, hide the visible Claude terminal. Register Normal-mode Dock-local `p` and `r` on every provider buffer: `p` switches provider, and `r` resumes the selected provider. Codex resume uses `codex -C <root> resume --last` in the same Dock.

- [ ] **Step 5: Adapt Claude Code without duplicating its transport**

Keep claudecode.nvim as the Claude transport. Use `ClaudeCodeFocus`, `ClaudeCodeAdd %`, the Visual `ClaudeCodeSend` command, and `ClaudeCode --resume` for Dock-local `r`. Before focusing Claude, hide the visible Codex Snacks terminal. Keep Claude diff accept and deny mappings only in Claude-owned buffers.

Remove the old global `<leader>aa`, `<leader>af`, `<leader>ar`, `<leader>aC`, `<leader>ab`, `<leader>aA`, and `<leader>ad` specs from `plugins/claudecode.lua`. Configure its Snacks window to the shared right-side dimensions.

- [ ] **Step 6: Register the shared global AI mappings**

```lua
local ai = require("user.ai_dock")
vim.keymap.set("n", "<leader>a", ai.toggle, { desc = "AI dock" })
vim.keymap.set("n", "<leader>af", ai.send_file, { desc = "Send current file to AI" })
vim.keymap.set("x", "<leader>as", ai.send_selection, { desc = "Send selection to AI" })
```

Persist only the last provider name in `vim.fn.stdpath("state") .. "/ai-dock.json"`. Do not store prompt text or selected code.

- [ ] **Step 7: Run tests and a headless load check**

```bash
cd /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow
nvim --headless -u NONE -l tests/nvim/run.lua
/Users/kosui/.local/share/nvim/mason/bin/stylua --check dot_config/nvim/lua
```

Expected: context formatting tests pass, and no provider process starts during headless tests.

- [ ] **Step 8: Commit the shared AI Dock**

```bash
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow add \
  dot_config/nvim/lua/user/ai_dock.lua \
  dot_config/nvim/lua/config/keymaps.lua \
  dot_config/nvim/lua/plugins/claudecode.lua \
  tests/nvim/ai_dock_spec.lua
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow commit \
  -m "feat(nvim): Claude CodeとCodexを共通Dockへ統合"
```

### Task 5: Focused Octo PR Review Workflow

**Files:**
- Create: `dot_config/nvim/lua/user/pr_review.lua`
- Create: `tests/nvim/pr_review_spec.lua`
- Modify: `dot_config/nvim/lua/config/keymaps.lua`
- Modify: `dot_config/nvim/lua/plugins/octo.lua`
- Modify: `dot_config/nvim/lua/user/workspace.lua`

**Interfaces:**
- Consumes: `require("user.workspace").ensure_explorer({ focus = false })`
- Produces: `require("user.pr_review").parse_pr(json) -> integer?`
- Produces: `require("user.pr_review").open()`
- Produces: `require("user.pr_review").ensure_review_explorer()`

- [ ] **Step 1: Write failing PR resolution tests**

```lua
local t = require("testlib")
local review = require("user.pr_review")

t.eq(133, review.parse_pr('{"number":133}'))
t.eq(nil, review.parse_pr(""))
t.eq(nil, review.parse_pr("not-json"))
```

- [ ] **Step 2: Run the Lua suite and verify `user.pr_review` is missing**

Run `nvim --headless -u NONE -l tests/nvim/run.lua` and expect module resolution failure.

- [ ] **Step 3: Implement current-branch PR opening**

`pr_review.open()` runs `gh pr view --json number` asynchronously. If a number is returned, schedule `Octo pr edit <number>`. If `gh` exits nonzero or returns invalid JSON, schedule `Octo pr list`. Notify only when both Octo commands fail.

```lua
vim.system({ "gh", "pr", "view", "--json", "number" }, { text = true }, function(result)
  local number = M.parse_pr(result.stdout)
  vim.schedule(function()
    vim.cmd(number and ("Octo pr edit " .. number) or "Octo pr list")
  end)
end)
```

- [ ] **Step 4: Replace Octo's global mappings with review-local mappings**

Set `mappings_disable_default = true`. Remove all existing `<leader>o...` keys. Configure the same action keys on `review_diff`, `review_thread`, and `file_panel` where the action exists:

```lua
mappings = {
  pull_request = {
    review_start = { lhs = "r", desc = "Start review" },
    review_resume = { lhs = "R", desc = "Resume pending review" },
  },
  review_diff = {
    add_review_comment = { lhs = "c", mode = { "x" }, desc = "Add pending comment" },
    add_review_suggestion = { lhs = "s", mode = { "x" }, desc = "Add pending suggestion" },
    next_thread = { lhs = "]c", desc = "Next comment" },
    prev_thread = { lhs = "[c", desc = "Previous comment" },
    submit_review = { lhs = "S", desc = "Submit review" },
    close_review_tab = { lhs = "q", desc = "Close review" },
  },
  file_panel = {
    select_entry = { lhs = "<CR>", desc = "Open changed file" },
    submit_review = { lhs = "S", desc = "Submit review" },
    close_review_tab = { lhs = "q", desc = "Close review" },
  },
  review_thread = {
    next_comment = { lhs = "]c", desc = "Next comment" },
    prev_comment = { lhs = "[c", desc = "Previous comment" },
    close_review_tab = { lhs = "q", desc = "Close review" },
  },
  submit_win = {
    approve_review = { lhs = "a", mode = "n", desc = "Approve" },
    comment_review = { lhs = "c", mode = "n", desc = "Comment" },
    request_changes = { lhs = "r", mode = "n", desc = "Request changes" },
    close_review_tab = { lhs = "q", mode = "n", desc = "Cancel submit" },
  },
}
```

Keep the submit window choices for Comment, Approve, and Request changes, but expose them only inside the submit window.

- [ ] **Step 5: Keep Explorer visible in Octo review tabs**

Listen for `FileType octo_panel`, schedule `workspace.ensure_explorer({ focus = false })`, and restore focus to the Octo window after Explorer opens. Add an `opts.focus` path to `workspace.ensure_explorer` that never steals focus when false.

Octo closes its review tab on `q`, so the previous tab's Editor Group and Utility Dock layout remains intact without serializing buffers.

- [ ] **Step 6: Add the single PR entry mapping**

```lua
vim.keymap.set("n", "<leader>p", require("user.pr_review").open, { desc = "Pull request" })
```

Review start and resume remain buffer-local actions in the PR overview. Do not add global keys for PR creation, checkout, merge, ready, issues, reactions, or labels.

- [ ] **Step 7: Run tests and formatting**

```bash
cd /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow
nvim --headless -u NONE -l tests/nvim/run.lua
/Users/kosui/.local/share/nvim/mason/bin/stylua --check dot_config/nvim/lua
```

Expected: PR JSON parsing and all earlier Lua specs pass.

- [ ] **Step 8: Commit the focused review workflow**

```bash
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow add \
  dot_config/nvim/lua/user/pr_review.lua \
  dot_config/nvim/lua/user/workspace.lua \
  dot_config/nvim/lua/config/keymaps.lua \
  dot_config/nvim/lua/plugins/octo.lua \
  tests/nvim/pr_review_spec.lua
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow commit \
  -m "feat(nvim): OctoのPRレビュー操作を画面内へ限定"
```

### Task 6: Documentation, Deployment, and End-to-End Verification

**Files:**
- Modify: `docs/vim-cheatsheet.md`
- Verify: all files changed by Tasks 1-5

**Interfaces:**
- Consumes: all public mappings and workflows defined in Tasks 1-5
- Produces: deployed chezmoi targets and a concise user-facing cheat sheet

- [ ] **Step 1: Rewrite the cheat sheet around the three-zone model**

Keep only these sections:

1. Explorer、Editor Group、Utility Dockの役割
2. `<C-h/j/k/l>`による移動
3. Global keys from the allowlist
4. Explorer-local `a/r/m/d/c/p/v/s/?`
5. AI Dock-local provider switch and resume
6. PR review-local comment, suggestion, navigation, submit, close
7. `K`、`gd`、`gr`、`[d`、`]d`、`<leader>ca`、`<leader>cr`

Document both file-cycle key pairs:

```text
次のファイル: <C-Tab> / <leader>bn
前のファイル: <C-S-Tab> / <leader>bp
```

- [ ] **Step 2: Run the complete automated verification**

```bash
cd /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow
bun test tests/branch-guard-lib.test.ts tests/worktree-activity.test.ts
nvim --headless -u NONE -l tests/nvim/run.lua
/Users/kosui/.local/share/nvim/mason/bin/stylua --check dot_config/nvim/lua
nvim --headless -u /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow/dot_config/nvim/init.lua "+qa"
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow diff --check
```

Expected: all tests pass, StyLua exits 0, Neovim exits 0, and Git reports no whitespace errors.

- [ ] **Step 3: Inspect the exact chezmoi deployment diff**

```bash
chezmoi diff -S /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow \
  /Users/kosui/.config/nvim \
  /Users/kosui/.local/bin/worktree-activity \
  /Users/kosui/.local/lib/worktree-activity.ts \
  /Users/kosui/.claude/hooks/session-init.ts \
  /Users/kosui/.codex/hooks/session-init.ts
```

Expected: only the Neovim configuration, activity CLI/library, and two session hooks change.

- [ ] **Step 4: Commit the cheat sheet**

```bash
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow add docs/vim-cheatsheet.md
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow commit \
  -m "docs(nvim): 厳選した画面操作とレビュー手順を整理"
```

- [ ] **Step 5: Apply only the reviewed targets**

```bash
chezmoi apply -S /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow \
  /Users/kosui/.config/nvim \
  /Users/kosui/.local/bin/worktree-activity \
  /Users/kosui/.local/lib/worktree-activity.ts \
  /Users/kosui/.claude/hooks/session-init.ts \
  /Users/kosui/.codex/hooks/session-init.ts
```

- [ ] **Step 6: Run the manual smoke test in cmux**

Verify each result in order:

1. `nvim` opens Explorer on the left without moving focus away from the editor, and Explorer follows the current file.
2. Two vertical Editor Groups remain usable while Explorer width stays fixed; restarting the same worktree restores its folder expansion state.
3. `<C-h/j/k/l>` crosses Explorer, both Editor Groups, and Utility Dock.
4. `<C-p>` and `<leader>f` open file search.
5. `<C-S-f>` and `<leader>s` open project search.
6. `<leader>r` opens Grug-far.
7. `<C-Tab>` and `<leader>bn` move to the same next file; the previous-file pair behaves symmetrically.
8. Explorer create, move, rename, trash, copy, paste, and split-open operations work.
9. A committed branch change colors the filename; an unstaged edit adds a separate right-side marker.
10. `<leader>w` sorts current, recent activity, then inactive worktrees and selects an existing cmux workspace without changing cwd.
11. `<leader>a` switches Claude Code and Codex in one right-side Dock; current-file and Visual selection send work for both.
12. `<leader>p` opens the current PR or the PR list.
13. Octo review keeps Explorer visible, adds at least two pending comments, and sends them only after `S`.
14. `K` shows type information and waiting on a symbol does not open hover automatically.

- [ ] **Step 7: Confirm the final repository state**

```bash
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow status --short
git -C /Users/kosui/.local/share/chezmoi/.wt/feat/nvim-vscode-workflow log --oneline -8
```

Expected: no tracked changes remain. Local `.Codex/` and `.superpowers/` directories may remain untracked and must not be added to a commit.

## References

- Design: `docs/superpowers/specs/2026-08-09-nvim-vscode-workflow-design.md`
- cmux CLI contract: <https://raw.githubusercontent.com/manaflow-ai/cmux/main/docs/cli-contract.md>
- Installed Snacks terminal documentation: `/Users/kosui/.local/share/nvim/lazy/snacks.nvim/docs/terminal.md`
- Installed Snacks lazygit documentation: `/Users/kosui/.local/share/nvim/lazy/snacks.nvim/docs/lazygit.md`
- Installed Octo review documentation: `/Users/kosui/.local/share/nvim/lazy/octo.nvim/README.md`
