local toggle_key = "<C-,>"

return {
  {
    "coder/claudecode.nvim",
    dependencies = { "folke/snacks.nvim" },
    keys = {
      { "<leader>a", "", desc = "+ai", mode = { "n", "v" } },
      { "<leader>aa", "<cmd>ClaudeCode<cr>", desc = "Toggle Claude" },
      { "<leader>af", "<cmd>ClaudeCodeFocus<cr>", desc = "Focus Claude" },
      { "<leader>ar", "<cmd>ClaudeCode --resume<cr>", desc = "Resume Claude" },
      { "<leader>aC", "<cmd>ClaudeCode --continue<cr>", desc = "Continue Claude" },
      { "<leader>ab", "<cmd>ClaudeCodeAdd %<cr>", desc = "Add current buffer" },
      { "<leader>as", "<cmd>ClaudeCodeSend<cr>", mode = "v", desc = "Send to Claude" },
      {
        "<leader>as",
        "<cmd>ClaudeCodeTreeAdd<cr>",
        desc = "Add file",
        ft = { "NvimTree", "neo-tree", "oil" },
      },
      { "<leader>aA", "<cmd>ClaudeCodeDiffAccept<cr>", desc = "Accept diff" },
      { "<leader>ad", "<cmd>ClaudeCodeDiffDeny<cr>", desc = "Deny diff" },
      { toggle_key, "<cmd>ClaudeCodeFocus<cr>", desc = "Claude Code", mode = { "n", "x" } },
    },
    cmd = {
      "ClaudeCode",
      "ClaudeCodeFocus",
      "ClaudeCodeAdd",
      "ClaudeCodeSend",
      "ClaudeCodeDiffAccept",
      "ClaudeCodeDiffDeny",
    },
    opts = {
      terminal = {
        cwd_provider = function(_)
          local candidate = require("lazyvim.util").root.get({ normalize = true }) or vim.uv.cwd() or vim.fn.getcwd()
          return require("user.worktree_root").resolve(candidate)
        end,
        snacks_win_opts = {
          position = "right",
          width = 0.36,
          height = 1,
          border = "rounded",
          keys = {
            claude_hide = {
              toggle_key,
              function(self)
                self:hide()
              end,
              mode = "t",
              desc = "Hide",
            },
          },
          on_buf = function(self)
            require("user.ai_dock").attach("claude", self.buf)
          end,
        },
      },
    },
  },
}
