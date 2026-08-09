vim.api.nvim_create_autocmd("User", {
  pattern = "VeryLazy",
  callback = function()
    require("user.workspace").ensure_explorer({ focus = false })
  end,
})
