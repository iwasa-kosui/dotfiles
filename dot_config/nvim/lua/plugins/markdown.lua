return {
  {
    "nvim-treesitter/nvim-treesitter",
    init = function()
      -- Register before the first buffer, rather than waiting for VeryLazy.
      vim.filetype.add({ extension = { mdx = "markdown.mdx" } })
      vim.treesitter.language.register("markdown", "markdown.mdx")
      vim.treesitter.query.add_predicate("mdx?", function(_, _, source)
        return type(source) == "number" and vim.bo[source].filetype == "markdown.mdx"
      end, { force = true })
    end,
    opts = {
      ensure_installed = { "markdown", "markdown_inline", "tsx" },
    },
  },
  {
    "stevearc/conform.nvim",
    opts = {
      formatters_by_ft = {
        ["markdown"] = { "markdownlint-cli2", "markdown-toc" },
        ["markdown.mdx"] = { "markdownlint-cli2", "markdown-toc" },
      },
    },
  },
  {
    "MeanderingProgrammer/render-markdown.nvim",
    opts = {
      html = {
        comment = {
          conceal = false,
        },
      },
    },
  },
}
