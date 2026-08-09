local t = require("testlib")
local state = require("user.explorer_state")

local state_dir = vim.fn.tempname()
vim.fn.mkdir(state_dir, "p")
local state_file = state_dir .. "/explorer.json"
local realpaths = {
	["/repo-link"] = "/repo",
	["/repo-link/lua"] = "/repo/lua",
	["/repo/lua"] = "/repo/lua",
	["/repo/lua/nested"] = "/repo/lua/nested",
	["/other"] = "/other",
}
local adapter = {
	path = state_file,
	realpath = function(path)
		return realpaths[path] or path
	end,
}

state.save("/repo-link", { "/repo-link/lua", "/repo/lua", "/repo/lua/nested", "/other" }, adapter)
t.eq({ "/repo/lua", "/repo/lua/nested" }, state.load("/repo", adapter))
t.eq({}, state.load("/other", adapter), "expansion state must be keyed by worktree root")

local opened = {}
state.restore("/repo", {
	open = function(_, path)
		opened[#opened + 1] = path
	end,
}, adapter)
t.eq({ "/repo/lua", "/repo/lua/nested" }, opened)

vim.fn.delete(state_dir, "rf")
