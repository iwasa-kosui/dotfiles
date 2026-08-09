local M = {}

local allowed = {
  n = {
    ["<leader>e"] = true,
    ["<leader>f"] = true,
    ["<leader>s"] = true,
    ["<leader>r"] = true,
    ["<leader>w"] = true,
    ["<leader>a"] = true,
    ["<leader>af"] = true,
    ["<leader>g"] = true,
    ["<leader>p"] = true,
    ["<leader>bn"] = true,
    ["<leader>bp"] = true,
    ["<leader>bd"] = true,
    ["<leader>wd"] = true,
    ["<leader>|"] = true,
    ["<leader>-"] = true,
  },
  x = { ["<leader>as"] = true },
  o = {},
}

function M.is_allowed(mode, lhs)
  return allowed[mode] and allowed[mode][lhs] == true or false
end

local function display_lhs(lhs)
  local leader = vim.g.mapleader or "\\"
  if lhs:sub(1, 7) == "<Space>" and leader == " " then
    return "<leader>" .. lhs:sub(8)
  end
  if lhs:sub(1, #leader) == leader then
    return "<leader>" .. lhs:sub(#leader + 1)
  end
  return lhs
end

function M.prune()
  for _, mode in ipairs({ "n", "x", "o" }) do
    for _, mapping in ipairs(vim.api.nvim_get_keymap(mode)) do
      local lhs = display_lhs(mapping.lhs)
      if lhs:sub(1, 8) == "<leader>" and not M.is_allowed(mode, lhs) then
        pcall(vim.keymap.del, mode, mapping.lhs)
      end
    end
  end
end

return M
