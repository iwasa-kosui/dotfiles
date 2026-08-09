local workspace = require("user.workspace")
local map = vim.keymap.set

map("n", "<leader>e", workspace.focus_explorer, { desc = "Explorer" })
for _, lhs in ipairs({ "<C-p>", "<leader>f" }) do
  map("n", lhs, workspace.files, { desc = "Find files" })
end
for _, lhs in ipairs({ "<C-S-f>", "<leader>s" }) do
  map("n", lhs, workspace.search, { desc = "Search text" })
end
map("n", "<leader>r", workspace.replace, { desc = "Replace across files" })
map("n", "<leader>w", function()
  require("user.worktrees").open()
end, { desc = "Switch worktree" })
for _, lhs in ipairs({ "<C-Tab>", "<leader>bn" }) do
  map("n", lhs, workspace.next_file, { desc = "Next file" })
end
for _, lhs in ipairs({ "<C-S-Tab>", "<leader>bp" }) do
  map("n", lhs, workspace.previous_file, { desc = "Previous file" })
end
map("n", "<leader>bd", function()
  Snacks.bufdelete()
end, { desc = "Close file" })
map("n", "<leader>|", "<C-w>v", { remap = true, desc = "Split right" })
map("n", "<leader>-", "<C-w>s", { remap = true, desc = "Split below" })
map("n", "<leader>wd", "<C-w>c", { remap = true, desc = "Close editor group" })
map("n", "<leader>g", workspace.git_dock, { desc = "Git dock" })

vim.schedule(function()
  require("user.keymap_policy").prune()
end)
