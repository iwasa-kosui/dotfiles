return {
  {
    "kdheepak/lazygit.nvim",
    cmd = "LazyGit",
    keys = {
      {
        "<leader>gg",
        function()
          require("user.workspace").git_dock()
        end,
        desc = "LazyGit",
      },
    },
    init = function()
      require("user.worktrees")
    end,
  },
  {
    "sindrets/diffview.nvim",
    cmd = { "DiffviewOpen", "DiffviewFileHistory" },
    keys = {
      { "<leader>gz", "<cmd>DiffviewOpen main<cr>", desc = "Diffview Open" },
      { "<leader>gh", "<cmd>DiffviewFileHistory %<cr>", desc = "File History" },
      { "<leader>gH", "<cmd>DiffviewFileHistory<cr>", desc = "Branch History" },
    },
  },
  {
    "folke/snacks.nvim",
    keys = {
      {
        "<leader>gw",
        function()
          require("user.worktrees").open()
        end,
        desc = "Git Worktrees",
      },
    },
  },
}
