local t = require("testlib")

local original_set = vim.keymap.set
local original_schedule = vim.schedule
local mappings = {}
local next_file = function() end
local previous_file = function() end
local send_file = function() end

local previous_workspace = package.loaded["user.workspace"]
local previous_ai = package.loaded["user.ai_dock"]
local previous_review = package.loaded["user.pr_review"]
package.loaded["user.workspace"] = {
	focus_explorer = function() end,
	files = function() end,
	search = function() end,
	replace = function() end,
	next_file = next_file,
	previous_file = previous_file,
	git_dock = function() end,
}
package.loaded["user.ai_dock"] = {
	toggle = function() end,
	send_file = send_file,
	send_selection = function() end,
}
package.loaded["user.pr_review"] = { open = function() end }

vim.keymap.set = function(mode, lhs, rhs)
	mappings[mode .. "\0" .. lhs] = rhs
end
vim.schedule = function() end

local ok, err = pcall(dofile, vim.fn.getcwd() .. "/dot_config/nvim/lua/config/keymaps.lua")

vim.keymap.set = original_set
vim.schedule = original_schedule
package.loaded["user.workspace"] = previous_workspace
package.loaded["user.ai_dock"] = previous_ai
package.loaded["user.pr_review"] = previous_review

if not ok then
	error(err)
end

t.eq(next_file, mappings["n\0<C-Tab>"])
t.eq(next_file, mappings["n\0<leader>bn"])
t.eq(previous_file, mappings["n\0<C-S-Tab>"])
t.eq(previous_file, mappings["n\0<leader>bp"])
t.eq(send_file, mappings["n\0<leader>af"], "<leader>af must send the current file")
