local t = require("testlib")
local tree = require("user.base_diff_tree")

local original_tab = vim.api.nvim_get_current_tabpage()
local scratch_tab

local ok, err = xpcall(function()
	vim.cmd("tabnew")
	scratch_tab = vim.api.nvim_get_current_tabpage()
	local editor_win = vim.api.nvim_get_current_win()
	vim.cmd("topleft vsplit")
	local host_win = vim.api.nvim_get_current_win()
	vim.api.nvim_win_set_width(host_win, 32)
	local editor_width = vim.api.nvim_win_get_width(editor_win)
	local list_win = vim.api.nvim_open_win(vim.api.nvim_create_buf(false, true), false, {
		relative = "win",
		win = host_win,
		row = 0,
		col = 0,
		width = 32,
		height = 10,
		style = "minimal",
	})

	local real = tree.new()
	t.eq(host_win, real.adapter.column_host(list_win), "a floating Explorer must resolve to the window owning the column")
	t.eq(host_win, real.adapter.column_host(host_win), "a split Explorer must stay its own host")
	t.eq(30, real.adapter.column_host(30), "an unknown window id must be returned unchanged")

	local panel_win, buf = real.adapter.create_panel(host_win, "/repo", 6)
	t.eq("", tostring(vim.api.nvim_win_get_config(panel_win).relative), "the panel must be a normal split")
	t.eq("BaseDiffTree", vim.bo[buf].filetype)
	t.eq(6, vim.api.nvim_win_get_height(panel_win))
	t.eq(
		vim.api.nvim_win_get_width(host_win),
		vim.api.nvim_win_get_width(panel_win),
		"the panel must share the Explorer column width"
	)
	t.eq(
		vim.fn.win_screenpos(host_win)[2],
		vim.fn.win_screenpos(panel_win)[2],
		"the panel must start at the Explorer column"
	)
	t.truthy(
		vim.fn.win_screenpos(panel_win)[1] > vim.fn.win_screenpos(host_win)[1],
		"the panel must sit below the Explorer"
	)
	t.eq(editor_width, vim.api.nvim_win_get_width(editor_win), "the Editor Group must keep its width")
	vim.api.nvim_win_close(panel_win, true)

	local hosts = {}
	local refits = 0
	local controller = tree.new({
		load_state = function()
			return { collapsed = false, height = 6, open_dirs = {} }
		end,
		create_panel = function(host, _, height)
			hosts[#hosts + 1] = host
			return 31, 41, height
		end,
		valid_win = function(win)
			return win == 31 or (type(win) == "number" and vim.api.nvim_win_is_valid(win))
		end,
		set_height = function() end,
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
	controller:ensure({
		cwd = "/repo",
		explorer_win = list_win,
		editor_win = function() end,
		refit_explorer = function()
			refits = refits + 1
		end,
	})
	t.eq({ host_win }, hosts, "the panel must be created from the window owning the Explorer column")
	t.truthy(refits > 0, "creating the panel must refit the Explorer layout")

	local before_collapse = refits
	controller:activate(1, "close")
	t.truthy(refits > before_collapse, "changing the panel height must refit the Explorer layout")
	controller:close()
end, debug.traceback)

if scratch_tab and vim.api.nvim_tabpage_is_valid(scratch_tab) then
	vim.api.nvim_set_current_tabpage(scratch_tab)
	vim.cmd("tabclose")
end
if vim.api.nvim_tabpage_is_valid(original_tab) then
	vim.api.nvim_set_current_tabpage(original_tab)
end
if not ok then
	error(err)
end
