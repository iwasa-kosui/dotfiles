return {
  {
    "folke/snacks.nvim",
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
  {
    "folke/which-key.nvim",
    opts = function(_, opts)
      opts.spec = { { "<leader>b", group = "file" } }
    end,
  },
}
