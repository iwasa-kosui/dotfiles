local t = require("testlib")
local explorer_state = require("user.explorer_state")
local workspace = require("user.workspace")

local state_dir = vim.fn.tempname()
vim.fn.mkdir(state_dir, "p")
local state_adapter = { path = state_dir .. "/explorer.json" }
explorer_state.save("/workspace-repo", { "/workspace-repo/lua" }, state_adapter)

local focused
local revealed
local opened = 0
local refreshes = 0
local focus_count = 0
local restore_count = 0
local track_count = 0
local ensured_panels = {}
local picker = {
	list = { win = { win = 30 } },
	focus = function(_, target)
		focus_count = focus_count + 1
		focused = target
	end,
}
local adapter = {
	root = function()
		return "/workspace-repo"
	end,
	explorers = function()
		return { picker }
	end,
	open_explorer = function()
		opened = opened + 1
		return picker
	end,
	reveal = function(opts)
		revealed = opts.file
		return picker
	end,
	current_file = function()
		return "/workspace-repo/lua/init.lua"
	end,
	refresh_base_diff = function(cwd)
		t.eq("/workspace-repo", cwd)
		refreshes = refreshes + 1
	end,
	ensure_base_diff = function(opts)
		ensured_panels[#ensured_panels + 1] = opts
	end,
	valid_win = function(win)
		return win == 30 or win == 31
	end,
	restore_explorer = function(cwd)
		t.eq("/workspace-repo", cwd)
		explorer_state.restore_once(cwd, {
			open = function()
				restore_count = restore_count + 1
			end,
		}, state_adapter)
	end,
	track_explorer = function(cwd)
		t.eq("/workspace-repo", cwd)
		track_count = track_count + 1
	end,
}

workspace.ensure_explorer({ focus = false }, adapter)
t.eq(0, opened, "an existing Explorer must not be toggled closed")
t.eq(nil, focused, "background ensure must not move focus")
t.eq(1, #ensured_panels)
t.eq("/workspace-repo", ensured_panels[1].cwd)
t.eq(30, ensured_panels[1].explorer_win)
t.truthy(type(ensured_panels[1].editor_win) == "function")
t.eq(1, refreshes)
t.eq(1, restore_count, "an existing Explorer must restore persisted state")
t.eq(1, track_count, "an existing Explorer must be tracked for persistence")

workspace.focus_explorer(adapter)
t.eq("/workspace-repo/lua/init.lua", revealed)
t.eq("list", focused, "<leader>e must focus the Explorer list")
t.eq(1, focus_count, "Explorer focus must be restored only once after reveal")
t.eq(1, restore_count, "repeated ensure must not replay persisted expansion state")
t.eq(2, track_count, "repeated ensure must keep the canonical root tracked")

local opened_opts
local pending_picker = {
	list = { win = { win = nil } },
	opts = {},
	focus = picker.focus,
}
local pending_picker_opened = false
adapter.explorers = function()
	return pending_picker_opened and { pending_picker } or {}
end
adapter.open_explorer = function(opts)
	opened_opts = opts
	pending_picker_opened = true
	return pending_picker
end
focused = nil
focus_count = 0
ensured_panels = {}
local refreshes_before_pending = refreshes
workspace.ensure_explorer({ focus = false }, adapter)
t.eq(false, opened_opts.focus)
t.eq(false, opened_opts.enter)
t.eq(nil, focused, "opening Explorer in the background must not schedule focus restoration")
t.eq(0, focus_count)
t.eq(1, restore_count, "opening a replacement picker must not restore the same root twice")
t.eq(3, track_count)
t.eq(0, #ensured_panels, "new Explorer must wait for a valid list window")
t.eq(refreshes_before_pending, refreshes, "base refresh must wait until the panel can subscribe")

workspace.ensure_explorer({ focus = false }, adapter)
pending_picker.list.win.win = 31
pending_picker.opts.on_show(pending_picker)
pending_picker.opts.on_show(pending_picker)
t.eq(1, #ensured_panels, "new Explorer must ensure the panel exactly once when shown")
t.eq(31, ensured_panels[1].explorer_win)
t.eq(refreshes_before_pending + 1, refreshes, "panel subscription must precede one base refresh")
t.eq(nil, focused, "deferred panel creation must not move focus")
t.eq(0, focus_count)

local closed_picker = { list = { win = { win = nil } }, opts = {} }
local closed_panels = 0
local closed_refreshes = 0
workspace.ensure_explorer({ focus = false }, {
	root = function()
		return "/closed-repo"
	end,
	explorers = function()
		return { closed_picker }
	end,
	track_explorer = function() end,
	restore_explorer = function() end,
	valid_win = function(win)
		return win == 32
	end,
	ensure_base_diff = function()
		closed_panels = closed_panels + 1
	end,
	refresh_base_diff = function()
		closed_refreshes = closed_refreshes + 1
	end,
})
closed_picker.closed = true
closed_picker.list.win.win = 32
closed_picker.opts.on_show(closed_picker)
t.eq(0, closed_panels, "closed Explorer must not create a deferred panel")
t.eq(0, closed_refreshes, "closed Explorer must not start a deferred refresh")

local git_terminal = { hide = function() end }
local delegated
local git_result = workspace.git_dock({ focus = true }, {
	lazygit_dock = {
		open = function(opts)
			delegated = opts
			return git_terminal
		end,
	},
})
t.eq({ focus = true }, delegated)
t.eq(git_terminal, git_result)

local windows = {
	[40] = { valid = true, tab = 1, buftype = "", filetype = "lua", relative = "" },
	[41] = { valid = true, tab = 1, buftype = "nofile", filetype = "BaseDiffTree", relative = "" },
	[42] = { valid = true, tab = 1, buftype = "terminal", filetype = "", relative = "" },
	[43] = { valid = true, tab = 1, buftype = "", filetype = "snacks_picker_list", relative = "" },
	[44] = { valid = true, tab = 1, buftype = "", filetype = "BaseDiffTree", relative = "" },
	[45] = { valid = true, tab = 1, buftype = "", filetype = "lua", relative = "editor" },
}
local win_adapter = {
	current_win = function()
		return 40
	end,
	current_tab = function()
		return 1
	end,
	window_info = function(win)
		return windows[win]
	end,
	tab_windows = function()
		return { 41, 42, 40 }
	end,
}
t.eq(true, workspace.remember_editor(40, win_adapter))
t.eq(false, workspace.remember_editor(41, win_adapter))
t.eq(false, workspace.remember_editor(42, win_adapter), "terminal must not be remembered as an Editor Group")
t.eq(false, workspace.remember_editor(43, win_adapter), "Snacks list must not be remembered as an Editor Group")
t.eq(false, workspace.remember_editor(44, win_adapter), "BaseDiffTree must be excluded independently of buftype")
t.eq(false, workspace.remember_editor(45, win_adapter), "floating windows must not be remembered as an Editor Group")
t.eq(40, workspace.editor_win(win_adapter))

local fallback_windows = {
	[50] = { valid = false, tab = 2, buftype = "", filetype = "lua", relative = "" },
	[51] = { valid = true, tab = 2, buftype = "nofile", filetype = "BaseDiffTree", relative = "" },
	[52] = { valid = true, tab = 2, buftype = "", filetype = "lua", relative = "" },
}
local fallback_adapter = {
	current_tab = function()
		return 2
	end,
	window_info = function(win)
		return fallback_windows[win]
	end,
	tab_windows = function()
		return { 50, 51, 52 }
	end,
}
t.eq(52, workspace.editor_win(fallback_adapter), "first normal window must be used when none is remembered")

local invalid_remembered_windows = {
	[60] = { valid = true, tab = 3, buftype = "", filetype = "lua", relative = "" },
	[61] = { valid = true, tab = 3, buftype = "", filetype = "lua", relative = "" },
}
local invalid_remembered_adapter = {
	current_tab = function()
		return 3
	end,
	window_info = function(win)
		return invalid_remembered_windows[win]
	end,
	tab_windows = function()
		return { 61 }
	end,
}
t.eq(true, workspace.remember_editor(60, invalid_remembered_adapter))
invalid_remembered_windows[60].valid = false
t.eq(61, workspace.editor_win(invalid_remembered_adapter), "invalid remembered window must fall back within its tab")

local empty_adapter = {
	current_tab = function()
		return 4
	end,
	window_info = function()
		return nil
	end,
	tab_windows = function()
		return { 70 }
	end,
}
t.eq(nil, workspace.editor_win(empty_adapter), "missing Editor Group must return nil")

local current_tab = 5
local tabbed_windows = {
	[80] = { valid = true, tab = 5, buftype = "", filetype = "lua", relative = "" },
	[81] = { valid = true, tab = 6, buftype = "", filetype = "lua", relative = "" },
}
local tabbed_adapter = {
	current_tab = function()
		return current_tab
	end,
	window_info = function(win)
		return tabbed_windows[win]
	end,
	tab_windows = function(tab)
		return tab == 5 and { 80 } or { 80, 81 }
	end,
}
t.eq(true, workspace.remember_editor(80, tabbed_adapter))
current_tab = 6
t.eq(false, workspace.remember_editor(80, tabbed_adapter), "another tab's window must not be remembered")
t.eq(81, workspace.editor_win(tabbed_adapter), "fallback must ignore normal windows from another tab")
current_tab = 5
t.eq(80, workspace.editor_win(tabbed_adapter), "remembered Editor Group must be scoped by tab")

vim.fn.delete(state_dir, "rf")
