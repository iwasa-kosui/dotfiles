local t = require("testlib")
local tree = require("user.base_diff_tree")

local snapshot = {
	cwd = "/repo",
	base_ref = "origin/main",
	base_name = "main",
	merge_base = "abc123",
	changes = {
		{ status = "M", path = "lua/user/base_diff.lua" },
		{ status = "A", path = "lua/user/base_diff_tree.lua" },
		{ status = "R", path = "tests/new_spec.lua", old_path = "tests/old_spec.lua" },
		{ status = "D", path = "docs/old.md" },
	},
}

local rendered = tree.render(snapshot, {
	collapsed = false,
	height = 12,
	open_dirs = { "lua", "lua/user", "tests" },
})

t.eq({
	"⌄ BASE CHANGES · main · 4",
	"  ▸ docs",
	"  ⌄ lua",
	"    ⌄ user",
	"      M base_diff.lua",
	"      A base_diff_tree.lua",
	"  ⌄ tests",
	"      R new_spec.lua ← old_spec.lua",
}, rendered.lines)
t.eq("lua/user/base_diff.lua", rendered.items[5].path)
t.eq({ "docs", "lua", "lua/user", "tests" }, rendered.valid_open_dirs)

local collapsed = tree.render(snapshot, { collapsed = true, height = 12, open_dirs = {} })
t.eq({ "▸ BASE CHANGES · main · 4" }, collapsed.lines)
t.eq({ "docs", "lua", "lua/user", "tests" }, collapsed.valid_open_dirs)

local empty = tree.render({ cwd = "/repo", base_name = "main", changes = {} }, {
	collapsed = false,
	height = 8,
	open_dirs = {},
})
t.eq({ "⌄ BASE CHANGES · main · 0", "  No base changes" }, empty.lines)

local unavailable = tree.render(nil, { collapsed = false, height = 8, open_dirs = {} }, "no merge base")
t.eq({ "⌄ BASE CHANGES · unavailable", "  no merge base" }, unavailable.lines)

local stale = tree.render(snapshot, {
	collapsed = false,
	height = 8,
	open_dirs = {},
}, "refresh failed")
t.eq("⌄ BASE CHANGES · main · 4 !", stale.lines[1])

local saved
local created = 0
local heights = {}
local opened
local subscriber
local render_count = 0
local fake_view = {
	open = function(_, snapshot_value, change, target)
		opened = { snapshot = snapshot_value, change = change, target = target }
	end,
}
local adapter
adapter = {
	load_state = function()
		return { collapsed = false, height = 10, open_dirs = { "lua", "lua/user" } }
	end,
	save_state = function(_, value)
		saved = vim.deepcopy(value)
	end,
	create_panel = function(_, _, height)
		created = created + 1
		heights[#heights + 1] = height
		return 31, 41
	end,
	valid_win = function(win)
		return win == 31
	end,
	available_height = function()
		return 24
	end,
	set_height = function(_, height)
		heights[#heights + 1] = height
	end,
	render_buffer = function(_, value)
		render_count = render_count + 1
		adapter.last_render = value
	end,
	set_keymaps = function() end,
	close_win = function() end,
	current_diff = function()
		return nil, nil
	end,
	subscribe_diff = function(_, callback)
		subscriber = callback
		return function() end
	end,
	refresh_diff = function() end,
	open_file = function(path, target, callback)
		adapter.opened_file = { path = path, target = target }
		callback(true)
	end,
	notify = function(message)
		adapter.notification = message
	end,
	view = fake_view,
}

local controller = tree.new(adapter)
controller:ensure({
	cwd = "/repo",
	explorer_win = 30,
	editor_win = function()
		return 50
	end,
})
controller:ensure({
	cwd = "/repo",
	explorer_win = 30,
	editor_win = function()
		return 50
	end,
})
t.eq(1, created, "ensure must reuse the existing panel")

controller:activate(1, "default")
t.eq({ "lua", "lua/user" }, saved.open_dirs, "collapse before the first snapshot must preserve open directories")
controller:activate(1, "default")
t.eq({ "lua", "lua/user" }, saved.open_dirs, "expand before the first snapshot must preserve open directories")

controller:update(snapshot)
controller:activate(1, "default")
t.eq(true, saved.collapsed)
t.eq(1, heights[#heights])
controller:activate(1, "default")
t.eq(false, saved.collapsed)
t.eq(10, heights[#heights])

controller:activate(5, "default")
t.eq("lua/user/base_diff.lua", opened.change.path)
t.eq(50, opened.target)

controller:activate(5, "open")
t.eq({ path = "/repo/lua/user/base_diff.lua", target = 50 }, adapter.opened_file)

controller:activate(4, "default")
t.eq({ "lua" }, saved.open_dirs)

controller:activate(2, "default")
controller:activate(3, "open")
t.eq("Deleted file can only be opened as a diff", adapter.notification)

local render_count_before_close = render_count
controller:close()
subscriber(snapshot, nil)
t.eq(render_count_before_close, render_count, "a queued subscriber callback after close must be a no-op")
