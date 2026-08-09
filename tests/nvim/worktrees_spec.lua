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

local commands = {}
local responses = {
	["cmux workspace list --json"] = {
		code = 0,
		stdout = '{"workspaces":[{"ref":"workspace:1"},{"ref":"workspace:2"}]}',
	},
	["cmux sidebar-state --workspace workspace:1 --json"] = {
		code = 0,
		stdout = '{"workspace":{"ref":"workspace:1"},"cwd":"/repo/other"}',
	},
	["cmux sidebar-state --workspace workspace:2 --json"] = {
		code = 0,
		stdout = '{"workspace":{"ref":"workspace:2"},"cwd":"/repo/.wt/feat-a/./"}',
	},
	["cmux workspace select workspace:2"] = { code = 0, stdout = "" },
}
local notifications = {}
local cwd_before = vim.uv.cwd()
worktrees.switch_workspace("cmux", { path = "/repo/.wt/feat-a", branch = "feat/a" }, "repo", {
	run = function(command, callback)
		local key = table.concat(command, " ")
		commands[#commands + 1] = key
		callback(responses[key])
	end,
	notify = function(message)
		notifications[#notifications + 1] = message
	end,
})
t.eq({
	"cmux workspace list --json",
	"cmux sidebar-state --workspace workspace:1 --json",
	"cmux sidebar-state --workspace workspace:2 --json",
	"cmux workspace select workspace:2",
}, commands)
t.eq({}, notifications)
t.eq(cwd_before, vim.uv.cwd(), "worktree switching must not change Neovim cwd")

commands = {}
notifications = {}
worktrees.switch_workspace("cmux", { path = "/repo/.wt/missing", branch = "missing" }, "repo", {
	run = function(command, callback)
		local key = table.concat(command, " ")
		commands[#commands + 1] = key
		if key == "cmux workspace list --json" then
			callback({ code = 0, stdout = '["workspace:1"]' })
		else
			callback({ code = 1, stdout = "" })
		end
	end,
	notify = function(message)
		notifications[#notifications + 1] = message
	end,
})
t.eq({
	"cmux workspace list --json",
	"cmux sidebar-state --workspace workspace:1 --json",
}, commands, "sidebar failure must not create a duplicate workspace")
t.eq(1, #notifications)

commands = {}
worktrees.switch_workspace("cmux", { path = "/repo/.wt/new", branch = "new" }, "repo", {
	run = function(command, callback)
		local key = table.concat(command, " ")
		commands[#commands + 1] = key
		local response = ({
			["cmux workspace list --json"] = { code = 0, stdout = "[]" },
			["cmux workspace create --name repo:new --cwd /repo/.wt/new --command nvim --json"] = {
				code = 0,
				stdout = '{"ref":"workspace:3"}',
			},
		})[key]
		callback(response)
	end,
	notify = function(message)
		error(message)
	end,
})
t.eq({
	"cmux workspace list --json",
	"cmux workspace create --name repo:new --cwd /repo/.wt/new --command nvim --json",
}, commands)

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
