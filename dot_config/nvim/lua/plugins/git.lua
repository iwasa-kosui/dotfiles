return {
  {
    "kdheepak/lazygit.nvim",
    cmd = "LazyGit",
    init = function()
      require("user.worktrees")
    end,
  },
  {
    "sindrets/diffview.nvim",
    cmd = { "DiffviewOpen", "DiffviewFileHistory" },
  },
}
