local t = require("testlib")
local base_diff = require("user.base_diff")
local state = require("user.base_diff_state")
local tree = require("user.base_diff_tree")

local root_one = vim.fn.tempname()
local root_two = vim.fn.tempname()
vim.fn.mkdir(root_one, "p")
vim.fn.mkdir(root_two, "p")

local original_snapshot = base_diff.snapshot
local original_error = base_diff.error
local original_subscribe = base_diff.subscribe
local original_load = state.load
local original_save = state.save
local original_tab = vim.api.nvim_get_current_tabpage()
local second_tab

local ok, err = xpcall(function()
	base_diff.snapshot = function(cwd)
		return { cwd = cwd, base_name = "main", changes = {} }
	end
	base_diff.error = function() end
	base_diff.subscribe = function()
		return function() end
	end
	state.load = function()
		return { collapsed = false, height = 4, open_dirs = {} }
	end
	state.save = function() end

	local first_editor = vim.api.nvim_get_current_win()
	vim.cmd("vsplit")
	local first_explorer = vim.api.nvim_get_current_win()
	local first_panel = tree.ensure({
		cwd = root_one,
		explorer_win = first_explorer,
		editor_win = function()
			return first_editor
		end,
	})

	vim.cmd("tabnew")
	second_tab = vim.api.nvim_get_current_tabpage()
	local second_editor = vim.api.nvim_get_current_win()
	vim.cmd("vsplit")
	local second_explorer = vim.api.nvim_get_current_win()
	local second_panel = tree.ensure({
		cwd = root_one,
		explorer_win = second_explorer,
		editor_win = function()
			return second_editor
		end,
	})

	t.truthy(first_panel ~= second_panel, "the same cwd in two tabs must own independent panels")
	t.eq(original_tab, vim.api.nvim_win_get_tabpage(first_panel))
	t.eq(second_tab, vim.api.nvim_win_get_tabpage(second_panel))

	local rebound_panel = tree.ensure({
		cwd = root_two,
		explorer_win = second_explorer,
		editor_win = function()
			return second_editor
		end,
	})
	t.eq(false, vim.api.nvim_win_is_valid(second_panel), "rebinding an Explorer root must close its old panel")
	t.truthy(rebound_panel ~= second_panel)
	t.eq(second_tab, vim.api.nvim_win_get_tabpage(rebound_panel))
	local rebound_buffer = vim.api.nvim_win_get_buf(rebound_panel)
	t.truthy(vim.api.nvim_buf_get_name(rebound_buffer):find(vim.fs.normalize(root_two), 1, true) ~= nil)
end, debug.traceback)

tree.close(root_one)
tree.close(root_two)
if second_tab and vim.api.nvim_tabpage_is_valid(second_tab) then
	vim.api.nvim_set_current_tabpage(second_tab)
	vim.cmd("tabclose")
end
if vim.api.nvim_tabpage_is_valid(original_tab) then
	vim.api.nvim_set_current_tabpage(original_tab)
end
base_diff.snapshot = original_snapshot
base_diff.error = original_error
base_diff.subscribe = original_subscribe
state.load = original_load
state.save = original_save
vim.fn.delete(root_one, "rf")
vim.fn.delete(root_two, "rf")

if not ok then
	error(err)
end
