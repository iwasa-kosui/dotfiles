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

local cleanup_calls = {}
local cleanup_pair = { left = 30, right = 31 }
local cleanup_controller = view.new({
	check_binary = function(_, _, _, callback)
		callback(false, nil)
	end,
	load_git = function(_, _, callback)
		callback({ "base line" }, nil)
	end,
	show = function()
		return cleanup_pair
	end,
	valid_pair = function(value)
		return value == cleanup_pair
	end,
	clear_diff = function(win)
		cleanup_calls[#cleanup_calls + 1] = { kind = "clear_diff", win = win }
	end,
	restore_mappings = function(value)
		cleanup_calls[#cleanup_calls + 1] = { kind = "restore_mappings", pair = value }
	end,
	close_pair = function(value, closed_win)
		cleanup_calls[#cleanup_calls + 1] = { kind = "close_pair", pair = value, closed_win = closed_win }
	end,
	notify = function() end,
})
cleanup_controller:open(snapshot, { status = "D", path = "gone.lua" }, 20)
cleanup_controller:on_win_closed(31)
t.eq({
	{ kind = "restore_mappings", pair = cleanup_pair },
	{ kind = "clear_diff", win = 30 },
	{ kind = "close_pair", pair = cleanup_pair, closed_win = 31 },
}, cleanup_calls)

local pending_binary = {}
local shown_paths = {}
local async_controller = view.new({
	check_binary = function(_, _, _, callback)
		pending_binary[#pending_binary + 1] = callback
	end,
	load_git = function(_, _, callback)
		callback({ "base line" }, nil)
	end,
	show = function(plan)
		shown_paths[#shown_paths + 1] = plan.right.path
		return { left = 40, right = 41 }
	end,
	valid_pair = function()
		return false
	end,
	clear_diff = function() end,
	notify = function() end,
})
async_controller:open(snapshot, { status = "A", path = "first.lua" }, 20)
async_controller:open(snapshot, { status = "A", path = "second.lua" }, 20)
pending_binary[1](false, nil)
t.eq({}, shown_paths)
pending_binary[2](false, nil)
t.eq({ "/repo/second.lua" }, shown_paths)

local pending_after_close
local close_pending_shows = 0
local close_pending_controller = view.new({
	check_binary = function(_, _, _, callback)
		pending_after_close = callback
	end,
	load_git = function(_, _, callback)
		callback({ "base line" }, nil)
	end,
	show = function()
		close_pending_shows = close_pending_shows + 1
		return { left = 50, right = 51 }
	end,
	valid_pair = function()
		return false
	end,
	clear_diff = function() end,
	notify = function() end,
})
close_pending_controller:open(snapshot, { status = "A", path = "later.lua" }, 20)
close_pending_controller:close()
pending_after_close(false, nil)
t.eq(0, close_pending_shows)
t.eq(nil, close_pending_controller:pair())

local invalid_target_message
local invalid_target_controller = view.new({
	check_binary = function(_, _, _, callback)
		callback(false, nil)
	end,
	load_git = function(_, _, callback)
		callback({ "base line" }, nil)
	end,
	show = function()
		error("show must not run for an invalid target window")
	end,
	valid_pair = function()
		return false
	end,
	valid_window = function()
		return false
	end,
	clear_diff = function() end,
	notify = function(message)
		invalid_target_message = message
	end,
})
invalid_target_controller:open(snapshot, { status = "A", path = "closed.lua" }, 20)
t.truthy(invalid_target_message:find("target window", 1, true) ~= nil)

local root = vim.fn.getcwd()
local target_win = vim.api.nvim_get_current_win()
local original_buffer = vim.api.nvim_create_buf(true, false)
vim.api.nvim_buf_set_name(original_buffer, "base-diff-view-original-" .. original_buffer)
vim.api.nvim_win_set_buf(target_win, original_buffer)
local real_file = vim.fn.bufadd(root .. "/tests/nvim/base_diff_view_spec.lua")
vim.fn.bufload(real_file)
vim.keymap.set("n", "q", function() end, {
	buffer = real_file,
	desc = "base-diff-view-existing-q",
})

local native_controller = view.new({
	check_binary = function(_, _, _, callback)
		callback(false, nil)
	end,
})
native_controller:open(
	{ cwd = root, merge_base = "abc123" },
	{ status = "A", path = "tests/nvim/base_diff_view_spec.lua" },
	target_win
)
t.truthy(vim.wait(1000, function()
	return native_controller:pair() ~= nil
end))
native_controller:close()
t.eq(original_buffer, vim.api.nvim_win_get_buf(target_win))
t.eq(
	"base-diff-view-existing-q",
	vim.api.nvim_buf_call(real_file, function()
		return vim.fn.maparg("q", "n", false, true).desc
	end)
)
vim.keymap.del("n", "q", { buffer = real_file })

local closed_target = vim.api.nvim_get_current_win()
local spare_win = vim.api.nvim_win_call(closed_target, function()
	vim.cmd("vsplit")
	return vim.api.nvim_get_current_win()
end)
local scheduled_target_message
local scheduled_target_controller = view.new({
	check_binary = function(_, _, _, callback)
		callback(false, nil)
	end,
	notify = function(message)
		scheduled_target_message = message
	end,
})
scheduled_target_controller:open(
	{ cwd = root, merge_base = "abc123" },
	{ status = "A", path = "tests/nvim/base_diff_view_spec.lua" },
	closed_target
)
vim.api.nvim_win_close(closed_target, true)
t.truthy(vim.wait(1000, function()
	return scheduled_target_message ~= nil
end))
t.truthy(scheduled_target_message:find("target window", 1, true) ~= nil)
t.eq(nil, scheduled_target_controller:pair())
t.truthy(vim.api.nvim_win_is_valid(spare_win))

local function window_count()
	return #vim.api.nvim_tabpage_list_wins(0)
end

local rollback_target = vim.api.nvim_get_current_win()
local rollback_original = vim.api.nvim_create_buf(true, false)
vim.api.nvim_buf_set_name(rollback_original, "base-diff-view-rollback-" .. rollback_original)
vim.api.nvim_win_set_buf(rollback_target, rollback_original)
local new_pair_windows = window_count()
local new_pair_message
local new_pair_rollback_controller = view.new({
	check_binary = function(_, _, _, callback)
		callback(false, nil)
	end,
	notify = function(message)
		new_pair_message = message
	end,
})
new_pair_rollback_controller:open(
	{ cwd = root, merge_base = "abc123" },
	{ status = "A", path = "tests/nvim/base_diff_view_spec.lua" },
	rollback_target
)
local original_cmd = vim.cmd
vim.cmd = function(command)
	if type(command) == "string" and command:match("^edit ") then
		error("forced new-pair edit failure")
	end
	return original_cmd(command)
end
t.truthy(vim.wait(1000, function()
	return new_pair_message ~= nil
end))
vim.cmd = original_cmd
t.truthy(new_pair_message:find("Base diff display failed", 1, true) ~= nil)
t.eq(nil, new_pair_rollback_controller:pair())
t.eq(new_pair_windows, window_count())
t.eq(rollback_original, vim.api.nvim_win_get_buf(rollback_target))

local reused_original = vim.api.nvim_create_buf(true, false)
vim.api.nvim_buf_set_name(reused_original, "base-diff-view-reused-" .. reused_original)
vim.api.nvim_win_set_buf(rollback_target, reused_original)
local reused_file = vim.fn.bufadd(root .. "/tests/nvim/base_diff_view_spec.lua")
vim.fn.bufload(reused_file)
vim.keymap.set("n", "q", function() end, {
	buffer = reused_file,
	desc = "base-diff-view-reused-q",
})
local reused_windows = window_count()
local reused_message
local reused_rollback_controller = view.new({
	check_binary = function(_, _, _, callback)
		callback(false, nil)
	end,
	notify = function(message)
		reused_message = message
	end,
})
reused_rollback_controller:open(
	{ cwd = root, merge_base = "abc123" },
	{ status = "A", path = "tests/nvim/base_diff_view_spec.lua" },
	rollback_target
)
t.truthy(vim.wait(1000, function()
	return reused_rollback_controller:pair() ~= nil
end))
local reused_pair = reused_rollback_controller:pair()
vim.cmd = function(command)
	if type(command) == "string" and command:match("^edit ") then
		error("forced reused-pair edit failure")
	end
	return original_cmd(command)
end
reused_rollback_controller:open(
	{ cwd = root, merge_base = "abc123" },
	{ status = "A", path = "dot_config/nvim/lua/user/base_diff_view.lua" },
	rollback_target
)
t.truthy(vim.wait(1000, function()
	return reused_message ~= nil
end))
vim.cmd = original_cmd
t.truthy(reused_message:find("Base diff display failed", 1, true) ~= nil)
t.eq(nil, reused_rollback_controller:pair())
t.eq(reused_windows, window_count())
t.eq(reused_original, vim.api.nvim_win_get_buf(rollback_target))
t.eq(
	"base-diff-view-reused-q",
	vim.api.nvim_buf_call(reused_file, function()
		return vim.fn.maparg("q", "n", false, true).desc
	end)
)
vim.keymap.del("n", "q", { buffer = reused_file })
