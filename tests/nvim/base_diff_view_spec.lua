local t = require("testlib")
local view = require("user.base_diff_view")

local snapshot = { cwd = "/repo", merge_base = "abc123" }

t.eq({
	left = { kind = "empty", label = "base: new.lua" },
	right = { kind = "file", path = "/repo/new.lua" },
	pathspecs = { "new.lua" },
}, view.plan(snapshot, { status = "A", path = "new.lua" }))

t.eq({
	left = { kind = "git", rev = "abc123", path = "edit.lua" },
	right = { kind = "file", path = "/repo/edit.lua" },
	pathspecs = { "edit.lua" },
}, view.plan(snapshot, { status = "M", path = "edit.lua" }))

t.eq({
	left = { kind = "git", rev = "abc123", path = "old.lua" },
	right = { kind = "file", path = "/repo/new.lua" },
	pathspecs = { "old.lua", "new.lua" },
}, view.plan(snapshot, { status = "R", path = "new.lua", old_path = "old.lua" }))

t.eq({
	left = { kind = "git", rev = "abc123", path = "gone.lua" },
	right = { kind = "empty", label = "worktree: gone.lua" },
	pathspecs = { "gone.lua" },
}, view.plan(snapshot, { status = "D", path = "gone.lua" }))

local calls = {}
local cleared = {}
local pair = { left = 10, right = 11 }
local adapter = {
	check_binary = function(_, _, _, callback)
		callback(false, nil)
	end,
	load_git = function(source, _, callback)
		calls[#calls + 1] = { kind = "load", source = source }
		callback({ "base line" }, nil)
	end,
	show = function(plan, left_lines, target_win, previous)
		calls[#calls + 1] = {
			kind = "show",
			plan = plan,
			left_lines = left_lines,
			target_win = target_win,
			previous = previous,
		}
		return pair
	end,
	valid_pair = function(value)
		return value == pair
	end,
	clear_diff = function(win)
		cleared[#cleared + 1] = win
	end,
	notify = function(message)
		calls[#calls + 1] = { kind = "notify", message = message }
	end,
}

local controller = view.new(adapter)
controller:open({ cwd = "/repo", merge_base = "abc123" }, { status = "M", path = "edit.lua" }, 20)
controller:open({ cwd = "/repo", merge_base = "abc123" }, { status = "A", path = "new.lua" }, 20)
t.eq(pair, calls[#calls].previous)

controller:on_win_closed(10)
t.eq({ 11 }, cleared)
t.eq(nil, controller:pair())

local binary_show_count = 0
local binary_message
local binary_controller = view.new({
	check_binary = function(_, _, _, callback)
		callback(true, nil)
	end,
	load_git = function(_, _, callback)
		callback({ "ignored" }, nil)
	end,
	show = function()
		binary_show_count = binary_show_count + 1
	end,
	valid_pair = function()
		return false
	end,
	clear_diff = function() end,
	notify = function(message)
		binary_message = message
	end,
})
binary_controller:open(snapshot, { status = "A", path = "image.bin" }, 20)
t.eq(0, binary_show_count)
t.truthy(binary_message:find("LazyGit", 1, true) ~= nil)

local load_error_message
local load_error_controller = view.new({
	check_binary = function(_, _, _, callback)
		callback(false, nil)
	end,
	load_git = function(_, _, callback)
		callback(nil, "base blob not found")
	end,
	show = function()
		error("show must not run after a blob load failure")
	end,
	valid_pair = function()
		return false
	end,
	clear_diff = function() end,
	notify = function(message)
		load_error_message = message
	end,
})
load_error_controller:open(snapshot, { status = "D", path = "gone.lua" }, 20)
t.truthy(load_error_message:find("base blob not found", 1, true) ~= nil)
