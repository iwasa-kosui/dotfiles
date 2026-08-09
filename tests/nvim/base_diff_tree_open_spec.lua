local t = require("testlib")
local base_diff = require("user.base_diff")
local state = require("user.base_diff_state")
local tree = require("user.base_diff_tree")

local root = vim.fn.getcwd()
local path = "AGENTS.md"
local target_win = vim.api.nvim_get_current_win()
local original_buffer = vim.api.nvim_win_get_buf(target_win)
local original_snapshot = base_diff.snapshot
local original_error = base_diff.error
local original_subscribe = base_diff.subscribe
local original_load = state.load
local original_save = state.save
local controller
local explorer_win
local unrelated_win
local unrelated_buffer

local ok, err = xpcall(function()
	base_diff.snapshot = function()
		return { cwd = root, base_name = "main", merge_base = "HEAD", changes = { { status = "M", path = path } } }
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
	controller:ensure({
		cwd = root,
		explorer_win = explorer_win,
		editor_win = function()
			return target_win
		end,
	})

	controller:activate(2, "default")
	t.truthy(
		vim.wait(2000, function()
			return controller.view:pair() ~= nil
		end),
		"the test must create a controller-owned diff pair"
	)
	local owned_pair = controller.view:pair()
	t.eq(target_win, owned_pair.right)
	t.eq(true, vim.wo[owned_pair.left].diff)
	t.eq(true, vim.wo[owned_pair.right].diff)

	vim.api.nvim_win_call(explorer_win, function()
		vim.cmd("vsplit")
		unrelated_win = vim.api.nvim_get_current_win()
	end)
	unrelated_buffer = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_buf_set_lines(unrelated_buffer, 0, -1, false, { "unrelated user diff" })
	vim.api.nvim_win_set_buf(unrelated_win, unrelated_buffer)
	vim.api.nvim_win_call(unrelated_win, function()
		vim.cmd("diffthis")
	end)

	controller:activate(2, "open")
	t.eq(nil, controller.view:pair(), "o must discard the controller-owned diff pair")
	t.eq(false, vim.api.nvim_win_is_valid(owned_pair.left), "o must close the controller-owned base scratch")
	t.eq(vim.fs.normalize(root .. "/" .. path), vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(target_win)))
	t.eq(false, vim.wo[target_win].diff, "o must leave the real file in normal, non-diff mode")
	t.eq(true, vim.api.nvim_win_is_valid(unrelated_win), "o must preserve unrelated user windows")
	t.eq(unrelated_buffer, vim.api.nvim_win_get_buf(unrelated_win))
	t.eq(true, vim.wo[unrelated_win].diff, "o must preserve unrelated user diffs")
end, debug.traceback)

if controller then
	controller:close()
end
if unrelated_win and vim.api.nvim_win_is_valid(unrelated_win) then
	vim.api.nvim_win_close(unrelated_win, true)
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

if not ok then
	error(err)
end
