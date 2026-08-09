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
