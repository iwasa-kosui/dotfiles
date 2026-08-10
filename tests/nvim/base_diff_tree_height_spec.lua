local t = require("testlib")
local tree = require("user.base_diff_tree")

local function make_controller(available_height)
	local heights = {}
	local controller = tree.new({
		load_state = function()
			return { collapsed = false, height = 50, open_dirs = {} }
		end,
		available_height = function()
			return available_height
		end,
		create_panel = function(_, _, height)
			heights[#heights + 1] = height
			return 31, 41
		end,
		valid_win = function(win)
			return win == 31
		end,
		set_height = function(_, height)
			heights[#heights + 1] = height
		end,
		current_diff = function()
			return nil, nil
		end,
		subscribe_diff = function()
			return function() end
		end,
		render_buffer = function() end,
		set_keymaps = function() end,
		save_state = function() end,
		view = { close = function() end },
	})
	controller:ensure({ cwd = "/repo", explorer_win = 30, editor_win = function() end })
	return controller, heights
end

local bounded, bounded_heights = make_controller(12)
t.eq(7, bounded_heights[1], "saved height must leave four Explorer rows and one separator")
bounded:activate(1, "close")
t.eq(1, bounded_heights[#bounded_heights])
bounded:activate(1, "expand")
t.eq(7, bounded_heights[#bounded_heights], "expand must reuse the clamped height")

local tiny, tiny_heights = make_controller(8)
t.eq(1, tiny_heights[1], "a panel that cannot fit at minimum height must collapse")
tiny:activate(1, "expand")
t.eq(1, tiny_heights[#tiny_heights], "a forced one-line panel must not overflow on expand")

local original_tab = vim.api.nvim_get_current_tabpage()
local resize_tab
local resize_controller
local available_height = 8
local ok, err = xpcall(function()
	vim.cmd("tabnew")
	resize_tab = vim.api.nvim_get_current_tabpage()
	local explorer_win = vim.api.nvim_get_current_win()
	resize_controller = tree.new({
		load_state = function()
			return { collapsed = false, height = 6, open_dirs = {} }
		end,
		available_height = function()
			return available_height
		end,
		create_panel = function(_, _, height)
			vim.cmd("belowright new")
			local panel_win = vim.api.nvim_get_current_win()
			vim.api.nvim_win_set_height(panel_win, height)
			return panel_win, vim.api.nvim_get_current_buf()
		end,
		current_diff = function()
			return nil, nil
		end,
		subscribe_diff = function()
			return function() end
		end,
		render_buffer = function() end,
		set_keymaps = function() end,
		save_state = function() end,
		view = { close = function() end },
	})
	local panel_win =
		resize_controller:ensure({ cwd = "/repo", explorer_win = explorer_win, editor_win = function() end })
	t.eq(1, vim.api.nvim_win_get_height(panel_win))
	t.eq(false, resize_controller.state.collapsed, "temporary force collapse must not overwrite user intent")

	available_height = 14
	resize_controller:on_resized({ explorer_win, panel_win })
	t.eq(6, vim.api.nvim_win_get_height(panel_win), "growing must restore the persisted expanded intent")

	available_height = 8
	resize_controller:on_resized({ explorer_win, panel_win })
	t.eq(1, vim.api.nvim_win_get_height(panel_win), "shrinking must enforce a one-line panel")
	t.eq(false, resize_controller.state.collapsed)

	resize_controller:activate(1, "close")
	available_height = 14
	resize_controller:on_resized({ explorer_win, panel_win })
	t.eq(1, vim.api.nvim_win_get_height(panel_win), "growing must preserve explicit user collapse")
	resize_controller:activate(1, "expand")
	t.eq(6, vim.api.nvim_win_get_height(panel_win), "zo must re-enable the persisted expanded height")
end, debug.traceback)

if resize_controller then
	resize_controller:close()
end
if resize_tab and vim.api.nvim_tabpage_is_valid(resize_tab) then
	vim.api.nvim_set_current_tabpage(resize_tab)
	vim.cmd("tabclose")
end
if vim.api.nvim_tabpage_is_valid(original_tab) then
	vim.api.nvim_set_current_tabpage(original_tab)
end
if not ok then
	error(err)
end
