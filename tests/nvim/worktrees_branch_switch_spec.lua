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
