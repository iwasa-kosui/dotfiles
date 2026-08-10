# Neovim Base Branch Diff Tree Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snacks Explorerの下へ折りたためるbase差分ツリーを常設し、選択したファイルをbase版と作業ツリーの2画面diffで確認できるようにします。

**Architecture:** `user.base_diff`がworktree単位の差分snapshotを非同期で更新します。`user.base_diff_tree`はsnapshotをディレクトリツリーへ変換し、Explorer直下のscratch bufferへ描画します。`user.base_diff_view`は中央のEditor GroupでNeovim標準diffを開き、`user.workspace`がExplorer、差分パネル、Editor Groupのwindowを調整します。

**Tech Stack:** Lua、Neovim API、`vim.system`、Snacks Explorer、Git、既存のheadless Lua test runner、StyLua、chezmoi

## Global Constraints

- すべての作業は`/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel`で行います。
- baseブランチはPRのbase、`origin/HEAD`、`origin/main`、`origin/master`の順で自動解決します。
- baseブランチの手動切替は追加しません。
- 追加、変更、改名、削除を`A/M/R/D`として表示します。
- 2画面diffにはDiffviewのtabを使わず、Neovim標準のdiff windowを使います。
- 状態は`stdpath("state") .. "/base-diff-tree.json"`へworktree単位で保存します。
- 新しい外部プラグインやLua依存は追加しません。
- 既存Explorerのbase差分色と右端の未commit状態を維持します。
- 各実装コミットの前に対象specと`git diff --check`を実行します。

---

## File Map

- `dot_config/nvim/lua/user/base_diff.lua`: base解決、Git出力解析、snapshot、購読通知を担当します。
- `dot_config/nvim/lua/user/base_diff_state.lua`: パネル全体の開閉、高さ、開いたディレクトリを永続化します。
- `dot_config/nvim/lua/user/base_diff_tree.lua`: ツリー構築、行描画、パネルwindow、buffer-local操作を担当します。
- `dot_config/nvim/lua/user/base_diff_view.lua`: ファイル単位の左右buffer計画とdiff windowの再利用を担当します。
- `dot_config/nvim/lua/user/workspace.lua`: Explorerと差分パネルを関連付け、最後に使ったEditor Groupを記録します。
- `dot_config/nvim/lua/config/autocmds.lua`: 通常のEditor Groupへ入った時刻をworkspaceへ通知します。
- `tests/nvim/base_diff_spec.lua`: Git出力解析とsnapshot公開APIを検証します。
- `tests/nvim/base_diff_refresh_spec.lua`: 非同期更新、失敗時のsnapshot維持、購読通知を検証します。
- `tests/nvim/base_diff_state_spec.lua`: worktree別の状態保存と入力正規化を検証します。
- `tests/nvim/base_diff_tree_spec.lua`: ツリー構築、描画、パネル操作を検証します。
- `tests/nvim/base_diff_view_spec.lua`: `A/M/R/D`の左右buffer計画、window再利用、cleanupを検証します。
- `tests/nvim/workspace_spec.lua`: Explorer作成後のパネル配置とEditor Group選択を検証します。
- `docs/vim-cheatsheet.md`: 差分パネルの表示とbuffer-local操作を追記します。

---

### Task 1: base差分snapshotと更新通知

**Files:**
- Modify: `dot_config/nvim/lua/user/base_diff.lua:4-237`
- Modify: `tests/nvim/base_diff_spec.lua:1-46`
- Modify: `tests/nvim/base_diff_refresh_spec.lua:1-41`

**Interfaces:**
- Produces: `BaseDiffChange = { status: "A"|"M"|"R"|"D", path: string, old_path?: string }`
- Produces: `BaseDiffSnapshot = { cwd: string, base_ref: string, base_name: string, merge_base: string, changes: BaseDiffChange[], statuses: table<string, string> }`
- Produces: `require("user.base_diff").parse_name_status_z(output) -> BaseDiffChange[]`
- Produces: `require("user.base_diff").snapshot(cwd) -> BaseDiffSnapshot?`
- Produces: `require("user.base_diff").error(cwd) -> string?`
- Produces: `require("user.base_diff").subscribe(cwd, callback) -> unsubscribe`
- Changes: `refresh(cwd, callback?, adapter?)` invokes `callback(success, snapshot, error)` without breaking callers that only read `success`.

- [ ] **Step 1: Replace the parser expectation with a quote-safe detailed change list**

Update `tests/nvim/base_diff_spec.lua` with this assertion. Keep the existing porcelain and base-candidate assertions.

```lua
t.eq({
	{ status = "A", path = "lua/new file.lua" },
	{ status = "M", path = "lua/edit.lua" },
	{ status = "R", path = "lua/moved.lua", old_path = "lua/old.lua" },
	{ status = "D", path = "lua/gone.lua" },
}, diff.parse_name_status_z(table.concat({
	"A",
	"lua/new file.lua",
	"M",
	"lua/edit.lua",
	"R100",
	"lua/old.lua",
	"lua/moved.lua",
	"D",
	"lua/gone.lua",
	"",
}, "\0")))
```

- [ ] **Step 2: Run the parser spec and verify the new API is missing**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: FAIL with `attempt to call field 'parse_name_status_z'`.

- [ ] **Step 3: Implement NUL-delimited name-status parsing**

Add the `BaseDiffChange` annotation and parser to `base_diff.lua`. Change the Git command to include `-z` and pass `diff_result.stdout` directly to this parser.

```lua
---@class BaseDiffChange
---@field status "A"|"M"|"R"|"D"
---@field path string
---@field old_path? string

function M.parse_name_status_z(output)
  local records = vim.split(output or "", "\0", { plain = true })
  local changes = {}
  local index = 1
  while index <= #records do
    local raw = records[index]
    local status = raw:sub(1, 1)
    if raw == "" then
      break
    end
    if status == "R" then
      changes[#changes + 1] = {
        status = "R",
        old_path = records[index + 1],
        path = records[index + 2],
      }
      index = index + 3
    elseif vim.tbl_contains({ "A", "M", "D" }, status) then
      changes[#changes + 1] = { status = status, path = records[index + 1] }
      index = index + 2
    else
      index = index + 1
    end
  end
  return changes
end
```

Use this exact command in `refresh`:

```lua
{ "git", "diff", "--name-status", "-z", "--find-renames", merge_base }
```

- [ ] **Step 4: Run the parser spec and verify it passes**

Run the command from Step 2.

Expected: PASS with exit code 0.

- [ ] **Step 5: Add snapshot and subscription assertions to the refresh spec**

Extend the successful response sequence in `tests/nvim/base_diff_refresh_spec.lua`. Return NUL-delimited diff output and an untracked file, then assert the published snapshot.

```lua
respond(5, { code = 0, stdout = "M\0edit.lua\0D\0gone.lua\0" })
respond(6, { code = 0, stdout = "?? new.lua\0" })

local snapshot = diff.snapshot("/canonical/worktree")
t.eq("origin/main", snapshot.base_ref)
t.eq("main", snapshot.base_name)
t.eq("base", snapshot.merge_base)
t.eq({
	{ status = "M", path = "edit.lua" },
	{ status = "D", path = "gone.lua" },
	{ status = "A", path = "new.lua" },
}, snapshot.changes)
t.eq("M", diff.status("/canonical/worktree/edit.lua"))
t.eq(nil, diff.status("/canonical/worktree/gone.lua"))
```

Add a subscriber before the successful refresh and verify it receives the same snapshot and no error.

```lua
local published = {}
local unsubscribe = diff.subscribe("/canonical/worktree", function(value, err)
	published[#published + 1] = { value = value, err = err }
end)

t.truthy(vim.wait(100, function()
	return #published == 1
end))
t.eq(1, #published)
t.eq(snapshot, published[1].value)
t.eq(nil, published[1].err)
unsubscribe()
```

Add a third refresh whose `gh`, symbolic-ref, and every merge-base candidate fail. Use a synchronous fake runner so every candidate is exhausted in one test.

```lua
local failed
diff.refresh("/canonical/worktree", function(success, value, err)
	failed = { success = success, value = value, err = err }
end, {
	root = function()
		return "/canonical/worktree"
	end,
	run = function(command, _, callback)
		if command[1] == "gh" or command[2] == "symbolic-ref" or command[2] == "merge-base" then
			callback({ code = 1, stdout = "", stderr = "not found" })
		end
	end,
})

t.truthy(vim.wait(100, function()
	return failed ~= nil
end))
t.eq(false, failed.success)
t.eq(snapshot, failed.value)
t.truthy(type(failed.err) == "string" and failed.err ~= "")
t.eq(snapshot, diff.snapshot("/canonical/worktree"))
t.eq(failed.err, diff.error("/canonical/worktree"))
```

- [ ] **Step 6: Run the refresh spec and verify snapshot APIs are missing**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_refresh_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: FAIL because `snapshot` or `subscribe` is undefined.

- [ ] **Step 7: Replace the status cache with an atomic snapshot cache**

Add these module-level stores and public functions.

```lua
local snapshots = {}
local errors = {}
local subscribers = {}

function M.snapshot(cwd)
  return snapshots[worktree_root.resolve(cwd)]
end

function M.error(cwd)
  return errors[worktree_root.resolve(cwd)]
end

function M.subscribe(cwd, callback)
  cwd = worktree_root.resolve(cwd)
  subscribers[cwd] = subscribers[cwd] or {}
  subscribers[cwd][callback] = true
  return function()
    if subscribers[cwd] then
      subscribers[cwd][callback] = nil
    end
  end
end

local function publish(cwd, snapshot, err)
  for callback in pairs(subscribers[cwd] or {}) do
    vim.schedule(function()
      callback(snapshot, err)
    end)
  end
end
```

Build one snapshot only after both Git commands succeed. Merge untracked paths that do not already exist, sort by `path`, and build `statuses` with normalized absolute paths for `A/M/R`. Do not add `D` to `statuses` because deleted files have no Explorer node.

```lua
local snapshot = {
  cwd = cwd,
  base_ref = base,
  base_name = base:gsub("^origin/", ""),
  merge_base = merge_base,
  changes = changes,
  statuses = statuses,
}
snapshots[cwd] = snapshot
errors[cwd] = nil
publish(cwd, snapshot, nil)
finish(true, snapshot, nil)
```

On failure, set `errors[cwd]`, publish the last successful snapshot with the error, and call `finish(false, snapshots[cwd], err)`. Keep the generation check before every mutation and callback. Update `complete` and `finish` to forward all three values.

Change `status(path)` to search `snapshot.statuses` instead of the removed map cache.

Allow manual refreshes to surface the current error without changing automatic callers:

```lua
function M.refresh_and_render(cwd, opts)
  opts = opts or {}
  M.refresh(cwd, function(success, _, err)
    if success then
      M.refresh_explorers(cwd)
    elseif opts.notify and err then
      vim.notify("Base diff refresh failed: " .. err, vim.log.levels.WARN)
    end
  end)
end
```

- [ ] **Step 8: Run both base-diff specs**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_refresh_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: both commands pass. The existing stale-generation assertion must still report only the newest callback.

- [ ] **Step 9: Format, inspect, and commit the snapshot change**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && /Users/kosui/.local/share/nvim/mason/bin/stylua dot_config/nvim/lua/user/base_diff.lua tests/nvim/base_diff_spec.lua tests/nvim/base_diff_refresh_spec.lua
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" diff --check
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" add dot_config/nvim/lua/user/base_diff.lua tests/nvim/base_diff_spec.lua tests/nvim/base_diff_refresh_spec.lua
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" commit -m "feat(nvim): base差分をworktree単位のsnapshotとして公開"
```

---

### Task 2: 状態保存と差分ツリーモデル

**Files:**
- Create: `dot_config/nvim/lua/user/base_diff_state.lua`
- Create: `dot_config/nvim/lua/user/base_diff_tree.lua`
- Create: `tests/nvim/base_diff_state_spec.lua`
- Create: `tests/nvim/base_diff_tree_spec.lua`

**Interfaces:**
- Consumes: `BaseDiffSnapshot` and `BaseDiffChange` from Task 1.
- Produces: `base_diff_state.load(root, adapter?) -> { collapsed: boolean, height: integer?, open_dirs: string[] }`
- Produces: `base_diff_state.save(root, value, adapter?)`
- Produces: `base_diff_tree.build(changes) -> BaseDiffTreeNode`
- Produces: `base_diff_tree.render(snapshot, state, error?) -> { lines: string[], items: table<integer, BaseDiffTreeNode>, valid_open_dirs: string[] }`

- [ ] **Step 1: Write the failing state persistence spec**

Create `tests/nvim/base_diff_state_spec.lua`.

```lua
local t = require("testlib")
local state = require("user.base_diff_state")

local state_dir = vim.fn.tempname()
vim.fn.mkdir(state_dir, "p")
local adapter = {
	path = state_dir .. "/base-diff-tree.json",
	realpath = function(path)
		return path == "/repo-link" and "/repo" or path
	end,
}

state.save("/repo-link", {
	collapsed = true,
	height = 14,
	open_dirs = { "lua/user", "lua", "lua", "../outside" },
}, adapter)

t.eq({
	collapsed = true,
	height = 14,
	open_dirs = { "lua", "lua/user" },
}, state.load("/repo", adapter))
t.eq({ collapsed = false, height = nil, open_dirs = {} }, state.load("/other", adapter))

vim.fn.delete(state_dir, "rf")
```

- [ ] **Step 2: Run the state spec and verify the module is missing**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_state_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: FAIL with `module 'user.base_diff_state' not found`.

- [ ] **Step 3: Implement normalized worktree-specific state storage**

Create `base_diff_state.lua` using the same read, decode, write, and realpath adapter pattern as `user.explorer_state`. Use these normalization rules:

```lua
local function default_state()
  return { collapsed = false, height = nil, open_dirs = {} }
end

local function normalize_dir(path)
  path = vim.fs.normalize(path or "")
  if path == "." or path == "" or path:sub(1, 1) == "/" or path:match("^%.%./") then
    return nil
  end
  return path
end
```

Keep a positive integer `height` only when it is at least 4. Deduplicate and sort `open_dirs`. Store the normalized worktree root as the top-level JSON key. The default file path is:

```lua
vim.fn.stdpath("state") .. "/base-diff-tree.json"
```

- [ ] **Step 4: Run the state spec and verify it passes**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Write the failing tree build and render spec**

Create `tests/nvim/base_diff_tree_spec.lua` with a snapshot containing modified, added, renamed, and deleted files.

```lua
local t = require("testlib")
local tree = require("user.base_diff_tree")

local snapshot = {
	cwd = "/repo",
	base_ref = "origin/main",
	base_name = "main",
	merge_base = "abc123",
	changes = {
		{ status = "M", path = "lua/user/base_diff.lua" },
		{ status = "A", path = "lua/user/base_diff_tree.lua" },
		{ status = "R", path = "tests/new_spec.lua", old_path = "tests/old_spec.lua" },
		{ status = "D", path = "docs/old.md" },
	},
}

local rendered = tree.render(snapshot, {
	collapsed = false,
	height = 12,
	open_dirs = { "lua", "lua/user", "tests" },
})

t.eq({
	"⌄ BASE CHANGES · main · 4",
	"  ▸ docs",
	"  ⌄ lua",
	"    ⌄ user",
	"      M base_diff.lua",
	"      A base_diff_tree.lua",
	"  ⌄ tests",
	"      R new_spec.lua ← old_spec.lua",
}, rendered.lines)
t.eq("lua/user/base_diff.lua", rendered.items[5].path)
t.eq({ "docs", "lua", "lua/user", "tests" }, rendered.valid_open_dirs)

local collapsed = tree.render(snapshot, { collapsed = true, height = 12, open_dirs = {} })
t.eq({ "▸ BASE CHANGES · main · 4" }, collapsed.lines)

local empty = tree.render({ cwd = "/repo", base_name = "main", changes = {} }, {
	collapsed = false,
	height = 8,
	open_dirs = {},
})
t.eq({ "⌄ BASE CHANGES · main · 0", "  No base changes" }, empty.lines)

local unavailable = tree.render(nil, { collapsed = false, height = 8, open_dirs = {} }, "no merge base")
t.eq({ "⌄ BASE CHANGES · unavailable", "  no merge base" }, unavailable.lines)

local stale = tree.render(snapshot, {
	collapsed = false,
	height = 8,
	open_dirs = {},
}, "refresh failed")
t.eq("⌄ BASE CHANGES · main · 4 !", stale.lines[1])
```

- [ ] **Step 6: Run the tree spec and verify the module is missing**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_tree_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: FAIL with `module 'user.base_diff_tree' not found`.

- [ ] **Step 7: Implement deterministic tree construction and rendering**

Create `base_diff_tree.lua` with these node fields:

```lua
---@class BaseDiffTreeNode
---@field kind "root"|"header"|"directory"|"file"
---@field name string
---@field path string
---@field children? BaseDiffTreeNode[]
---@field status? "A"|"M"|"R"|"D"
---@field old_path? string
---@field change? BaseDiffChange
```

`build(changes)` must create directory nodes for every parent segment, attach file nodes at the final segment, and sort children with directories first and names ascending. `render` must:

1. Add the header and map line 1 to a `{ kind = "header" }` item.
2. Stop after the header when `state.collapsed` is true.
3. Traverse only directories present in `state.open_dirs`.
4. Add `← <old filename>` for renamed files.
5. Return every existing directory path in `valid_open_dirs`, including closed directories.
6. Add `No base changes` for an empty snapshot.
7. Render `BASE CHANGES · unavailable` and a short error line when snapshot is nil.
8. Add ` !` to a normal header when an error accompanies a last successful snapshot.

Use a set created from `state.open_dirs` for traversal. Keep rendering pure; do not create buffers or windows in this task.

- [ ] **Step 8: Run the state and tree specs**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_state_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_tree_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: both commands pass.

- [ ] **Step 9: Format, inspect, and commit the model change**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && /Users/kosui/.local/share/nvim/mason/bin/stylua dot_config/nvim/lua/user/base_diff_state.lua dot_config/nvim/lua/user/base_diff_tree.lua tests/nvim/base_diff_state_spec.lua tests/nvim/base_diff_tree_spec.lua
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" diff --check
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" add dot_config/nvim/lua/user/base_diff_state.lua dot_config/nvim/lua/user/base_diff_tree.lua tests/nvim/base_diff_state_spec.lua tests/nvim/base_diff_tree_spec.lua
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" commit -m "feat(nvim): base差分のツリー表現と表示状態を追加"
```

---

### Task 3: ファイル単位の2画面diff

**Files:**
- Create: `dot_config/nvim/lua/user/base_diff_view.lua`
- Create: `tests/nvim/base_diff_view_spec.lua`

**Interfaces:**
- Consumes: `BaseDiffSnapshot` and `BaseDiffChange` from Task 1.
- Produces: `base_diff_view.plan(snapshot, change) -> BaseDiffViewPlan`
- Produces: `base_diff_view.new(adapter?) -> BaseDiffViewController`
- Produces: `controller:open(snapshot, change, target_win, callback?)`
- Produces: `controller:on_win_closed(win)`
- Produces: `controller:close()`
- Produces: `controller:pair() -> { left: integer, right: integer }?`

- [ ] **Step 1: Write failing plan assertions for every Git status**

Create `tests/nvim/base_diff_view_spec.lua` and assert these exact plans.

```lua
local t = require("testlib")
local view = require("user.base_diff_view")

local snapshot = { cwd = "/repo", merge_base = "abc123" }

t.eq({
	left = { kind = "empty", label = "base: new.lua" },
	right = { kind = "file", path = "/repo/new.lua" },
	pathspecs = { "new.lua" },
}, view.plan(snapshot, { status = "A", path = "new.lua" }))

t.eq({
	left = { kind = "git", rev = "abc123", path = "edit.lua" },
	right = { kind = "file", path = "/repo/edit.lua" },
	pathspecs = { "edit.lua" },
}, view.plan(snapshot, { status = "M", path = "edit.lua" }))

t.eq({
	left = { kind = "git", rev = "abc123", path = "old.lua" },
	right = { kind = "file", path = "/repo/new.lua" },
	pathspecs = { "old.lua", "new.lua" },
}, view.plan(snapshot, { status = "R", path = "new.lua", old_path = "old.lua" }))

t.eq({
	left = { kind = "git", rev = "abc123", path = "gone.lua" },
	right = { kind = "empty", label = "worktree: gone.lua" },
	pathspecs = { "gone.lua" },
}, view.plan(snapshot, { status = "D", path = "gone.lua" }))
```

- [ ] **Step 2: Run the view spec and verify the module is missing**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_view_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: FAIL with `module 'user.base_diff_view' not found`.

- [ ] **Step 3: Implement the pure buffer plan**

Create `base_diff_view.lua` and implement `plan` with explicit branches for `A/M/R/D`. Join working-tree paths with `snapshot.cwd .. "/" .. change.path`. Raise an error for a status outside the four accepted values so corrupt snapshots cannot create arbitrary buffers.

```lua
function M.plan(snapshot, change)
  local right = { kind = "file", path = vim.fs.normalize(snapshot.cwd .. "/" .. change.path) }
  local left = { kind = "git", rev = snapshot.merge_base, path = change.old_path or change.path }
  local pathspecs = change.old_path and { change.old_path, change.path } or { change.path }
  if change.status == "A" then
    left = { kind = "empty", label = "base: " .. change.path }
  elseif change.status == "D" then
    right = { kind = "empty", label = "worktree: " .. change.path }
  elseif change.status ~= "M" and change.status ~= "R" then
    error("unsupported base diff status: " .. tostring(change.status))
  end
  return { left = left, right = right, pathspecs = pathspecs }
end
```

- [ ] **Step 4: Run the plan assertions and verify they pass**

Run the command from Step 2.

Expected: PASS for the pure plan assertions.

- [ ] **Step 5: Add failing controller assertions for binary detection, reuse, and cleanup**

Append a fake adapter to `base_diff_view_spec.lua`.

```lua
local calls = {}
local cleared = {}
local pair = { left = 10, right = 11 }
local adapter = {
	check_binary = function(_, _, _, callback)
		callback(false, nil)
	end,
	load_git = function(source, _, callback)
		calls[#calls + 1] = { kind = "load", source = source }
		callback({ "base line" }, nil)
	end,
	show = function(plan, left_lines, target_win, previous)
		calls[#calls + 1] = {
			kind = "show",
			plan = plan,
			left_lines = left_lines,
			target_win = target_win,
			previous = previous,
		}
		return pair
	end,
	valid_pair = function(value)
		return value == pair
	end,
	clear_diff = function(win)
		cleared[#cleared + 1] = win
	end,
	notify = function(message)
		calls[#calls + 1] = { kind = "notify", message = message }
	end,
}

local controller = view.new(adapter)
controller:open({ cwd = "/repo", merge_base = "abc123" }, { status = "M", path = "edit.lua" }, 20)
controller:open({ cwd = "/repo", merge_base = "abc123" }, { status = "A", path = "new.lua" }, 20)
t.eq(pair, calls[#calls].previous)

controller:on_win_closed(10)
t.eq({ 11 }, cleared)
t.eq(nil, controller:pair())
```

Add a second adapter whose `check_binary` callback returns `true`.

```lua
local binary_show_count = 0
local binary_message
local binary_controller = view.new({
	check_binary = function(_, _, _, callback)
		callback(true, nil)
	end,
	load_git = function(_, _, callback)
		callback({ "ignored" }, nil)
	end,
	show = function()
		binary_show_count = binary_show_count + 1
	end,
	valid_pair = function()
		return false
	end,
	clear_diff = function() end,
	notify = function(message)
		binary_message = message
	end,
})
binary_controller:open(snapshot, { status = "A", path = "image.bin" }, 20)
t.eq(0, binary_show_count)
t.truthy(binary_message:find("LazyGit", 1, true) ~= nil)

local load_error_message
local load_error_controller = view.new({
	check_binary = function(_, _, _, callback)
		callback(false, nil)
	end,
	load_git = function(_, _, callback)
		callback(nil, "base blob not found")
	end,
	show = function()
		error("show must not run after a blob load failure")
	end,
	valid_pair = function()
		return false
	end,
	clear_diff = function() end,
	notify = function(message)
		load_error_message = message
	end,
})
load_error_controller:open(snapshot, { status = "D", path = "gone.lua" }, 20)
t.truthy(load_error_message:find("base blob not found", 1, true) ~= nil)
```

- [ ] **Step 6: Run the controller spec and verify `new` is missing**

Run the command from Step 2.

Expected: FAIL because `view.new` is undefined.

- [ ] **Step 7: Implement the controller and default Neovim adapter**

Implement `Controller` with one `self._pair`. `open` must:

1. Build the plan.
2. Call `check_binary(snapshot, change, plan, callback)`.
3. Notify and stop when binary detection returns an error.
4. Notify and stop when the result is binary.
5. Load the left Git blob only for `left.kind == "git"`.
6. Notify and stop when blob loading returns an error.
7. Call `show(plan, left_lines, target_win, reusable_pair)`.
8. Save the returned pair and invoke the optional callback.

For `M/R/D`, the default `check_binary` runs this argv with `vim.system` and treats any numstat line beginning with `-\t-\t` as binary:

```lua
vim.list_extend({ "git", "diff", "--numstat", snapshot.merge_base, "--" }, pathspecs)
```

For `A`, use `git diff --no-index --numstat -- /dev/null <absolute-path>`. Exit code 1 means a normal difference and must not be treated as an execution failure. This path also detects an untracked binary file that does not appear in `git diff <merge-base>`.

`check_binary` invokes `callback(is_binary, error)`. For the regular command, a non-zero exit invokes `callback(false, stderr)`; for `--no-index`, only exit codes other than 0 and 1 are errors. `load_git` invokes `callback(lines, error)` and forwards `git show` failures without creating windows.

The default `load_git` runs:

```lua
{ "git", "show", source.rev .. ":" .. source.path }
```

The default `show` must execute on `vim.schedule`. Reuse valid windows when supplied. Otherwise call `vim.api.nvim_win_call(target_win, function() vim.cmd("leftabove vsplit") end)` to create the left window and use the original target as the right window. Populate a named `nofile` buffer for Git or empty sources, open a normal file buffer for `right.kind == "file"`, run `diffthis` in both windows, and install buffer-local `q` mappings that call `controller:close()`.

`on_win_closed(win)` must clear diff mode from the surviving valid window, remove the temporary buffer-local `q` mapping from surviving real-file buffers, and set `self._pair = nil`. `close()` removes both temporary mappings and closes only the managed windows, preserving listed file buffers.

- [ ] **Step 8: Run the view spec and full base-diff tests**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_view_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_refresh_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: all commands pass.

- [ ] **Step 9: Format, inspect, and commit the diff view**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && /Users/kosui/.local/share/nvim/mason/bin/stylua dot_config/nvim/lua/user/base_diff_view.lua tests/nvim/base_diff_view_spec.lua
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" diff --check
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" add dot_config/nvim/lua/user/base_diff_view.lua tests/nvim/base_diff_view_spec.lua
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" commit -m "feat(nvim): baseと作業ツリーの再利用可能なdiff表示を追加"
```

---

### Task 4: Explorer下部の差分パネル

**Files:**
- Modify: `dot_config/nvim/lua/user/base_diff_tree.lua`
- Modify: `tests/nvim/base_diff_tree_spec.lua`

**Interfaces:**
- Consumes: `base_diff.snapshot/error/subscribe` from Task 1.
- Consumes: `base_diff_state.load/save` from Task 2.
- Consumes: `base_diff_view.new` from Task 3.
- Produces: `base_diff_tree.new(adapter?) -> BaseDiffTreeController`
- Produces: `controller:ensure({ cwd, explorer_win, editor_win }) -> panel_win?`
- Produces: `controller:update(snapshot, error)`
- Produces: `controller:activate(line, action)` where action is `"default"|"open"|"close"|"expand"`.
- Produces: `controller:close()`.
- Produces: module-level `base_diff_tree.ensure(opts)` and `base_diff_tree.close(cwd)` backed by one controller per worktree.

- [ ] **Step 1: Add failing controller assertions to the tree spec**

Append a fake panel adapter to `tests/nvim/base_diff_tree_spec.lua`.

```lua
local saved
local created = 0
local heights = {}
local opened
local fake_view = {
	open = function(_, snapshot_value, change, target)
		opened = { snapshot = snapshot_value, change = change, target = target }
	end,
}
local adapter = {
	load_state = function()
		return { collapsed = false, height = 10, open_dirs = { "lua", "lua/user" } }
	end,
	save_state = function(_, value)
		saved = vim.deepcopy(value)
	end,
	create_panel = function(_, _, height)
		created = created + 1
		heights[#heights + 1] = height
		return 31, 41
	end,
	valid_win = function(win)
		return win == 31
	end,
	available_height = function()
		return 24
	end,
	set_height = function(_, height)
		heights[#heights + 1] = height
	end,
	render_buffer = function(_, value)
		adapter.last_render = value
	end,
	set_keymaps = function() end,
	close_win = function() end,
	current_diff = function()
		return nil, nil
	end,
	subscribe_diff = function()
		return function() end
	end,
	refresh_diff = function() end,
	open_file = function(path, target, callback)
		adapter.opened_file = { path = path, target = target }
		callback(true)
	end,
	notify = function(message)
		adapter.notification = message
	end,
	view = fake_view,
}

local controller = tree.new(adapter)
controller:ensure({ cwd = "/repo", explorer_win = 30, editor_win = function() return 50 end })
controller:ensure({ cwd = "/repo", explorer_win = 30, editor_win = function() return 50 end })
t.eq(1, created, "ensure must reuse the existing panel")

controller:update(snapshot)
controller:activate(1, "default")
t.eq(true, saved.collapsed)
t.eq(1, heights[#heights])
controller:activate(1, "default")
t.eq(false, saved.collapsed)
t.eq(10, heights[#heights])

controller:activate(5, "default")
t.eq("lua/user/base_diff.lua", opened.change.path)
t.eq(50, opened.target)

controller:activate(5, "open")
t.eq({ path = "/repo/lua/user/base_diff.lua", target = 50 }, adapter.opened_file)

controller:activate(4, "default")
t.eq({ "lua" }, saved.open_dirs)

controller:activate(2, "default")
controller:activate(3, "open")
t.eq("Deleted file can only be opened as a diff", adapter.notification)
```

- [ ] **Step 2: Run the tree spec and verify `new` is missing**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_tree_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: FAIL because `tree.new` is undefined.

- [ ] **Step 3: Implement the panel controller around the pure renderer**

Add `Controller` to `base_diff_tree.lua`. Store `cwd`, `explorer_win`, `panel_win`, `buf`, `editor_win`, `state`, `snapshot`, `error`, `rendered`, `unsubscribe`, and one `base_diff_view` controller.

`ensure(opts)` must:

1. Reuse a valid `panel_win`.
2. Load state once for `opts.cwd`.
3. Create a scratch buffer and a split below `opts.explorer_win`.
4. Use height 1 when collapsed, the saved height when present, otherwise half of the Explorer height.
5. Subscribe through `subscribe_diff(cwd, callback)` and immediately read `current_diff(cwd)` for the current snapshot and error.
6. Install keymaps once.

Before splitting, read `available_height(explorer_win)`. If it is less than 8, set `state.collapsed = true` and create a one-line panel so both sections retain usable rows.

Use these buffer options in the default adapter:

```lua
vim.bo[buf].buftype = "nofile"
vim.bo[buf].bufhidden = "wipe"
vim.bo[buf].swapfile = false
vim.bo[buf].modifiable = false
vim.bo[buf].filetype = "BaseDiffTree"
vim.bo[buf].buflisted = false
```

Create the split relative to the Explorer window:

```lua
local panel_win
vim.api.nvim_win_call(explorer_win, function()
  vim.cmd("belowright split")
  panel_win = vim.api.nvim_get_current_win()
end)
vim.api.nvim_win_set_buf(panel_win, buf)
vim.wo[panel_win].winfixwidth = true
```

`update(snapshot, error)` filters `state.open_dirs` against the new tree's `valid_open_dirs`, saves the state when pruning removed paths, calls the pure `render`, makes the buffer modifiable only while replacing lines, applies status highlights with extmarks, restores `modifiable=false`, and keeps the cursor on a valid line.

- [ ] **Step 4: Implement panel and tree actions**

`activate(line, action)` must follow this dispatch:

```lua
if action == "close" then
  self.state.collapsed = true
elseif action == "expand" then
  self.state.collapsed = false
elseif item.kind == "header" then
  self.state.collapsed = not self.state.collapsed
elseif item.kind == "directory" then
  toggle_open_dir(self.state.open_dirs, item.path)
elseif item.kind == "file" and action == "open" then
  if item.status == "D" then
    self.adapter.notify("Deleted file can only be opened as a diff")
  else
    self.adapter.open_file(self.cwd .. "/" .. item.path, self.editor_win(), function(opened)
      if not opened then
        self.adapter.notify("Base diff file no longer exists: " .. item.path)
        self.adapter.refresh_diff(self.cwd, false)
      end
    end)
  end
elseif item.kind == "file" then
  local target = self.editor_win()
  if target then
    self.view:open(self.snapshot, item.change, target)
  else
    self.adapter.notify("No Editor Group is available for the base diff")
  end
end
```

After a state mutation, filter `open_dirs` against `rendered.valid_open_dirs`, save state, resize to 1 or the saved expanded height, and rerender.

The default `open_file(path, target, callback)` checks `vim.uv.fs_stat(path)` and target-window validity. On success it calls `vim.api.nvim_win_call(target, function() vim.cmd.edit(vim.fn.fnameescape(path)) end)` and then `callback(true)`. On failure it calls `callback(false)` without changing the current window.

Install these buffer-local normal-mode mappings:

```lua
{
  ["<CR>"] = "default",
  ["<Space>"] = "default",
  o = "open",
  zc = "close",
  zo = "expand",
  R = "refresh",
  ["?"] = "help",
}
```

The default adapter implements `refresh_diff(cwd, notify)` as `base_diff.refresh_and_render(cwd, { notify = notify })`. `R` calls `refresh_diff(cwd, true)`. `?` shows a concise `vim.notify` message with these mappings.

Create one augroup for panel lifecycle events. On `WinResized`, compare `vim.v.event.windows` with the panel window, then save `nvim_win_get_height(panel_win)` when the panel is expanded and the height is at least 4. On `WinClosed`, parse `args.match` as a window ID. Closing `explorer_win` calls `controller:close()`. Closing either managed diff window calls `base_diff_view:on_win_closed(closed_win)`.

- [ ] **Step 5: Run the tree, state, and view specs**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_tree_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_state_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_view_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: all commands pass.

- [ ] **Step 6: Format, inspect, and commit the panel**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && /Users/kosui/.local/share/nvim/mason/bin/stylua dot_config/nvim/lua/user/base_diff_tree.lua tests/nvim/base_diff_tree_spec.lua
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" diff --check
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" add dot_config/nvim/lua/user/base_diff_tree.lua tests/nvim/base_diff_tree_spec.lua
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" commit -m "feat(nvim): Explorer下部へ折りたためるbase差分ツリーを追加"
```

---

### Task 5: workspaceへの配置とEditor Group追跡

**Files:**
- Modify: `dot_config/nvim/lua/user/workspace.lua:1-71`
- Modify: `dot_config/nvim/lua/config/autocmds.lua:1-8`
- Modify: `tests/nvim/workspace_spec.lua:1-88`

**Interfaces:**
- Consumes: `base_diff_tree.ensure({ cwd, explorer_win, editor_win })` from Task 4.
- Produces: `workspace.remember_editor(win?, adapter?) -> boolean`
- Produces: `workspace.editor_win(adapter?) -> integer?`
- Changes: `workspace.ensure_explorer` ensures one base-diff panel before starting the async refresh.

- [ ] **Step 1: Add failing workspace assertions for panel placement**

In `tests/nvim/workspace_spec.lua`, give the fake picker the window shape exposed by Snacks:

```lua
local picker = {
	list = { win = { win = 30 } },
	focus = function(_, target)
		focus_count = focus_count + 1
		focused = target
	end,
}
```

Add `ensure_base_diff` to the adapter and record its arguments.

```lua
local ensured_panels = {}
adapter.ensure_base_diff = function(opts)
	ensured_panels[#ensured_panels + 1] = opts
end
```

After the first `workspace.ensure_explorer`, assert:

```lua
t.eq(1, #ensured_panels)
t.eq("/workspace-repo", ensured_panels[1].cwd)
t.eq(30, ensured_panels[1].explorer_win)
t.truthy(type(ensured_panels[1].editor_win) == "function")
```

Also append a fake window adapter and assert only normal file windows are remembered.

```lua
local windows = {
	[40] = { valid = true, tab = 1, buftype = "", filetype = "lua", relative = "" },
	[41] = { valid = true, tab = 1, buftype = "nofile", filetype = "BaseDiffTree", relative = "" },
	[42] = { valid = true, tab = 1, buftype = "terminal", filetype = "", relative = "" },
}
local win_adapter = {
	current_win = function() return 40 end,
	current_tab = function() return 1 end,
	window_info = function(win) return windows[win] end,
	tab_windows = function() return { 41, 42, 40 } end,
}
t.eq(true, workspace.remember_editor(40, win_adapter))
t.eq(false, workspace.remember_editor(41, win_adapter))
t.eq(40, workspace.editor_win(win_adapter))
```

- [ ] **Step 2: Run the workspace spec and verify the new APIs are missing**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=workspace_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: FAIL because `ensure_base_diff` is not called or `remember_editor` is undefined.

- [ ] **Step 3: Implement Editor Group tracking**

Add `last_editor_by_tab` to `workspace.lua`. The default `window_info(win)` returns validity, tabpage, `buftype`, `filetype`, and `nvim_win_get_config(win).relative`.

A window is an Editor Group only when all of these are true:

- It is valid and belongs to the current tab.
- Its window config has `relative == ""`.
- Its buffer has `buftype == ""`.
- Its filetype is neither `snacks_picker_list` nor `BaseDiffTree`.

`remember_editor` stores the accepted window under its tabpage. `editor_win` returns the remembered valid Editor Group, then the first valid Editor Group in the current tab, then nil.

Add this autocmd to `config/autocmds.lua`:

```lua
vim.api.nvim_create_autocmd({ "WinEnter", "BufEnter" }, {
  callback = function()
    require("user.workspace").remember_editor()
  end,
})
```

- [ ] **Step 4: Ensure the diff panel before refreshing base data**

Add this default adapter method in `workspace.defaults`:

```lua
ensure_base_diff = function(opts)
  return require("user.base_diff_tree").ensure(opts)
end,
editor_win = function()
  return M.editor_win()
end,
```

After creating or finding `picker`, call:

```lua
if picker and picker.list and picker.list.win then
  api.ensure_base_diff({
    cwd = cwd,
    explorer_win = picker.list.win.win,
    editor_win = api.editor_win,
  })
end
api.refresh_base_diff(cwd)
```

Keep panel creation before the refresh so the subscription sees the first successful snapshot. Do not move focus when `opts.focus == false`.

- [ ] **Step 5: Run workspace and all base-diff specs**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=workspace_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_tree_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_view_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && NVIM_TEST_SPEC=base_diff_refresh_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua
```

Expected: all commands pass. Existing Explorer focus and restore assertions must remain unchanged.

- [ ] **Step 6: Format, inspect, and commit workspace integration**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && /Users/kosui/.local/share/nvim/mason/bin/stylua dot_config/nvim/lua/user/workspace.lua dot_config/nvim/lua/config/autocmds.lua tests/nvim/workspace_spec.lua
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" diff --check
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" add dot_config/nvim/lua/user/workspace.lua dot_config/nvim/lua/config/autocmds.lua tests/nvim/workspace_spec.lua
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" commit -m "feat(nvim): Explorerとbase差分パネルを同じ左列へ配置"
```

---

### Task 6: ドキュメント、配備、手動スモークテスト

**Files:**
- Modify: `docs/vim-cheatsheet.md:75-88`
- Verify: all files changed by Tasks 1-5

**Interfaces:**
- Consumes: completed feature from Tasks 1-5.
- Produces: documented user-facing keymap and applied Neovim configuration.

- [ ] **Step 1: Document the base-diff panel keys**

Insert a new section after `Explorer内の操作` in `docs/vim-cheatsheet.md`.

```markdown
## Base Changes内の操作

Explorer下部の差分ツリーにフォーカスがあるときだけ使えます。見出しにはbaseブランチ名と変更件数が表示されます。

| キー | 説明 |
|---|---|
| `Enter` / `Space` | 見出しまたはディレクトリを開閉。ファイルでは2画面diffを表示 |
| `o` | 作業ツリーのファイルを通常表示 |
| `zc` / `zo` | 差分パネル全体を閉じる / 開く |
| `R` | baseと変更一覧を再取得 |
| `?` | 差分パネル内のキー一覧を表示 |
```

- [ ] **Step 2: Run the complete automated verification**

Run:

```bash
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && nvim --headless -u NONE -l tests/nvim/run.lua
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && /Users/kosui/.local/share/nvim/mason/bin/stylua --check dot_config/nvim/lua tests/nvim
cd "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" && XDG_CONFIG_HOME=/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel/dot_config nvim --headless +qa
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" diff --check
```

Expected: all commands exit with code 0. If headless Neovim creates `nvim.log` only because its local server socket is blocked by the sandbox, inspect the warning and remove that generated untracked log before staging.

- [ ] **Step 3: Preview and apply the chezmoi-managed Neovim files**

Preview only the files in this feature:

```bash
chezmoi diff -S "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" "/Users/kosui/.config/nvim/lua/user/base_diff.lua" "/Users/kosui/.config/nvim/lua/user/base_diff_state.lua" "/Users/kosui/.config/nvim/lua/user/base_diff_tree.lua" "/Users/kosui/.config/nvim/lua/user/base_diff_view.lua" "/Users/kosui/.config/nvim/lua/user/workspace.lua" "/Users/kosui/.config/nvim/lua/config/autocmds.lua"
```

Confirm that the diff contains only the implementation from Tasks 1-5, then apply those same targets:

```bash
chezmoi apply -S "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" "/Users/kosui/.config/nvim/lua/user/base_diff.lua" "/Users/kosui/.config/nvim/lua/user/base_diff_state.lua" "/Users/kosui/.config/nvim/lua/user/base_diff_tree.lua" "/Users/kosui/.config/nvim/lua/user/base_diff_view.lua" "/Users/kosui/.config/nvim/lua/user/workspace.lua" "/Users/kosui/.config/nvim/lua/config/autocmds.lua"
```

- [ ] **Step 4: Perform the manual smoke test in a disposable Git worktree**

Use a Git worktree containing one added, modified, renamed, and deleted text file. Start Neovim from that worktree and verify each item explicitly:

1. Explorerの下へ`BASE CHANGES · <base> · 4`が表示されます。
2. `Enter`でディレクトリとパネル見出しを開閉できます。
3. `zc`で高さが1行になり、`zo`で保存済みの高さへ戻ります。
4. マウスで上下境界を変更し、Neovim再起動後も高さが復元されます。
5. `A/M/R/D`の各ファイルで左がbase、右が作業ツリーのdiffになります。
6. `o`は存在する実ファイルを通常表示し、削除済みファイルでは通知します。
7. 別ファイルを選択してもdiff windowは2つのままです。
8. diffの片側を閉じると残ったwindowのdiff modeが解除されます。
9. ファイル保存後に一覧とExplorerの色が同じsnapshotへ更新されます。
10. Explorerを閉じて`<leader>e`で再表示すると差分パネルも復元されます。

バイナリ動作の確認ではNUL byteを含むファイルを追加します。選択時にテキストdiffが開かず、LazyGitでの確認を案内する通知が表示されることを確認します。

- [ ] **Step 5: Commit documentation after the smoke test passes**

Run:

```bash
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" add docs/vim-cheatsheet.md
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" commit -m "docs(nvim): base差分パネルの操作をチートシートへ追加"
git -C "/Users/kosui/.local/share/chezmoi/.wt/feat/neovim-base-branch-diff-panel" status --short
```

Expected: implementation files are clean. `.Codex/settings.local.json` may remain untracked because it is worktree-local permission metadata and must not be committed.
