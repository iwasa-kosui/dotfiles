return {
  "pwntester/octo.nvim",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-telescope/telescope.nvim",
    "nvim-tree/nvim-web-devicons",
  },
  cmd = "Octo",
  keys = {
    -- PR操作
    { "<leader>opl", "<cmd>Octo pr list<cr>", desc = "List PRs" },
    { "<leader>opc", "<cmd>Octo pr create<cr>", desc = "Create PR" },
    { "<leader>opC", "<cmd>Octo pr checkout<cr>", desc = "Checkout PR" },
    { "<leader>opm", "<cmd>Octo pr merge<cr>", desc = "Merge PR" },
    { "<leader>opd", "<cmd>Octo pr diff<cr>", desc = "PR Diff" },
    { "<leader>opr", "<cmd>Octo pr ready<cr>", desc = "Mark PR Ready" },

    -- Issue操作
    { "<leader>oil", "<cmd>Octo issue list<cr>", desc = "List Issues" },
    { "<leader>oic", "<cmd>Octo issue create<cr>", desc = "Create Issue" },
    { "<leader>oie", "<cmd>Octo issue edit<cr>", desc = "Edit Issue" },

    -- Review操作
    { "<leader>ors", "<cmd>Octo review start<cr>", desc = "Start Review" },
    { "<leader>orr", "<cmd>Octo review resume<cr>", desc = "Resume Review" },
    { "<leader>orS", "<cmd>Octo review submit<cr>", desc = "Submit Review" },
    { "<leader>ord", "<cmd>Octo review discard<cr>", desc = "Discard Review" },
    { "<leader>orc", "<cmd>Octo review comments<cr>", desc = "View Comments" },

    -- Comment操作
    { "<leader>oca", "<cmd>Octo comment add<cr>", desc = "Add Comment" },
    { "<leader>ocd", "<cmd>Octo comment delete<cr>", desc = "Delete Comment" },

    -- その他
    { "<leader>oo", "<cmd>Octo<cr>", desc = "Octo Actions" },
    { "<leader>os", "<cmd>Octo search<cr>", desc = "Search" },
  },
  opts = {
    suppress_missing_scope = {
      projects_v2 = true,
    },
    default_to_projects_v2 = true,
  },
  config = function(_, opts)
    require("octo").setup(opts)
    vim.treesitter.language.register("markdown", "octo")
  end,
}
