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

local restart_failure = make_adapter({ ["git worktree list --porcelain"] = { code = 0, stdout = list_output } })
restart_failure.adapter.restart_in_place = function(_, sub)
	sub.notify("Worktree switch: Neovim restart failed: unsaved changes")
end
local restart_errors = {}
worktrees.switch_to_branch({
	branch = "feat/a",
	cwd = "/repo",
	command = "lua open()",
	on_current = function()
		error("must not be called")
	end,
	on_error = function(message)
		restart_errors[#restart_errors + 1] = message
	end,
}, restart_failure.adapter)
t.eq(1, #restart_errors, "a failed restart must reach on_error")
t.truthy(restart_errors[1]:find("unsaved changes", 1, true), "the restart failure message must reach on_error")
