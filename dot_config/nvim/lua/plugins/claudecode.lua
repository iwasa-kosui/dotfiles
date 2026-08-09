return {
  {
    "coder/claudecode.nvim",
    dependencies = { "folke/snacks.nvim" },
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
          return require("lazyvim.util").root.get({ normalize = true }) or vim.uv.cwd() or vim.fn.getcwd()
        end,
        snacks_win_opts = {
          position = "right",
          width = 0.36,
          height = 1,
          border = "rounded",
          on_buf = function(self)
            local buffer = self.buf
            require("user.ai_dock").attach("claude", buffer)
            vim.keymap.set("n", "<leader>aA", "<cmd>ClaudeCodeDiffAccept<cr>", {
              buffer = buffer,
              desc = "Accept Claude diff",
            })
            vim.keymap.set("n", "<leader>ad", "<cmd>ClaudeCodeDiffDeny<cr>", {
              buffer = buffer,
              desc = "Deny Claude diff",
            })
          end,
        },
      },
    },
  },
}
