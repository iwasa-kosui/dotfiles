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
local published = {}
local unsubscribe = diff.subscribe("/canonical/worktree", function(value, err)
	published[#published + 1] = { value = value, err = err }
end)
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
respond(5, { code = 0, stdout = "M\0edit.lua\0D\0gone.lua\0" })
respond(6, { code = 0, stdout = "?? new.lua\0" })

t.eq({ "git", "status", "--porcelain=v1", "-z", "--untracked-files=all" }, pending[6].command)

respond(1, { code = 1, stdout = "" })

t.truthy(
	vim.wait(100, function()
		return #callbacks == 1
	end),
	"only the most recent refresh should invoke its callback"
)
t.eq({ true }, callbacks)

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

t.truthy(vim.wait(100, function()
	return #published == 1
end))
t.eq(1, #published)
t.eq(snapshot, published[1].value)
t.eq(nil, published[1].err)
unsubscribe()

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
