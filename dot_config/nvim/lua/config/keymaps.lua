-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here
local function copy_path(type)
  local fullpath = vim.fn.expand("%:p")
  if fullpath == "" or fullpath:match("^%[.*%]$") then
    vim.notify("No file is open", vim.log.levels.WARN)
    return
  end

  local root = require("lazyvim.util").root.get({ path = fullpath })
  local path

  if type == "absolute" then
    path = fullpath
  elseif type == "relative" then
    if root and fullpath:find(root, 1, true) == 1 then
      path = fullpath:sub(#root + 2) -- +2 for the slash
    else
      path = vim.fn.expand("%")
    end
  elseif type == "filename" then
    path = vim.fn.expand("%:t")
  end

  vim.fn.setreg("+", path)
  vim.notify("Copied: " .. path, vim.log.levels.INFO)
end

vim.keymap.set("n", "<leader>cpa", function()
  copy_path("absolute")
end, { desc = "Copy absolute path" })
vim.keymap.set("n", "<leader>cpr", function()
  copy_path("relative")
end, { desc = "Copy project-relative path" })
vim.keymap.set("n", "<leader>cpf", function()
  copy_path("filename")
end, { desc = "Copy filename" })
