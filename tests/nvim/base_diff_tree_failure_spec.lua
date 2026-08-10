local t = require("testlib")
local tree = require("user.base_diff_tree")

local panel_win
local unsubscribed = 0
local controller = tree.new({
	load_state = function()
		return { collapsed = false, height = 8, open_dirs = {} }
	end,
	available_height = function()
		return 24
	end,
	create_panel = function()
		vim.cmd("belowright 8new")
		panel_win = vim.api.nvim_get_current_win()
		return panel_win, vim.api.nvim_get_current_buf()
	end,
	current_diff = function()
		return { cwd = "/repo", base_name = "main", changes = {} }
	end,
	subscribe_diff = function()
		return function()
			unsubscribed = unsubscribed + 1
		end
	end,
	render_buffer = function()
		error("injected render failure")
	end,
	set_keymaps = function() end,
	view = { close = function() end },
})

local ok, error = pcall(controller.ensure, controller, {
	cwd = "/repo",
	explorer_win = vim.api.nvim_get_current_win(),
	editor_win = function() end,
})
t.eq(false, ok)
t.truthy(tostring(error):find("injected render failure", 1, true) ~= nil)
t.eq(false, vim.api.nvim_win_is_valid(panel_win), "a partially initialized panel window must be closed")
t.eq(1, unsubscribed, "a partial diff subscription must be removed")
