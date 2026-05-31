local CODE_PROVIDER = "openai_fim_compatible"
local PROSE_PROVIDER = "openai_compatible"

local prose_filetypes = { markdown = true, mdx = true, ["markdown.mdx"] = true }

local function provider_for_current_buffer()
  return prose_filetypes[vim.bo.filetype] and PROSE_PROVIDER or CODE_PROVIDER
end

return {
  {
    "milanglacier/minuet-ai.nvim",
    event = "InsertEnter",
    dependencies = { "nvim-lua/plenary.nvim" },
    main = "minuet", -- 明示しないと lazy が require 名を誤り setup() が呼ばれない
    keys = {
      { "<leader>mp", "<cmd>Minuet duet predict<cr>", desc = "Minuet duet: predict" },
      { "<leader>ma", "<cmd>Minuet duet apply<cr>", desc = "Minuet duet: apply" },
      { "<leader>md", "<cmd>Minuet duet dismiss<cr>", desc = "Minuet duet: dismiss" },
    },
    opts = {
      provider = CODE_PROVIDER,
      provider_options = {
        openai_fim_compatible = {
          api_key = "TERM",
          name = "Ollama",
          end_point = "http://localhost:11434/v1/completions",
          model = "qwen2.5-coder:7b",
          stream = false, -- true だと ollama の FIM 出力を解析できず空になる
        },
        openai_compatible = {
          api_key = "TERM",
          name = "Ollama-prose",
          end_point = "http://localhost:11434/v1/chat/completions",
          model = "schroneko/llama-3.1-swallow-8b-instruct-v0.1",
          stream = false,
        },
      },
      duet = {
        provider = "openai_compatible",
        provider_options = {
          openai_compatible = {
            name = "Ollama",
            end_point = "http://localhost:11434/v1/chat/completions",
            model = "qwen2.5-coder:7b",
            api_key = "TERM",
          },
        },
      },
    },
    config = function(_, opts)
      require("minuet").setup(opts)
      local group = vim.api.nvim_create_augroup("MinuetProviderByFiletype", { clear = true })
      vim.api.nvim_create_autocmd("BufEnter", {
        group = group,
        callback = function()
          require("minuet").config.provider = provider_for_current_buffer()
        end,
      })
      require("minuet").config.provider = provider_for_current_buffer()
    end,
  },

  {
    "saghen/blink.cmp",
    opts = function(_, opts)
      opts.sources = opts.sources or {}
      opts.sources.default = opts.sources.default or {}
      if not vim.tbl_contains(opts.sources.default, "minuet") then
        table.insert(opts.sources.default, "minuet")
      end

      opts.sources.providers = opts.sources.providers or {}
      opts.sources.providers.minuet = {
        name = "minuet",
        module = "minuet.blink",
        timeout_ms = 10000,
        async = true,
      }

      opts.completion = opts.completion or {}
      opts.completion.trigger = vim.tbl_deep_extend("force", opts.completion.trigger or {}, {
        prefetch_on_insert = false,
      })
    end,
  },
}
