local t = require("testlib")
local dock = require("user.dock").new()
local lazygit_dock = require("user.lazygit_dock")

local created = 0
local registered = {}
local pr_list_calls = 0
local discarded = 0
local scheduled = 0
local terminal = {
	buf = 51,
	live = true,
	show = function() end,
	focus = function()
		error("background startup must not focus LazyGit")
	end,
	hide = function() end,
	close = function(self, opts)
		discarded = discarded + 1
		t.eq({ buf = true }, opts)
		self.live = false
	end,
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
		terminal.on_close = opts.win.on_close
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
	schedule = function(callback)
		scheduled = scheduled + 1
		callback()
	end,
	discard_terminal = function(value)
		value:close({ buf = true })
	end,
	ensure_explorer = function() end,
	pr_list = function()
		pr_list_calls = pr_list_calls + 1
	end,
}

lazygit_dock.reset_for_tests()
local first = lazygit_dock.ensure({ focus = false }, adapter)
local second = lazygit_dock.ensure({ focus = false }, adapter)
t.eq(terminal, first)
t.eq(terminal, second)
t.eq(1, created, "startup ensure must run once per canonical root")
t.truthy(registered["t<leader>pp"])
registered["t<leader>pp"].rhs()
t.eq(1, pr_list_calls, "the terminal-local mapping must call the PR list boundary directly")
t.eq("<F12>", registered["t<leader>po"].rhs)
t.eq("q", registered["tq"].rhs(), "q must be forwarded after marking an explicit close")
t.eq("<C-c>", registered["t<C-c>"].rhs(), "Ctrl-c must keep LazyGit's alternate quit")
t.eq(true, registered["tq"].opts.expr)
t.eq(terminal, dock.active.handle)

lazygit_dock.open({ focus = false }, adapter)

terminal.cleanup({ event = "TermClose" })
t.eq(1, scheduled, "terminal death must defer Snacks window destruction")
t.eq(1, discarded, "terminal death must destroy the dead window and buffer")
t.eq(nil, dock.active, "a dead default terminal must leave no dead Dock surface")
t.eq(true, dock.default.enabled, "unexpected process death must keep fallback restoration enabled")

local post_exit = {
	buf = 53,
	live = true,
	show = function() end,
	hide = function() end,
}
adapter.lazygit = function(opts)
	created = created + 1
	post_exit.on_close = opts.win.on_close
	return post_exit
end
local after_exit = lazygit_dock.open({ focus = false }, adapter)
t.eq(post_exit, after_exit)
t.eq(2, created, "reopening after terminal death must invoke a fresh terminal factory")
post_exit.on_close(post_exit)
t.eq(nil, dock.active, "normal-mode q/window close must remove the LazyGit Dock surface")
dock:restore_default()
t.eq(nil, dock.active, "an explicit LazyGit window close must disable automatic restoration")
lazygit_dock.open({ focus = false }, adapter)
t.eq(post_exit, dock.active.handle, "manual reopen must re-enable the existing live LazyGit terminal")

lazygit_dock.reset_for_tests()
adapter.has_ui = function()
	return false
end
t.eq(nil, lazygit_dock.ensure({ focus = false }, adapter))
t.eq(2, created, "headless ensure must not create another terminal")

lazygit_dock.reset_for_tests()
adapter.has_ui = function()
	return true
end
adapter.executable = function()
	return false
end
t.eq(nil, lazygit_dock.ensure({ focus = false }, adapter))
t.eq(2, created, "missing LazyGit must not create a terminal")

lazygit_dock.reset_for_tests()
adapter.executable = function()
	return true
end
adapter.is_git_repo = function()
	return false
end
t.eq(nil, lazygit_dock.ensure({ focus = false }, adapter))
t.eq(2, created, "non-git roots must not create a terminal")

local function assert_open_skips(label, configure)
	lazygit_dock.reset_for_tests()
	configure()
	local before = created
	t.eq(nil, lazygit_dock.open({ focus = false }, adapter))
	t.eq(before, created, label)
end

assert_open_skips("manual open must not create a terminal without a UI", function()
	adapter.has_ui = function()
		return false
	end
	adapter.executable = function()
		return true
	end
	adapter.is_git_repo = function()
		return true
	end
end)
assert_open_skips("manual open must not create a terminal without LazyGit", function()
	adapter.has_ui = function()
		return true
	end
	adapter.executable = function()
		return false
	end
	adapter.is_git_repo = function()
		return true
	end
end)
assert_open_skips("manual open must not create a terminal outside Git", function()
	adapter.has_ui = function()
		return true
	end
	adapter.executable = function()
		return true
	end
	adapter.is_git_repo = function()
		return false
	end
end)

lazygit_dock.reset_for_tests()
adapter.is_git_repo = function()
	return true
end
post_exit.live = false
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
t.eq(3, created, "opening a dead terminal must create a replacement")
