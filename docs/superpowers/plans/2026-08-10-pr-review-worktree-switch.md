# PRレビュー開始時のworktree切り替え Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `<leader>pp` のPR一覧で選んだPRのブランチのworktreeへ切り替え、そこでOcto画面とbase差分パネルを開く。

**Architecture:** worktreeの解決と作成と切り替えを `user/worktrees.lua` に閉じ込め、`user/pr_review.lua` はブランチ名を渡して委譲するだけにする。切り替え後のPR画面は `:restart` の `[command]` で新しいインスタンス側に `require("user.pr_review").open()` を実行させる。

**Tech Stack:** Neovim 0.12 / Lua / `vim.system` / `git wt` / `gh` / テストは `tests/nvim/run.lua` の自作ランナー

設計は `docs/superpowers/specs/2026-08-10-pr-review-worktree-switch-design.md` にある。

## Global Constraints

- 対象リポジトリは chezmoi のソースディレクトリ。編集するのは `dot_config/nvim/lua/user/` 配下と `tests/nvim/` 配下と `docs/`
- テストの実行は `nvim --headless -u NONE -l tests/nvim/run.lua`。単体で走らせるときは `NVIM_TEST_SPEC=<spec file name>` を付ける
- テストから実際の `git` や `gh` を起動しない。コマンド実行はすべてアダプタ経由でスタブする
- `user/worktrees.lua` の通知文は既存に合わせて英語、先頭は `Worktree switch: ` とする。`user/pr_review.lua` の通知文は既存に合わせて日本語
- 通知レベルは `vim.log.levels.ERROR`。既存の `notify` ヘルパをそのまま使う
- コミットは Conventional Commits 形式で、末尾に `Co-Authored-By: <実行中のモデル名> <noreply@anthropic.com>` を付ける
- インデントは既存ファイルに合わせる。`dot_config/nvim/lua/` はスペース2、`tests/nvim/` はタブ

---

### Task 1: worktreeの分類とrestartコマンドの受け渡し

`git worktree list --porcelain` の解析結果からブランチに対応するworktreeを分類する関数を追加し、`restart_in_place` が新しいインスタンス側で実行するコマンドを受け取れるようにする。

**Files:**
- Modify: `dot_config/nvim/lua/user/worktrees.lua`
- Test: `tests/nvim/worktrees_branch_switch_spec.lua`

**Interfaces:**
- Consumes: `worktrees.parse_porcelain(lines)` は既存。`{ path = string, branch = string }` の配列を返す。`path` は正規化済み
- Produces:
  - `worktrees.classify_branch(items, branch, current) -> { state: "current"|"switch"|"missing", path?: string, branch: string }`
  - `worktrees.restart_in_place(item, adapter)` は `item.command` を `adapter.restart` の第1引数として渡す

- [ ] **Step 1: Write the failing test**

`tests/nvim/worktrees_branch_switch_spec.lua` を新規作成する。

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
})

t.eq(
	{ state = "current", path = "/repo/.wt/feat-a", branch = "feat/a" },
	worktrees.classify_branch(items, "feat/a", "/repo/.wt/feat-a"),
	"the worktree we already sit in must not require a switch"
)
t.eq(
	{ state = "switch", path = "/repo/.wt/feat-a", branch = "feat/a" },
	worktrees.classify_branch(items, "feat/a", "/repo"),
	"another worktree for the branch must be reported as a switch target"
)
t.eq(
	{ state = "missing", branch = "feat/b" },
	worktrees.classify_branch(items, "feat/b", "/repo"),
	"a branch without a worktree must be reported as missing"
)

local restart_commands = {}
local restart_cwd = "/repo"
worktrees.restart_in_place({
	path = "/repo/.wt/feat-a",
	branch = "feat/a",
	command = "lua require('user.pr_review').open()",
}, {
	getcwd = function()
		return restart_cwd
	end,
	set_current_dir = function(path)
		restart_cwd = path
	end,
	restart = function(command)
		restart_commands[#restart_commands + 1] = command
	end,
})
t.eq({ "lua require('user.pr_review').open()" }, restart_commands, "restart must forward the follow-up command")
t.eq("/repo/.wt/feat-a", restart_cwd)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NVIM_TEST_SPEC=worktrees_branch_switch_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua`
Expected: FAIL with `attempt to call field 'classify_branch' (a nil value)`

- [ ] **Step 3: Write minimal implementation**

`dot_config/nvim/lua/user/worktrees.lua` の `M.sort` の直後に追加する。

```lua
---@param items { path: string, branch: string }[]
---@param branch string
---@param current string
---@return { state: "current"|"switch"|"missing", path?: string, branch: string }
function M.classify_branch(items, branch, current)
  local normalized_current = normalize(current)
  for _, item in ipairs(items) do
    if item.branch == branch then
      if item.path == normalized_current then
        return { state = "current", path = item.path, branch = branch }
      end
      return { state = "switch", path = item.path, branch = branch }
    end
  end
  return { state = "missing", branch = branch }
end
```

同ファイルの `M.restart_in_place` の `restart` の既定値と `pcall` を置き換える。置き換え前は次のとおり。

```lua
  local restart = adapter.restart or function()
    vim.cmd.restart()
  end
```

```lua
  local ok, err = pcall(restart)
```

置き換え後は次のとおり。

```lua
  local restart = adapter.restart or function(command)
    if type(command) == "string" and command ~= "" then
      vim.cmd("restart " .. command)
    else
      vim.cmd.restart()
    end
  end
```

```lua
  local ok, err = pcall(restart, item.command)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NVIM_TEST_SPEC=worktrees_branch_switch_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua`
Expected: PASS。出力なしで終了コード0

続けて全体を走らせ、既存の `worktrees_spec.lua` が壊れていないことを確認する。

Run: `nvim --headless -u NONE -l tests/nvim/run.lua`
Expected: PASS。出力なしで終了コード0

- [ ] **Step 5: Commit**

```bash
git add dot_config/nvim/lua/user/worktrees.lua tests/nvim/worktrees_branch_switch_spec.lua
git commit -m "feat(nvim): branchからworktreeを分類しrestart後のコマンドを受け渡す"
```

---

### Task 2: ブランチ指定のworktree切り替え

ブランチ名を受け取り、worktreeが無ければ作成して切り替える非同期の関数を追加する。

**Files:**
- Modify: `dot_config/nvim/lua/user/worktrees.lua`
- Test: `tests/nvim/worktrees_branch_switch_spec.lua`

**Interfaces:**
- Consumes: Task 1 の `worktrees.classify_branch`、既存の `worktrees.parse_porcelain` と `worktrees.restart_in_place`
- Produces: `worktrees.switch_to_branch(opts, adapter)`
  - `opts.branch: string` 切り替え先のブランチ
  - `opts.cwd: string` gitコマンドを実行するリポジトリのパス
  - `opts.command?: string` 切り替え後に新しいインスタンスで実行するコマンド
  - `opts.on_current: fun()` 既に対象worktreeにいるときに呼ばれる
  - `opts.on_error?: fun(message: string)` 失敗時に呼ばれる。省略時は `vim.notify` でERROR通知
  - `adapter.run?: fun(command: string[], callback: fun(result: { code: integer, stdout?: string, stderr?: string }))`
  - `adapter.restart_in_place?`、`adapter.root?`、`adapter.notify?` も差し替えられる

- [ ] **Step 1: Write the failing test**

`tests/nvim/worktrees_branch_switch_spec.lua` の末尾に追記する。

```lua
local function make_adapter(responses)
  local state = { commands = {}, switched = {}, errors = {} }
  state.adapter = {
    run = function(command, callback)
      state.commands[#state.commands + 1] = table.concat(command, " ")
      callback(responses[table.concat(command, " ")] or { code = 1, stderr = "unexpected command" })
    end,
    restart_in_place = function(item)
      state.switched[#state.switched + 1] = item
      return true
    end,
    root = function(path)
      return path
    end,
    notify = function(message)
      state.errors[#state.errors + 1] = message
    end,
  }
  return state
end

local list_output = "worktree /repo\nHEAD aaaa\nbranch refs/heads/main\n\n"
	.. "worktree /repo/.wt/feat-a\nHEAD bbbb\nbranch refs/heads/feat/a\n\n"

local current = make_adapter({ ["git worktree list --porcelain"] = { code = 0, stdout = list_output } })
local stayed = 0
worktrees.switch_to_branch({
	branch = "feat/a",
	cwd = "/repo/.wt/feat-a",
	command = "lua open()",
	on_current = function()
		stayed = stayed + 1
	end,
}, current.adapter)
t.eq(1, stayed, "the current worktree must not restart")
t.eq({}, current.switched)

local other = make_adapter({ ["git worktree list --porcelain"] = { code = 0, stdout = list_output } })
worktrees.switch_to_branch({
	branch = "feat/a",
	cwd = "/repo",
	command = "lua open()",
	on_current = function()
		error("must not be called")
	end,
}, other.adapter)
t.eq(1, #other.switched, "an existing worktree must be switched to")
t.eq("/repo/.wt/feat-a", other.switched[1].path)
t.eq("lua open()", other.switched[1].command)

local remote = make_adapter({
	["git worktree list --porcelain"] = { code = 0, stdout = list_output },
	["git rev-parse --verify --quiet refs/heads/feat/new"] = { code = 1, stdout = "" },
	["git fetch origin feat/new"] = { code = 0, stdout = "" },
	["git wt feat/new origin/feat/new --nocd"] = {
		code = 0,
		stdout = "Preparing worktree (new branch 'feat/new')\nHEAD is now at aaaa\n/repo/.wt/feat-new\n",
	},
})
worktrees.switch_to_branch({
	branch = "feat/new",
	cwd = "/repo",
	command = "lua open()",
	on_current = function()
		error("must not be called")
	end,
}, remote.adapter)
t.eq({
	"git worktree list --porcelain",
	"git rev-parse --verify --quiet refs/heads/feat/new",
	"git fetch origin feat/new",
	"git wt feat/new origin/feat/new --nocd",
}, remote.commands, "a branch without a local ref must be fetched before creating the worktree")
t.eq("/repo/.wt/feat-new", remote.switched[1].path, "the created worktree path must come from the last output line")

local local_branch = make_adapter({
	["git worktree list --porcelain"] = { code = 0, stdout = list_output },
	["git rev-parse --verify --quiet refs/heads/feat/local"] = { code = 0, stdout = "bbbb\n" },
	["git wt feat/local --nocd"] = { code = 0, stdout = "/repo/.wt/feat-local\n" },
})
worktrees.switch_to_branch({
	branch = "feat/local",
	cwd = "/repo",
	on_current = function()
		error("must not be called")
	end,
}, local_branch.adapter)
t.eq({
	"git worktree list --porcelain",
	"git rev-parse --verify --quiet refs/heads/feat/local",
	"git wt feat/local --nocd",
}, local_branch.commands, "an existing local branch must not be fetched")
t.eq("/repo/.wt/feat-local", local_branch.switched[1].path)

local fetch_failure = make_adapter({
	["git worktree list --porcelain"] = { code = 0, stdout = list_output },
	["git rev-parse --verify --quiet refs/heads/feat/fork"] = { code = 1, stdout = "" },
	["git fetch origin feat/fork"] = { code = 1, stderr = "couldn't find remote ref feat/fork" },
})
local fetch_errors = {}
worktrees.switch_to_branch({
	branch = "feat/fork",
	cwd = "/repo",
	on_current = function()
		error("must not be called")
	end,
	on_error = function(message)
		fetch_errors[#fetch_errors + 1] = message
	end,
}, fetch_failure.adapter)
t.eq({}, fetch_failure.switched, "a failed fetch must not restart")
t.eq(1, #fetch_errors)
t.truthy(fetch_errors[1]:find("couldn't find remote ref", 1, true), "the fetch failure must be reported with git's message")

local create_failure = make_adapter({
	["git worktree list --porcelain"] = { code = 0, stdout = list_output },
	["git rev-parse --verify --quiet refs/heads/feat/busy"] = { code = 0, stdout = "dddd\n" },
	["git wt feat/busy --nocd"] = { code = 1, stderr = "worktree is dirty" },
})
local create_errors = {}
worktrees.switch_to_branch({
	branch = "feat/busy",
	cwd = "/repo",
	on_current = function()
		error("must not be called")
	end,
	on_error = function(message)
		create_errors[#create_errors + 1] = message
	end,
}, create_failure.adapter)
t.eq({}, create_failure.switched, "a failed git wt must not restart")
t.truthy(create_errors[1]:find("worktree is dirty", 1, true), "the git wt failure must be reported with git's message")

local missing_path = make_adapter({
	["git worktree list --porcelain"] = { code = 0, stdout = list_output },
	["git rev-parse --verify --quiet refs/heads/feat/empty"] = { code = 0, stdout = "cccc\n" },
	["git wt feat/empty --nocd"] = { code = 0, stdout = "\n" },
})
local path_errors = {}
worktrees.switch_to_branch({
	branch = "feat/empty",
	cwd = "/repo",
	on_current = function()
		error("must not be called")
	end,
	on_error = function(message)
		path_errors[#path_errors + 1] = message
	end,
}, missing_path.adapter)
t.eq({}, missing_path.switched, "an unusable git wt output must not restart")
t.eq(1, #path_errors)

local list_failure = make_adapter({ ["git worktree list --porcelain"] = { code = 1, stderr = "not a repository" } })
local list_errors = {}
worktrees.switch_to_branch({
	branch = "feat/a",
	cwd = "/repo",
	on_current = function()
		error("must not be called")
	end,
	on_error = function(message)
		list_errors[#list_errors + 1] = message
	end,
}, list_failure.adapter)
t.eq({}, list_failure.switched)
t.eq(1, #list_errors)

local invalid = make_adapter({})
local invalid_errors = {}
worktrees.switch_to_branch({
	branch = "",
	cwd = "/repo",
	on_current = function()
		error("must not be called")
	end,
	on_error = function(message)
		invalid_errors[#invalid_errors + 1] = message
	end,
}, invalid.adapter)
t.eq({}, invalid.commands, "an empty branch must not run any git command")
t.eq(1, #invalid_errors)
```

restartそのものが失敗した場合にcwdを戻す挙動は既存の `tests/nvim/worktrees_spec.lua:49-68` が検証しているため、ここでは重複して書かない。

- [ ] **Step 2: Run test to verify it fails**

Run: `NVIM_TEST_SPEC=worktrees_branch_switch_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua`
Expected: FAIL with `attempt to call field 'switch_to_branch' (a nil value)`

- [ ] **Step 3: Write minimal implementation**

`dot_config/nvim/lua/user/worktrees.lua` の先頭付近、`local function run(command, callback)` の直後にヘルパを追加する。

```lua
local function command_detail(result)
  local message = vim.trim((result and (result.stderr or result.stdout)) or "")
  return message ~= "" and message or "unknown error"
end

local function last_output_path(output)
  local path
  for _, line in ipairs(vim.split(output or "", "\n", { plain = true })) do
    local trimmed = vim.trim(line)
    if trimmed ~= "" then
      path = trimmed
    end
  end
  return path
end
```

`M.classify_branch` の直後に切り替え関数を追加する。

```lua
---@param opts { branch: string, cwd: string, command?: string, on_current: fun(), on_error?: fun(message: string) }
function M.switch_to_branch(opts, adapter)
  adapter = adapter or {}
  local execute = adapter.run
    or function(command, callback)
      vim.system(command, { cwd = opts.cwd, text = true }, vim.schedule_wrap(callback))
    end
  local switch = adapter.restart_in_place or M.restart_in_place
  local resolve = adapter.root or root.resolve
  local report = adapter.notify or notify

  local function fail(message)
    if opts.on_error then
      opts.on_error(message)
    else
      report(message)
    end
  end

  local branch = opts.branch
  if type(branch) ~= "string" or branch == "" then
    fail("Worktree switch: the pull request branch is empty")
    return
  end

  local function create(start_point)
    local command = { "git", "wt", branch }
    if start_point then
      command[#command + 1] = start_point
    end
    command[#command + 1] = "--nocd"
    execute(command, function(result)
      if result.code ~= 0 then
        fail("Worktree switch: git wt failed: " .. command_detail(result))
        return
      end
      local path = last_output_path(result.stdout)
      if not path then
        fail("Worktree switch: git wt did not report a worktree path")
        return
      end
      switch({ path = path, branch = branch, command = opts.command })
    end)
  end

  execute({ "git", "worktree", "list", "--porcelain" }, function(list_result)
    if list_result.code ~= 0 then
      fail("Worktree switch: git worktree list failed: " .. command_detail(list_result))
      return
    end
    local items = M.parse_porcelain(vim.split(list_result.stdout or "", "\n", { plain = true }))
    local target = M.classify_branch(items, branch, resolve(opts.cwd))
    if target.state == "current" then
      opts.on_current()
      return
    end
    if target.state == "switch" then
      switch({ path = target.path, branch = branch, command = opts.command })
      return
    end
    execute({ "git", "rev-parse", "--verify", "--quiet", "refs/heads/" .. branch }, function(ref_result)
      if ref_result.code == 0 then
        create(nil)
        return
      end
      execute({ "git", "fetch", "origin", branch }, function(fetch_result)
        if fetch_result.code ~= 0 then
          fail("Worktree switch: git fetch failed: " .. command_detail(fetch_result))
          return
        end
        create("origin/" .. branch)
      end)
    end)
  end)
end
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NVIM_TEST_SPEC=worktrees_branch_switch_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua`
Expected: PASS

Run: `nvim --headless -u NONE -l tests/nvim/run.lua`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dot_config/nvim/lua/user/worktrees.lua tests/nvim/worktrees_branch_switch_spec.lua
git commit -m "feat(nvim): branch指定でworktreeを用意して切り替える経路を追加"
```

---

### Task 3: PR一覧の選択からworktree切り替えへ委譲

PRを選んだ時点でブランチを取り出し、切り替えが必要なら `switch_to_branch` に渡す。切り替え不要なら従来どおりOcto画面を開く。

**Files:**
- Modify: `dot_config/nvim/lua/user/pr_review.lua`
- Test: `tests/nvim/pr_review_spec.lua`

**Interfaces:**
- Consumes: Task 2 の `worktrees.switch_to_branch(opts, adapter)`
- Produces:
  - `runtime.switch_worktree(opts)` というアダプタ経由の入口。既定は `require("user.worktrees").switch_to_branch(opts)`
  - `selected_pr_target` の戻り値に `branch` を追加する。`headRefName` が文字列でない、または空の場合は `nil` を返す

- [ ] **Step 1: Write the failing test**

`tests/nvim/pr_review_spec.lua` の末尾に追記する。既存のアダプタ定義を流用せず、この検証用のアダプタを新しく作る。

```lua
local switch_calls = {}
local switch_notifications = {}
local switch_loaded = {}
local switch_mode = "switch"
local switch_adapter = {
	root = function()
		return "/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function() end,
	},
	system = function(argv, _, callback)
		if argv[2] == "repo" then
			callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo"}', stderr = "" })
			return
		end
		callback({
			code = 0,
			stdout = vim.json.encode({
				{
					number = 77,
					title = "Switch PR",
					url = "https://github.com/selected/repo/pull/77",
					state = "OPEN",
					isDraft = false,
					headRefName = "feat/switch",
				},
			}),
			stderr = "",
		})
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function() end,
	load_pr = function(target, cwd, callback)
		switch_loaded[#switch_loaded + 1] = { target = target, cwd = cwd }
		callback({ code = 1, stdout = "", stderr = "stop here" })
	end,
	notify = function(message)
		switch_notifications[#switch_notifications + 1] = message
	end,
	switch_worktree = function(opts)
		switch_calls[#switch_calls + 1] = opts
		if switch_mode == "current" then
			opts.on_current()
		elseif switch_mode == "error" then
			opts.on_error("Worktree switch: git fetch failed: no remote ref")
		end
	end,
	pick_prs = function(_, _, callbacks)
		switch_picker_callbacks = callbacks
		return 4001
	end,
	buffer_valid = function()
		return true
	end,
	register_cleanup = function() end,
	current_buffer = function()
		return 4001
	end,
	current_tab = function()
		return 41
	end,
	tab_valid = function()
		return false
	end,
	buffer_filetype = function()
		return "TelescopePrompt"
	end,
	delete_buffer = function() end,
	reviews = function()
		return { get_current_review = function() end }
	end,
	set_keymap = function() end,
}

local selected_pr = {
	__typename = "PullRequest",
	number = 77,
	title = "Switch PR",
	url = "https://github.com/selected/repo/pull/77",
	state = "OPEN",
	isDraft = false,
	headRefName = "feat/switch",
	repository = { nameWithOwner = "selected/repo" },
}

review.list(switch_adapter)
switch_picker_callbacks.transition()
switch_picker_callbacks.select(selected_pr)
t.eq(1, #switch_calls, "selecting a PR must delegate the worktree switch")
t.eq("feat/switch", switch_calls[1].branch)
t.eq("/repo", switch_calls[1].cwd)
t.eq("lua require('user.pr_review').open()", switch_calls[1].command)
t.eq({}, switch_loaded, "a PR needing a switch must not open its surface before the restart")

switch_mode = "current"
switch_calls = {}
review.list(switch_adapter)
switch_picker_callbacks.transition()
switch_picker_callbacks.select(selected_pr)
t.eq(1, #switch_loaded, "a PR in the current worktree must open its surface without restarting")
t.eq(77, switch_loaded[1].target.number)

switch_mode = "error"
switch_notifications = {}
review.list(switch_adapter)
switch_picker_callbacks.transition()
switch_picker_callbacks.select(selected_pr)
t.truthy(
	switch_notifications[1] and switch_notifications[1]:find("git fetch failed", 1, true),
	"a failed switch must report git's message"
)

switch_mode = "switch"
switch_calls = {}
switch_notifications = {}
review.list(switch_adapter)
switch_picker_callbacks.transition()
switch_picker_callbacks.select(vim.tbl_extend("force", selected_pr, { headRefName = "" }))
t.eq({}, switch_calls, "a PR without a head branch must not switch")
t.eq(1, #switch_notifications)
```

ファイル冒頭の `local calls = {}` の並びに `local switch_picker_callbacks` を宣言する。

既存の `async_adapter` と `transition_adapter` は `callbacks.select` を呼ぶため、切り替えを挟まないスタブを足す。それぞれのアダプタ定義に次の1項目を追加する。

```lua
	switch_worktree = function(opts)
		opts.on_current()
	end,
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NVIM_TEST_SPEC=pr_review_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua`
Expected: FAIL。`switch_calls` が空のままなので `selecting a PR must delegate the worktree switch` で落ちる

- [ ] **Step 3: Write minimal implementation**

`dot_config/nvim/lua/user/pr_review.lua` の `defaults` の `__index` テーブルへ追加する。`dock` の直後に置く。

```lua
      switch_worktree = function(opts)
        require("user.worktrees").switch_to_branch(opts)
      end,
```

`selected_pr_target` にブランチの検証と受け渡しを足す。`local host, owner, name, url_number = value.url:match(...)` の前に検証を追加する。

```lua
  if type(value.headRefName) ~= "string" or value.headRefName == "" then
    return nil
  end
```

同関数の `return` にフィールドを1つ足す。

```lua
  return {
    number = value.number,
    url = value.url,
    repo = repo,
    owner = owner,
    name = name,
    host = host,
    branch = value.headRefName,
  }
```

`M.list` の `select` コールバックを差し替える。差し替え前は次のとおり。

```lua
        select = function(selected)
          if not session or session.generation ~= generation then
            return
          end
          local target = selected_pr_target(selected, repo)
          if not target then
            runtime.notify("選択されたPR情報が不正です")
            session.pending = false
            finish(runtime, generation)
            return
          end
          load_pr_surface(runtime, generation, target, cwd)
        end,
```

差し替え後は次のとおり。

```lua
        select = function(selected)
          if not session or session.generation ~= generation then
            return
          end
          local target = selected_pr_target(selected, repo)
          if not target then
            runtime.notify("選択されたPR情報が不正です")
            session.pending = false
            finish(runtime, generation)
            return
          end
          session.pending = true
          runtime.switch_worktree({
            branch = target.branch,
            cwd = cwd,
            command = "lua require('user.pr_review').open()",
            on_current = function()
              if not session or session.generation ~= generation then
                return
              end
              load_pr_surface(runtime, generation, target, cwd)
            end,
            on_error = function(message)
              if not session or session.generation ~= generation then
                return
              end
              session.pending = false
              runtime.notify(message)
              finish(runtime, generation)
            end,
          })
        end,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NVIM_TEST_SPEC=pr_review_spec.lua nvim --headless -u NONE -l tests/nvim/run.lua`
Expected: PASS

Run: `nvim --headless -u NONE -l tests/nvim/run.lua`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dot_config/nvim/lua/user/pr_review.lua tests/nvim/pr_review_spec.lua
git commit -m "feat(nvim): PR選択時に対象branchのworktreeへ切り替える"
```

---

### Task 4: 実機確認とチートシートの更新

配布したうえで実際のNeovimで切り替えを確認し、キーの説明を更新する。

**Files:**
- Modify: `docs/vim-cheatsheet.md:130`

- [ ] **Step 1: 配布する**

Run: `chezmoi apply --source "$PWD" ~/.config/nvim/lua/user/worktrees.lua ~/.config/nvim/lua/user/pr_review.lua`
Expected: エラーなく終了する

- [ ] **Step 2: 既存worktreeへの切り替えを確認する**

mainのworktreeでNeovimを起動し、既にworktreeがあるブランチのPRを `<leader>pp` から選ぶ。

Expected: Neovimが再起動し、`:pwd` が対象worktreeのパスになる。Octo画面が開き、base差分パネルの見出しが `BASE CHANGES · main · <1以上の件数>` になる

- [ ] **Step 3: worktree未作成のPRで確認する**

worktreeが無いブランチのPRを `<leader>pp` から選ぶ。

Expected: `.wt/<branch>` が作成され、そこへ切り替わる。`git worktree list` に新しいworktreeが並ぶ

- [ ] **Step 4: 同じworktreeにいる場合を確認する**

切り替わった先で再度 `<leader>pp` から同じPRを選ぶ。

Expected: 再起動が起きず、Octo画面だけが開く

- [ ] **Step 5: チートシートを更新する**

`docs/vim-cheatsheet.md` の130行目を次のように変える。

変更前

```markdown
| `<leader>pp` | リポジトリのPR一覧を開く |
```

変更後

```markdown
| `<leader>pp` | リポジトリのPR一覧を開く。選んだPRのブランチのworktreeへ切り替える |
```

- [ ] **Step 6: Commit**

```bash
git add docs/vim-cheatsheet.md
git commit -m "docs(nvim): PR一覧からworktreeが切り替わることをチートシートへ追記"
```
