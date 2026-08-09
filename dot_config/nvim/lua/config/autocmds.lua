vim.api.nvim_create_autocmd("User", {
  pattern = "VeryLazy",
  callback = function()
    local workspace = require("user.workspace")
    workspace.ensure_explorer({ focus = false })
    require("user.lazygit_dock").ensure({ focus = false })
  end,
})

vim.api.nvim_create_autocmd({ "WinEnter", "BufEnter" }, {
  callback = function()
    require("user.workspace").remember_editor()
  end,
})
