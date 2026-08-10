local t = require("testlib")
local view = require("user.base_diff_view")

local root = vim.fn.getcwd()
local target_win = vim.api.nvim_get_current_win()
local controller = view.new()
local completed = 0

local function open(change)
	controller:open({ cwd = root, merge_base = "HEAD" }, change, target_win, function()
		completed = completed + 1
	end)
	t.truthy(
		vim.wait(2000, function()
			return completed == 1
		end),
		change.status .. " diff must leave the vim.system fast event before using window APIs"
	)
	completed = 0
end

open({ status = "A", path = "tests/nvim/base_diff_view_spec.lua" })
open({ status = "M", path = "tests/nvim/base_diff_view_spec.lua" })

local diff_windows = 0
for _, win in ipairs(vim.api.nvim_list_wins()) do
	if vim.wo[win].diff then
		diff_windows = diff_windows + 1
	end
end
t.eq(2, diff_windows)

controller:close()
