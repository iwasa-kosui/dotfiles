local t = require("testlib")
local diff = require("user.base_diff")

local pending = {}
local adapter = {
	root = function(cwd)
		t.eq("/launch/subdir", cwd)
		return "/canonical/worktree"
	end,
	run = function(command, cwd, callback)
		pending[#pending + 1] = { command = command, cwd = cwd, callback = callback }
	end,
}

local function respond(index, result)
	pending[index].callback(result)
end

local callbacks = {}
local cwd = "/launch/subdir"
diff.refresh(cwd, function(success)
	callbacks[#callbacks + 1] = success
end, adapter)
diff.refresh(cwd, function(success)
	callbacks[#callbacks + 1] = success
end, adapter)

t.eq("/canonical/worktree", pending[1].cwd)
t.eq("/canonical/worktree", pending[2].cwd)

respond(2, { code = 1, stdout = "" })
respond(3, { code = 0, stdout = "origin/main\n" })
respond(4, { code = 0, stdout = "base\n" })
respond(5, { code = 0, stdout = "A\tnew.lua\n" })
respond(6, { code = 0, stdout = "" })

t.eq({ "git", "status", "--porcelain=v1", "-z", "--untracked-files=all" }, pending[6].command)

respond(1, { code = 1, stdout = "" })

t.truthy(
	vim.wait(100, function()
		return #callbacks == 1
	end),
	"only the most recent refresh should invoke its callback"
)
t.eq({ true }, callbacks)
t.eq("A", diff.status("/canonical/worktree/new.lua"))
