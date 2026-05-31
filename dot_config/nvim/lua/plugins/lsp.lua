return {
  {
    "mfussenegger/nvim-lint",
    opts = {
      linters_by_ft = {
        markdown = {},
      },
    },
  },
  {
    "neovim/nvim-lspconfig",
    opts = {
      inlay_hints = {
        enabled = true,
      },
      -- 長い型検査エラーが行末で見切れるのを防ぐため、カーソル行の診断は
      -- その行の下に折り返して全文表示する。他行は行末表示を消しサインのみ。
      diagnostics = {
        virtual_text = false,
        virtual_lines = { current_line = true },
      },
    },
  },
  {
    "folke/noice.nvim",
    opts = {
      presets = {
        lsp_doc_border = true,
      },
    },
  },
}
