local t = require("testlib")
local base_diff = require("user.base_diff")
local state = require("user.base_diff_state")
local tree = require("user.base_diff_tree")
local workspace = require("user.workspace")

local root = vim.fn.getcwd()
local path = "AGENTS.md"
local original_snapshot = base_diff.snapshot
local original_error = base_diff.error
local original_subscribe = base_diff.subscribe
local original_load = state.load
local original_save = state.save
local original_tab = vim.api.nvim_get_current_tabpage()
local test_tab
local controller

local ok, err = xpcall(function()
	base_diff.snapshot = function()
		return { cwd = root, base_name = "main", changes = { { status = "M", path = path } } }
	end
	base_diff.error = function() end
	base_diff.subscribe = function()
		return function() end
	end
	state.load = function()
		return { collapsed = false, height = 4, open_dirs = {} }
	end
	state.save = function() end

	vim.cmd("tabnew")
	test_tab = vim.api.nvim_get_current_tabpage()
	local manual_left = vim.api.nvim_get_current_win()
	local manual_left_buffer = vim.api.nvim_create_buf(false, false)
	vim.api.nvim_buf_set_lines(manual_left_buffer, 0, -1, false, { "manual left" })
	vim.api.nvim_win_set_buf(manual_left, manual_left_buffer)

	vim.cmd("vsplit")
	local manual_right = vim.api.nvim_get_current_win()
	local manual_right_buffer = vim.api.nvim_create_buf(false, false)
	vim.api.nvim_buf_set_lines(manual_right_buffer, 0, -1, false, { "manual right" })
	vim.api.nvim_win_set_buf(manual_right, manual_right_buffer)
	for _, win in ipairs({ manual_left, manual_right }) do
		vim.api.nvim_win_call(win, function()
			vim.cmd("diffthis")
		end)
	end

	vim.cmd("vsplit")
	local explorer_win = vim.api.nvim_get_current_win()
	local explorer_buffer = vim.api.nvim_create_buf(false, true)
	vim.api.nvim_win_set_buf(explorer_win, explorer_buffer)
	vim.bo[explorer_buffer].buftype = "nofile"
	vim.bo[explorer_buffer].filetype = "snacks_picker_list"

	controller = tree.new()
	controller:ensure({
		cwd = root,
		explorer_win = explorer_win,
		editor_win = function()
			return workspace.editor_win()
		end,
	})
	controller:activate(2, "open")

	t.eq(true, vim.wo[manual_left].diff, "o must preserve the left manual diff")
	t.eq(true, vim.wo[manual_right].diff, "o must preserve the right manual diff")
	t.eq(manual_left_buffer, vim.api.nvim_win_get_buf(manual_left))
	t.eq(manual_right_buffer, vim.api.nvim_win_get_buf(manual_right))

	local normal_target
	for _, win in ipairs(vim.api.nvim_tabpage_list_wins(test_tab)) do
		local name = vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(win))
		if name == vim.fs.normalize(root .. "/" .. path) then
			normal_target = win
		end
	end
	t.truthy(normal_target ~= nil, "o must create a normal Editor Group when only manual diffs exist")
	t.truthy(normal_target ~= manual_left and normal_target ~= manual_right)
	t.eq(false, vim.wo[normal_target].diff)
end, debug.traceback)

if controller then
	controller:close()
end
if test_tab and vim.api.nvim_tabpage_is_valid(test_tab) then
	vim.api.nvim_set_current_tabpage(test_tab)
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

if not ok then
	error(err)
end
