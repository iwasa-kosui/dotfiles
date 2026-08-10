local t = require("testlib")
local base_diff = require("user.base_diff")
local state = require("user.base_diff_state")
local tree = require("user.base_diff_tree")

local root = vim.fn.tempname()
local directory = "dir\nname"
local filename = "file\nnew.txt"
local old_path = "old\ndir/old\nname.txt"
local path = directory .. "/" .. filename
vim.fn.mkdir(root .. "/" .. directory, "p")
local fd = assert(vim.uv.fs_open(root .. "/" .. path, "w", 420))
assert(vim.uv.fs_write(fd, "newline path content\n", 0))
assert(vim.uv.fs_close(fd))

local original_snapshot = base_diff.snapshot
local original_error = base_diff.error
local original_subscribe = base_diff.subscribe
local original_load = state.load
local original_save = state.save
local target_win = vim.api.nvim_get_current_win()
local original_buffer = vim.api.nvim_win_get_buf(target_win)
local controller
local explorer_win

local ok, err = xpcall(function()
	base_diff.snapshot = function()
		return {
			cwd = root,
			base_name = "main",
			changes = { { status = "R", path = path, old_path = old_path } },
		}
	end
	base_diff.error = function() end
	base_diff.subscribe = function()
		return function() end
	end
	state.load = function()
		return { collapsed = false, height = 4, open_dirs = {} }
	end
	state.save = function() end

	vim.cmd("vsplit")
	explorer_win = vim.api.nvim_get_current_win()
	controller = tree.new()
	local ensured, ensure_err = pcall(function()
		controller:ensure({
			cwd = root,
			explorer_win = explorer_win,
			editor_win = function()
				return target_win
			end,
		})
	end)
	t.truthy(ensured, "newline Git paths must render in a real panel buffer: " .. tostring(ensure_err))
	t.eq(
		{ "⌄ BASE CHANGES · main · 1", "  ▸ dir^@name" },
		vim.api.nvim_buf_get_lines(controller.buf, 0, -1, false)
	)
	t.eq(directory, controller.rendered.items[2].path)

	controller:activate(2, "default")
	t.eq({
		"⌄ BASE CHANGES · main · 1",
		"  ⌄ dir^@name",
		"      R file^@new.txt ← old^@name.txt",
	}, vim.api.nvim_buf_get_lines(controller.buf, 0, -1, false))
	t.eq(path, controller.rendered.items[3].path)

	controller:activate(3, "open")
	t.eq(vim.uv.fs_realpath(root .. "/" .. path), vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(target_win)))
end, debug.traceback)

if controller then
	controller:close()
end
if explorer_win and vim.api.nvim_win_is_valid(explorer_win) then
	vim.api.nvim_win_close(explorer_win, true)
end
if vim.api.nvim_win_is_valid(target_win) then
	vim.wo[target_win].diff = false
	vim.api.nvim_win_set_buf(target_win, original_buffer)
end
base_diff.snapshot = original_snapshot
base_diff.error = original_error
base_diff.subscribe = original_subscribe
state.load = original_load
state.save = original_save
vim.fn.delete(root, "rf")

if not ok then
	error(err)
end
