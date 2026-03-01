return {
  {
    "folke/snacks.nvim",
    keys = {
      -- Core pickers
      {
        "<leader>e",
        function()
          require("snacks").explorer()
        end,
        desc = "Explorer",
      },
      {
        "<leader>p",
        function()
          require("snacks").picker()
        end,
        desc = "Picker",
      },
      {
        "<leader>D",
        function()
          require("snacks").picker.diagnostics()
        end,
        desc = "Diagnostics",
      },
      {
        "<leader>m",
        function()
          require("snacks").picker.recent()
        end,
        desc = "Recent Files",
      },

      -- Replace fzf-lua mappings
      {
        "<leader>;",
        function()
          require("snacks").picker.command_history()
        end,
        desc = "Command History",
      },
      {
        "<leader>b",
        function()
          require("snacks").picker.buffers()
        end,
        desc = "Buffers",
      },
      {
        "<leader>f",
        function()
          require("snacks").picker.files()
        end,
        desc = "Files",
      },
      {
        "<leader>g",
        function()
          require("snacks").picker.git_files()
        end,
        desc = "Git Files",
      },
      {
        "<leader>T",
        function()
          require("snacks").picker.lsp_symbols()
        end,
        desc = "LSP Symbols",
      },

      -- Search mappings
      {
        "gR",
        function()
          require("snacks").picker.grep_word()
        end,
        desc = "Grep Word",
        mode = { "n", "x" },
      },
      {
        "gF",
        function()
          require("snacks").picker.files({ pattern = vim.fn.expand("<cword>") })
        end,
        desc = "Find Files with Word",
      },
    },
  },
}
