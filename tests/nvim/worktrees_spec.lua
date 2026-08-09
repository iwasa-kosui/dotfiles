local t = require("testlib")
local root = require("user.worktree_root")
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

t.eq(
	{ "feat/a", "feat/b", "main" },
	vim.tbl_map(function(item)
		return item.branch
	end, sorted)
)

t.eq("/repo/.wt/feat-a", items[2].path)

local cwd = "/repo"
local restarted_from
worktrees.restart_in_place({ path = "/repo/.wt/feat-a", branch = "feat/a" }, {
	getcwd = function()
		return cwd
	end,
	set_current_dir = function(path)
		cwd = path
	end,
	restart = function()
		restarted_from = cwd
	end,
})
t.eq("/repo/.wt/feat-a", restarted_from, "selected worktree must restart Neovim from its directory")

local failed_cwd = "/repo"
local restart_error
local call_ok, restart_ok = pcall(worktrees.restart_in_place, { path = "/repo/.wt/feat-a", branch = "feat/a" }, {
	getcwd = function()
		return failed_cwd
	end,
	set_current_dir = function(path)
		failed_cwd = path
	end,
	restart = function()
		error("unsaved changes")
	end,
	notify = function(message)
		restart_error = message
	end,
})
t.eq(true, call_ok, "restart errors must be handled")
t.eq(false, restart_ok, "failed restart must report failure")
t.eq("/repo", failed_cwd, "failed restart must restore the previous directory")
t.eq(true, restart_error and restart_error:find("unsaved changes", 1, true) ~= nil, "restart failure must be reported")

local activity_command
worktrees.record_activity({
	root = function(cwd)
		t.eq(vim.uv.cwd(), cwd)
		return "/canonical/worktree"
	end,
	system = function(command)
		activity_command = command
	end,
})
t.eq({ "worktree-activity", "record", "nvim", "/canonical/worktree" }, activity_command)

local original_system = vim.system
local original_resolve = root.resolve
local original_select = vim.ui.select
local callback_in_fast_event
local selected = false
local responses_by_command = {
	["git worktree list --porcelain"] = {
		code = 0,
		stdout = "worktree /repo\nHEAD aaaa\nbranch refs/heads/main\n\n",
	},
	["worktree-activity list"] = { code = 0, stdout = "[]" },
}

vim.system = function(command, _, callback)
	local timer = vim.uv.new_timer()
	timer:start(0, 0, function()
		timer:stop()
		timer:close()
		callback(responses_by_command[table.concat(command, " ")])
	end)
end
root.resolve = function()
	callback_in_fast_event = vim.in_fast_event()
	return "/repo"
end
vim.ui.select = function()
	selected = true
end

worktrees.open()
local completed = vim.wait(1000, function()
	return selected
end)

vim.system = original_system
root.resolve = original_resolve
vim.ui.select = original_select

t.truthy(completed, "worktree selection must be reached")
t.eq(false, callback_in_fast_event, "vim.system callbacks must leave fast event context")
