local t = require("testlib")
local plugin = dofile(vim.fn.getcwd() .. "/dot_config/nvim/lua/plugins/octo.lua")

t.eq(nil, plugin.opts.mappings_disable_default, "Octo default mappings must stay enabled")
t.eq(nil, plugin.opts.mappings, "Octo review mappings must use the original defaults")

local mappings = {}
for _, mapping in ipairs(plugin.keys) do
	mappings[mapping[1]] = mapping[2]
end

local expected = {
	["<leader>opl"] = "<cmd>Octo pr list<cr>",
	["<leader>opc"] = "<cmd>Octo pr create<cr>",
	["<leader>opC"] = "<cmd>Octo pr checkout<cr>",
	["<leader>opm"] = "<cmd>Octo pr merge<cr>",
	["<leader>opd"] = "<cmd>Octo pr diff<cr>",
	["<leader>opr"] = "<cmd>Octo pr ready<cr>",
	["<leader>oil"] = "<cmd>Octo issue list<cr>",
	["<leader>oic"] = "<cmd>Octo issue create<cr>",
	["<leader>oie"] = "<cmd>Octo issue edit<cr>",
	["<leader>ors"] = "<cmd>Octo review start<cr>",
	["<leader>orr"] = "<cmd>Octo review resume<cr>",
	["<leader>orS"] = "<cmd>Octo review submit<cr>",
	["<leader>ord"] = "<cmd>Octo review discard<cr>",
	["<leader>orc"] = "<cmd>Octo review comments<cr>",
	["<leader>oca"] = "<cmd>Octo comment add<cr>",
	["<leader>ocd"] = "<cmd>Octo comment delete<cr>",
	["<leader>oo"] = "<cmd>Octo<cr>",
	["<leader>os"] = "<cmd>Octo search<cr>",
}

for lhs, rhs in pairs(expected) do
	t.eq(rhs, mappings[lhs], lhs .. " must use its original Octo command")
end
