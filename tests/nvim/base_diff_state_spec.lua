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

vim.fn.writefile({
	vim.json.encode({
		["/repo"] = { collapsed = "yes", height = "14", open_dirs = "lua/user" },
	}),
}, adapter.path)
t.eq(
	{ collapsed = false, height = nil, open_dirs = {} },
	state.load("/repo", adapter),
	"malformed persistent collection types must normalize to defaults"
)

vim.fn.delete(state_dir, "rf")
