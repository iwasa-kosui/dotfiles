local t = require("testlib")

local original_schedule = vim.schedule
vim.g.mapleader = " "
vim.keymap.set("n", "<leader>opl", function() end, { desc = "Existing plugin mapping" })
vim.schedule = function(callback)
	callback()
end

local ok, err = pcall(dofile, vim.fn.getcwd() .. "/dot_config/nvim/lua/config/keymaps.lua")
vim.schedule = original_schedule

if not ok then
	error(err)
end

local expected = {
	["<leader>cpa"] = "Copy absolute path",
	["<leader>cpr"] = "Copy project-relative path",
	["<leader>cpf"] = "Copy filename",
	["<leader>p"] = "Picker",
	["<leader>gp"] = "Open PR (browser)",
	["<leader>opl"] = "Existing plugin mapping",
}

for lhs, description in pairs(expected) do
	local mapping = vim.fn.maparg(lhs, "n", false, true)
	t.eq(description, mapping.desc, lhs .. " must remain mapped")
	vim.keymap.del("n", lhs)
end
