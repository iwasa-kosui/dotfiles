local t = require("testlib")
local base_diff = require("user.base_diff")
local state = require("user.base_diff_state")
local tree = require("user.base_diff_tree")
local workspace = require("user.workspace")

local root = vim.fn.getcwd()
local paths = { "AGENTS.md", "Brewfile", "dot_gitconfig" }
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
		return {
			cwd = root,
			base_name = "main",
			merge_base = "HEAD",
			changes = vim.tbl_map(function(path)
				return { status = "M", path = path }
			end, paths),
		}
	end
	base_diff.error = function() end
	base_diff.subscribe = function()
		return function() end
	end
	state.load = function()
		return { collapsed = false, height = 6, open_dirs = {} }
	end
	state.save = function() end

	vim.cmd("tabnew")
	test_tab = vim.api.nvim_get_current_tabpage()
	local editor_win = vim.api.nvim_get_current_win()
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

	local owned_pair
	local owned_window_count
	for index, path in ipairs(paths) do
		controller:activate(index + 1, "default")
		t.truthy(
			vim.wait(2000, function()
				local pair = controller.view:pair()
				return pair
					and vim.api.nvim_win_is_valid(pair.right)
					and vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(pair.right))
						== vim.fs.normalize(root .. "/" .. path)
			end),
			"selection must open the requested owned diff: " .. path
		)
		local pair = controller.view:pair()
		if index == 1 then
			owned_pair = { left = pair.left, right = pair.right }
			owned_window_count = #vim.api.nvim_tabpage_list_wins(test_tab)
		else
			t.eq(
				owned_pair,
				{ left = pair.left, right = pair.right },
				"successive selections must reuse the owned pair"
			)
			t.eq(
				owned_window_count,
				#vim.api.nvim_tabpage_list_wins(test_tab),
				"successive selections must not create unused Editor Groups"
			)
		end
	end

	local diff_windows = vim.tbl_filter(function(win)
		return vim.wo[win].diff
	end, vim.api.nvim_tabpage_list_wins(test_tab))
	t.eq(2, #diff_windows, "the controller must own exactly one two-pane diff")
	t.eq(true, vim.wo[editor_win].diff)
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
