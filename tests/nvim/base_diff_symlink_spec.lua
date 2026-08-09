local t = require("testlib")
local base_diff = require("user.base_diff")
local state = require("user.base_diff_state")
local tree = require("user.base_diff_tree")
local view = require("user.base_diff_view")

local root = vim.fn.tempname()
local outside = vim.fn.tempname()
vim.fn.mkdir(root, "p")
vim.fn.mkdir(outside, "p")

local function write(path, content)
	local fd = assert(vim.uv.fs_open(path, "w", 420))
	assert(vim.uv.fs_write(fd, content, 0))
	assert(vim.uv.fs_close(fd))
end

local function git(args)
	local command = vim.list_extend({ "git" }, args)
	local result = vim.system(command, { cwd = root, text = true }):wait()
	t.eq(0, result.code, result.stderr)
end

local old_target = outside .. "/old-target.txt"
local new_target = outside .. "/new-target.txt"
local link_path = root .. "/linked.txt"
write(old_target, "old target content\n")
write(new_target, "new target content\n")
git({ "init", "-b", "fixture-base" })
git({ "config", "user.name", "Smoke" })
git({ "config", "user.email", "smoke@example.invalid" })
assert(vim.uv.fs_symlink(old_target, link_path))
git({ "add", "linked.txt" })
git({ "commit", "-m", "base" })
assert(vim.uv.fs_unlink(link_path))
assert(vim.uv.fs_symlink(new_target, link_path))

local target_win = vim.api.nvim_get_current_win()
local original_buffer = vim.api.nvim_win_get_buf(target_win)
local view_controller
local tree_controller
local explorer_win
local original_snapshot = base_diff.snapshot
local original_error = base_diff.error
local original_subscribe = base_diff.subscribe
local original_load = state.load
local original_save = state.save

local function assert_symlink_scratch(buffer, context)
	t.eq("nofile", vim.bo[buffer].buftype, context .. " must use a scratch buffer")
	t.eq(false, vim.bo[buffer].modifiable, context .. " must be read-only")
	t.eq({ new_target }, vim.api.nvim_buf_get_lines(buffer, 0, -1, false))
	local changed = pcall(vim.api.nvim_buf_set_lines, buffer, 0, -1, false, { "mutated" })
	t.eq(false, changed, context .. " must reject edits")
	t.eq({ "new target content" }, vim.fn.readfile(new_target), context .. " must not mutate the symlink target")
end

local ok, err = xpcall(function()
	view_controller = view.new()
	view_controller:open({ cwd = root, merge_base = "HEAD" }, { status = "M", path = "linked.txt" }, target_win)
	t.truthy(
		vim.wait(2000, function()
			return view_controller:pair() ~= nil
		end),
		"symlink diff must open"
	)
	local pair = view_controller:pair()
	assert_symlink_scratch(vim.api.nvim_win_get_buf(pair.right), "symlink diff right side")
	view_controller:close()

	base_diff.snapshot = function()
		return {
			cwd = root,
			base_name = "main",
			merge_base = "HEAD",
			changes = { { status = "M", path = "linked.txt" } },
		}
	end
	base_diff.error = function() end
	base_diff.subscribe = function()
		return function() end
	end
	state.load = function()
		return { collapsed = false, height = 4, open_dirs = {} }
	end
	state.save = function() end

	vim.cmd("vsplit")
	explorer_win = vim.api.nvim_get_current_win()
	tree_controller = tree.new()
	tree_controller:ensure({
		cwd = root,
		explorer_win = explorer_win,
		editor_win = function()
			return target_win
		end,
	})
	tree_controller:activate(2, "open")
	assert_symlink_scratch(vim.api.nvim_win_get_buf(target_win), "symlink normal open")
end, debug.traceback)

if tree_controller then
	tree_controller:close()
end
if explorer_win and vim.api.nvim_win_is_valid(explorer_win) then
	vim.api.nvim_win_close(explorer_win, true)
end
if view_controller then
	view_controller:close()
end
if vim.api.nvim_win_is_valid(target_win) then
	vim.wo[target_win].diff = false
	vim.api.nvim_win_set_buf(target_win, original_buffer)
end
base_diff.snapshot = original_snapshot
base_diff.error = original_error
base_diff.subscribe = original_subscribe
state.load = original_load
state.save = original_save
vim.fn.delete(root, "rf")
vim.fn.delete(outside, "rf")

if not ok then
	error(err)
end
