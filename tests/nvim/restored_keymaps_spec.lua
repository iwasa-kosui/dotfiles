local t = require("testlib")
local root = vim.fn.getcwd() .. "/dot_config/nvim/lua/plugins/"

local function index(keys)
	local result = {}
	for _, mapping in ipairs(keys or {}) do
		result[mapping[1]] = mapping
	end
	return result
end

local snacks = dofile(root .. "plugin.lua")[1]
local snacks_keys = index(snacks.keys)
for _, lhs in ipairs({
	"<leader>e",
	"<leader>D",
	"<leader>;",
	"<leader>b",
	"<leader>f",
	"<leader>g",
	"<leader>T",
	"gR",
	"gF",
}) do
	t.truthy(snacks_keys[lhs], lhs .. " from before PR #133 must remain")
end
t.eq(nil, snacks_keys["<leader>p"], "unused Snacks Picker mapping must be removed")

local git = dofile(root .. "git.lua")
local git_keys = {}
for _, plugin in ipairs(git) do
	for lhs, mapping in pairs(index(plugin.keys)) do
		git_keys[lhs] = mapping
	end
end
for _, lhs in ipairs({ "<leader>gg", "<leader>gz", "<leader>gh", "<leader>gH", "<leader>gw" }) do
	t.truthy(git_keys[lhs], lhs .. " from before PR #133 must remain")
end

local claude = index(dofile(root .. "claudecode.lua")[1].keys)
for _, lhs in ipairs({
	"<leader>a",
	"<leader>aa",
	"<leader>af",
	"<leader>ar",
	"<leader>aC",
	"<leader>ab",
	"<leader>as",
	"<leader>aA",
	"<leader>ad",
	"<C-,>",
}) do
	t.truthy(claude[lhs], lhs .. " from before PR #133 must remain")
end

local minuet = dofile(root .. "minuet.lua")[1]
local minuet_keys = index(minuet.keys)
for _, lhs in ipairs({ "<leader>mp", "<leader>ma", "<leader>md" }) do
	t.truthy(minuet_keys[lhs], lhs .. " from before PR #133 must remain")
end

local multicursors = dofile(root .. "multicursors.lua")[1]
t.truthy(index(multicursors.keys)["<Leader>M"], "multicursor mapping from before PR #133 must remain")

local vscode_keymaps = vim.fn.getcwd() .. "/dot_config/nvim/lua/user/vscode_keymaps.lua"
t.eq(1, vim.fn.filereadable(vscode_keymaps), "PR #133 must not remove the legacy keymap file")
local vscode_source = table.concat(vim.fn.readfile(vscode_keymaps), "\n")
for _, snippet in ipairs({ [["<leader>y", '"+y']], [["<leader>p", '"+p']], [["<Esc>", "<Esc>:noh<CR>"]] }) do
	t.truthy(vscode_source:find(snippet, 1, true), snippet .. " must remain in vscode_keymaps.lua")
end
