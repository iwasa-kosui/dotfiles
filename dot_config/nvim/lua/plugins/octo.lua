return {
  "pwntester/octo.nvim",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-telescope/telescope.nvim",
    "nvim-tree/nvim-web-devicons",
  },
  cmd = "Octo",
  opts = {
    suppress_missing_scope = {
      projects_v2 = true,
    },
    default_to_projects_v2 = true,
    mappings_disable_default = true,
    mappings = {
      pull_request = {
        review_start = { lhs = "r", desc = "Start review" },
        review_resume = { lhs = "R", desc = "Resume pending review" },
      },
      review_diff = {
        add_review_comment = { lhs = "c", mode = { "x" }, desc = "Add pending comment" },
        add_review_suggestion = { lhs = "s", mode = { "x" }, desc = "Add pending suggestion" },
        next_thread = { lhs = "]c", desc = "Next comment" },
        prev_thread = { lhs = "[c", desc = "Previous comment" },
        submit_review = { lhs = "S", desc = "Submit review" },
        close_review_tab = { lhs = "q", desc = "Close review" },
      },
      file_panel = {
        select_entry = { lhs = "<CR>", desc = "Open changed file" },
        submit_review = { lhs = "S", desc = "Submit review" },
        close_review_tab = { lhs = "q", desc = "Close review" },
      },
      review_thread = {
        next_comment = { lhs = "]c", desc = "Next comment" },
        prev_comment = { lhs = "[c", desc = "Previous comment" },
        close_review_tab = { lhs = "q", desc = "Close review" },
      },
      submit_win = {
        approve_review = { lhs = "a", mode = "n", desc = "Approve" },
        comment_review = { lhs = "c", mode = "n", desc = "Comment" },
        request_changes = { lhs = "r", mode = "n", desc = "Request changes" },
        close_review_win = { lhs = "q", mode = "n", desc = "Cancel submit" },
      },
    },
  },
  config = function(_, opts)
    require("octo").setup(opts)
    vim.treesitter.language.register("markdown", "octo")

    local group = vim.api.nvim_create_augroup("OctoReviewExplorer", { clear = true })
    vim.api.nvim_create_autocmd("FileType", {
      group = group,
      pattern = "octo_panel",
      callback = require("user.pr_review").ensure_review_explorer,
    })
  end,
}
