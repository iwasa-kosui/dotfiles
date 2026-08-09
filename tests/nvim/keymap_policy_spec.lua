local t = require("testlib")
local policy = require("user.keymap_policy")

for _, lhs in ipairs({
	"<leader>e",
	"<leader>f",
	"<leader>s",
	"<leader>r",
	"<leader>w",
	"<leader>a",
	"<leader>g",
	"<leader>p",
	"<leader>bn",
	"<leader>bp",
	"<leader>bd",
	"<leader>wd",
	"<leader>|",
	"<leader>-",
}) do
	t.truthy(policy.is_allowed("n", lhs), lhs .. " must remain")
end

t.truthy(policy.is_allowed("x", "<leader>as"), "visual AI send must remain")
t.eq(false, policy.is_allowed("n", "<leader>opl"))
t.eq(false, policy.is_allowed("n", "<leader>gg"))
t.eq(false, policy.is_allowed("n", "<leader>mp"))
t.eq(false, policy.is_allowed("x", "<leader>r"))

vim.g.mapleader = " "
vim.keymap.set("n", "<leader>e", function() end)
vim.keymap.set("n", "<leader>opl", function() end)
policy.prune()
t.truthy(vim.fn.maparg("<leader>e", "n") ~= "", "allowed mapping must survive pruning")
t.eq("", vim.fn.maparg("<leader>opl", "n"), "rejected mapping must be removed")
