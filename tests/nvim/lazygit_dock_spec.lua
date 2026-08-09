local t = require("testlib")
local dock = require("user.dock").new()
local lazygit_dock = require("user.lazygit_dock")

local created = 0
local registered = {}
local terminal = {
	buf = 51,
	live = true,
	show = function() end,
	focus = function()
		error("background startup must not focus LazyGit")
	end,
	hide = function() end,
}
local adapter = {
	root = function()
		return "/repo/.wt/feature"
	end,
	has_ui = function()
		return true
	end,
	executable = function()
		return true
	end,
	is_git_repo = function(path)
		t.eq("/repo/.wt/feature", path)
		return true
	end,
	dock = dock,
	lazygit = function(opts)
		created = created + 1
		t.eq("/repo/.wt/feature", opts.cwd)
		t.eq("right", opts.win.position)
		t.eq(0.36, opts.win.width)
		t.eq(false, opts.win.enter)
		return terminal
	end,
	terminal_live = function(value)
		return value.live
	end,
	set_keymap = function(mode, lhs, rhs, opts)
		registered[mode .. lhs] = { rhs = rhs, opts = opts }
	end,
	register_cleanup = function(_, callback)
		terminal.cleanup = callback
	end,
	ensure_explorer = function() end,
}

lazygit_dock.reset_for_tests()
local first = lazygit_dock.ensure({ focus = false }, adapter)
local second = lazygit_dock.ensure({ focus = false }, adapter)
t.eq(terminal, first)
t.eq(terminal, second)
t.eq(1, created, "startup ensure must run once per canonical root")
t.truthy(registered["t<leader>pp"])
t.eq("<F12>", registered["t<leader>po"].rhs)
t.eq("q", registered["tq"].rhs(), "q must be forwarded after marking an explicit close")
t.eq("<C-c>", registered["t<C-c>"].rhs(), "Ctrl-c must keep LazyGit's alternate quit")
t.eq(true, registered["tq"].opts.expr)
t.eq(terminal, dock.active.handle)

lazygit_dock.reset_for_tests()
adapter.has_ui = function()
	return false
end
t.eq(nil, lazygit_dock.ensure({ focus = false }, adapter))
t.eq(1, created, "headless ensure must not create another terminal")

lazygit_dock.reset_for_tests()
adapter.has_ui = function()
	return true
end
adapter.executable = function()
	return false
end
t.eq(nil, lazygit_dock.ensure({ focus = false }, adapter))
t.eq(1, created, "missing LazyGit must not create a terminal")

lazygit_dock.reset_for_tests()
adapter.executable = function()
	return true
end
adapter.is_git_repo = function()
	return false
end
t.eq(nil, lazygit_dock.ensure({ focus = false }, adapter))
t.eq(1, created, "non-git roots must not create a terminal")

lazygit_dock.reset_for_tests()
adapter.is_git_repo = function()
	return true
end
terminal.live = false
local replacement = {
	buf = 52,
	live = true,
	show = function() end,
	hide = function() end,
}
adapter.lazygit = function()
	created = created + 1
	return replacement
end
local reopened = lazygit_dock.open({ focus = false }, adapter)
t.eq(replacement, reopened)
t.eq(2, created, "opening a dead terminal must create a replacement")
