return {
  "pwntester/octo.nvim",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-telescope/telescope.nvim",
    "nvim-tree/nvim-web-devicons",
  },
  cmd = "Octo",
  keys = {
    {
      "<leader>pp",
      function()
        require("user.pr_review").list()
      end,
      desc = "List PRs for review",
    },
    {
      "<leader>po",
      function()
        require("user.pr_review").open()
      end,
      desc = "Open branch PR for review",
    },
    { "<leader>opl", "<cmd>Octo pr list<cr>", desc = "List PRs" },
    { "<leader>opc", "<cmd>Octo pr create<cr>", desc = "Create PR" },
    { "<leader>opC", "<cmd>Octo pr checkout<cr>", desc = "Checkout PR" },
    { "<leader>opm", "<cmd>Octo pr merge<cr>", desc = "Merge PR" },
    { "<leader>opd", "<cmd>Octo pr diff<cr>", desc = "PR Diff" },
    { "<leader>opr", "<cmd>Octo pr ready<cr>", desc = "Mark PR Ready" },
    { "<leader>oil", "<cmd>Octo issue list<cr>", desc = "List Issues" },
    { "<leader>oic", "<cmd>Octo issue create<cr>", desc = "Create Issue" },
    { "<leader>oie", "<cmd>Octo issue edit<cr>", desc = "Edit Issue" },
    { "<leader>ors", "<cmd>Octo review start<cr>", desc = "Start Review" },
    { "<leader>orr", "<cmd>Octo review resume<cr>", desc = "Resume Review" },
    { "<leader>orS", "<cmd>Octo review submit<cr>", desc = "Submit Review" },
    { "<leader>ord", "<cmd>Octo review discard<cr>", desc = "Discard Review" },
    { "<leader>orc", "<cmd>Octo review comments<cr>", desc = "View Comments" },
    { "<leader>oca", "<cmd>Octo comment add<cr>", desc = "Add Comment" },
    { "<leader>ocd", "<cmd>Octo comment delete<cr>", desc = "Delete Comment" },
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

    local group = vim.api.nvim_create_augroup("OctoReviewWorkflow", { clear = true })
    vim.api.nvim_create_autocmd("FileType", {
      group = group,
      pattern = { "octo", "octo_panel" },
      callback = function(args)
        local review = require("user.pr_review")
        review.attach(args.buf)
        review.ensure_review_explorer()
      end,
    })
    vim.api.nvim_create_autocmd("BufEnter", {
      group = group,
      callback = function(args)
        require("user.pr_review").attach_if_review(args.buf)
      end,
    })
    vim.api.nvim_create_autocmd("TabClosed", {
      group = group,
      callback = function(args)
        require("user.pr_review").on_tab_closed(args.match)
      end,
    })
  end,
}
