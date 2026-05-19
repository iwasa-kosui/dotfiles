-- Autocmds are automatically loaded on the VeryLazy event
-- Default autocmds that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/autocmds.lua
--
-- Add any additional autocmds here
-- with `vim.api.nvim_create_autocmd`
--
-- Or remove existing autocmds by their group name (which is prefixed with `lazyvim_` for the defaults)
-- e.g. vim.api.nvim_del_augroup_by_name("lazyvim_wrap_spell")

vim.api.nvim_create_autocmd("CursorHold", {
  group = vim.api.nvim_create_augroup("lsp_hover_on_cursor_hold", { clear = true }),
  callback = function()
    if vim.api.nvim_win_get_config(0).relative ~= "" then
      return
    end
    local bufnr = vim.api.nvim_get_current_buf()
    local clients = vim.lsp.get_clients({ bufnr = bufnr })
    local client
    for _, c in ipairs(clients) do
      if c.supports_method and c:supports_method("textDocument/hover") then
        client = c
        break
      end
    end
    if not client then
      return
    end
    local params = vim.lsp.util.make_position_params(0, client.offset_encoding or "utf-16")
    vim.lsp.buf_request(bufnr, "textDocument/hover", params, function(err, result, ctx, config)
      if err or not result or not result.contents then
        return
      end
      local lines = vim.lsp.util.convert_input_to_markdown_lines(result.contents)
      local has_content = false
      for _, line in ipairs(lines or {}) do
        if line ~= "" then
          has_content = true
          break
        end
      end
      if not has_content then
        return
      end
      vim.lsp.handlers.hover(err, result, ctx, config)
    end)
  end,
})

vim.api.nvim_create_autocmd("VimEnter", {
  group = vim.api.nvim_create_augroup("popup_replace_inspect_with_hover", { clear = true }),
  callback = function()
    pcall(vim.cmd, "aunmenu PopUp.Inspect")
    vim.cmd([[anoremenu 1.100 PopUp.Hover\ (LSP)  <Cmd>lua vim.lsp.buf.hover()<CR>]])
  end,
})
