local t = require("testlib")
local workspace = require("user.workspace")

local focused
local revealed
local opened = 0
local refreshes = 0
local focus_count = 0
local picker = {
	focus = function(_, target)
		focus_count = focus_count + 1
		focused = target
	end,
}
local adapter = {
	root = function()
		return "/repo"
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
		return "/repo/lua/init.lua"
	end,
	refresh_base_diff = function(cwd)
		t.eq("/repo", cwd)
		refreshes = refreshes + 1
	end,
	restore_explorer = function(cwd)
		t.eq("/repo", cwd)
	end,
}

workspace.ensure_explorer({ focus = false }, adapter)
t.eq(0, opened, "an existing Explorer must not be toggled closed")
t.eq(nil, focused, "background ensure must not move focus")
t.eq(1, refreshes)

workspace.focus_explorer(adapter)
t.eq("/repo/lua/init.lua", revealed)
t.eq("list", focused, "<leader>e must focus the Explorer list")
t.eq(1, focus_count, "Explorer focus must be restored only once after reveal")

local opened_opts
adapter.explorers = function()
	return {}
end
adapter.open_explorer = function(opts)
	opened_opts = opts
	return picker
end
focused = nil
focus_count = 0
workspace.ensure_explorer({ focus = false }, adapter)
t.eq(false, opened_opts.focus)
t.eq(false, opened_opts.enter)
t.eq(nil, focused, "opening Explorer in the background must not schedule focus restoration")
t.eq(0, focus_count)

local dock_calls = {}
local git_terminal = { hide = function() end }
local git_result = workspace.git_dock({
	root = function()
		return "/repo"
	end,
	dock = {
		prepare = function(_, name)
			dock_calls[#dock_calls + 1] = "prepare:" .. name
		end,
		activate = function(_, name, terminal)
			t.eq(git_terminal, terminal)
			dock_calls[#dock_calls + 1] = "activate:" .. name
		end,
	},
	lazygit = function(opts)
		t.eq("/repo", opts.cwd)
		return git_terminal
	end,
})
t.eq(git_terminal, git_result)
t.eq({ "prepare:git", "activate:git" }, dock_calls)
