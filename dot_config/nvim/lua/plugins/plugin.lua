return {
  {
    "folke/snacks.nvim",
    keys = {
      {
        "<leader>e",
        function()
          require("user.workspace").focus_explorer()
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
    opts = function(_, opts)
      opts.explorer = vim.tbl_deep_extend("force", opts.explorer or {}, { trash = true })
      opts.picker = opts.picker or {}
      opts.picker.sources = opts.picker.sources or {}
      opts.picker.sources.explorer = vim.tbl_deep_extend("force", opts.picker.sources.explorer or {}, {
        auto_close = false,
        jump = { close = false },
        follow_file = true,
        git_status = true,
        git_status_hl = false,
        format = require("user.base_diff").format,
        layout = {
          preset = "sidebar",
          preview = false,
          layout = { width = 32, min_width = 32, max_width = 32 },
        },
        win = {
          list = {
            keys = {
              a = "explorer_add",
              r = "explorer_rename",
              m = "explorer_move",
              d = "explorer_del",
              c = "explorer_copy",
              p = "explorer_paste",
              v = "edit_vsplit",
              s = "edit_split",
              ["?"] = "toggle_help_list",
              q = false,
              ["<Esc>"] = false,
            },
          },
        },
      })
    end,
  },
}
