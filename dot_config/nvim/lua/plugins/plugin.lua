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
  {
    "zbirenbaum/copilot.lua",
    cmd = "Copilot",
    build = ":Copilot auth",
    event = "BufReadPost",
    opts = {
      suggestion = {
        enabled = not vim.g.ai_cmp,
        auto_trigger = true,
        hide_during_completion = vim.g.ai_cmp,
        keymap = {
          accept = false, -- handled by nvim-cmp / blink.cmp
          next = "<M-]>",
          prev = "<M-[>",
        },
      },
      panel = { enabled = false },
      filetypes = {
        markdown = true,
        help = true,
      },
    },
  },
  {
    "coder/claudecode.nvim",
    dependencies = { "folke/snacks.nvim" },
    opts = {
      track_selection = true,
      visual_demotion_delay_ms = 50,
    },
    lazy = false,
    config = true,
    keys = {
      { "<leader>c", nil, desc = "Claude Code" },
      { "<leader>cc", "<cmd>ClaudeCode<cr>", desc = "Toggle Claude" },
      { "<leader>cf", "<cmd>ClaudeCodeFocus<cr>", desc = "Focus Claude" },
      { "<leader>cr", "<cmd>ClaudeCode --resume<cr>", desc = "Resume Claude" },
      { "<leader>cC", "<cmd>ClaudeCode --continue<cr>", desc = "Continue Claude" },
      { "<leader>cm", "<cmd>ClaudeCodeSelectModel<cr>", desc = "Select Claude model" },
      { "<leader>cb", "<cmd>ClaudeCodeAdd %<cr>", desc = "Add current buffer" },
      { "<leader>cs", "<cmd>ClaudeCodeSend<cr>", mode = "v", desc = "Send to Claude" },
      -- Diff management
      { "<leader>ca", "<cmd>ClaudeCodeDiffAccept<cr>", desc = "Accept diff" },
      { "<leader>cd", "<cmd>ClaudeCodeDiffDeny<cr>", desc = "Deny diff" },
    },
  },
}
