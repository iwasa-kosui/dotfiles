local t = require("testlib")
local view = require("user.base_diff_view")

local root = vim.fn.tempname()
vim.fn.mkdir(root, "p")
local path = root .. "/binary.bin"
local fd = assert(vim.uv.fs_open(path, "w", 420))
assert(vim.uv.fs_write(fd, "binary\0content", 0))
assert(vim.uv.fs_close(fd))

local numstat = vim.system({ "git", "diff", "--no-index", "--numstat", "--", "/dev/null", path }, { text = true })
	:wait()
t.eq(1, numstat.code)
t.eq("-\t-\t", numstat.stdout:sub(1, 4))

local target_win = vim.api.nvim_get_current_win()
local message
local opened = false
local function diff_count()
	local count = 0
	for _, win in ipairs(vim.api.nvim_list_wins()) do
		if vim.wo[win].diff then
			count = count + 1
		end
	end
	return count
end
local initial_diff_count = diff_count()
local controller = view.new({
	notify = function(value)
		message = value
	end,
})

local ok, err = xpcall(function()
	controller:open({ cwd = root, merge_base = "HEAD" }, { status = "A", path = "binary.bin" }, target_win, function()
		opened = true
	end)
	t.truthy(
		vim.wait(2000, function()
			return message ~= nil or opened
		end),
		"real binary detection must complete"
	)

	t.eq(initial_diff_count, diff_count(), "binary files must not open text diff windows")
	t.truthy(message and message:find("LazyGit", 1, true) ~= nil, "binary files must direct the user to LazyGit")
end, debug.traceback)

controller:close()
vim.fn.delete(root, "rf")

if not ok then
	error(err)
end
