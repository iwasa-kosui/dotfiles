-- ollama によるローカル補完を blink.cmp に統合する。
-- 要 pull: qwen2.5-coder:3b-base(コードFIM) / swallow-8b(散文) / qwen2.5-coder:7b(duet)

-- provider 値は minuet の backends モジュール名(=APIプロトコル)で、用途名には変えられない。
-- コードはFIM、散文はchatとプロトコルが異なるため、切り替えるとモデルも連動する。
local CODE_PROVIDER = "openai_fim_compatible" -- FIM, qwen base
local PROSE_PROVIDER = "openai_compatible" -- chat, swallow

local prose_filetypes = { markdown = true, mdx = true, ["markdown.mdx"] = true }

local function provider_for_current_buffer()
  return prose_filetypes[vim.bo.filetype] and PROSE_PROVIDER or CODE_PROVIDER
end

return {
  {
    "milanglacier/minuet-ai.nvim",
    event = "InsertEnter",
    dependencies = { "nvim-lua/plenary.nvim" },
    -- lazy が "minuetai" と正規化して require するため、main を明示しないと setup() が呼ばれない。
    main = "minuet",
    -- insert モードは <leader>=スペースがタイピングと衝突するため normal のみ。
    keys = {
      { "<leader>mp", "<cmd>Minuet duet predict<cr>", desc = "Minuet duet: predict" },
      { "<leader>ma", "<cmd>Minuet duet apply<cr>", desc = "Minuet duet: apply" },
      { "<leader>md", "<cmd>Minuet duet dismiss<cr>", desc = "Minuet duet: dismiss" },
    },
    opts = {
      provider = CODE_PROVIDER, -- markdown は config 末尾の autocmd で切り替わる
      n_completions = 4,
      -- キーは minuet が config.provider_options[provider] で引くためモジュール名のまま。
      provider_options = {
        openai_fim_compatible = {
          api_key = "TERM", -- ollama はキー不要だが minuet が非空の環境変数名を要求する
          name = "Ollama",
          end_point = "http://localhost:11434/v1/completions",
          model = "qwen2.5-coder:3b-base",
          stream = false, -- stream=true だと ollama の FIM 出力を解析できず空になる
        },
        openai_compatible = {
          api_key = "TERM",
          name = "Ollama-prose",
          end_point = "http://localhost:11434/v1/chat/completions",
          model = "schroneko/llama-3.1-swallow-8b-instruct-v0.1",
          stream = false,
        },
      },
      -- duet（次編集予測）。手動: :Minuet duet predict/apply/dismiss。実験的（公式は小型ローカルで品質薄と明言）。
      -- duet backend は config.duet.provider_options を読むので本体補完とは別 namespace。
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
      -- minuet は config.provider を都度参照する。filetype 別切替は公式機能にないため autocmd で行う。
      local group = vim.api.nvim_create_augroup("MinuetProviderByFiletype", { clear = true })
      vim.api.nvim_create_autocmd("BufEnter", {
        group = group,
        callback = function()
          require("minuet").config.provider = provider_for_current_buffer()
        end,
      })
      require("minuet").config.provider = provider_for_current_buffer() -- ロード時のバッファに即反映
    end,
  },

  -- blink.cmp に minuet をソース追加する。sources.default は配列なので insert で既存を壊さない。
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
        async = true,
        timeout_ms = 10000, -- ローカル生成を待ちすぎない上限
        score_offset = 50, -- 他ソースより上位
      }

      opts.completion = opts.completion or {}
      opts.completion.trigger = vim.tbl_deep_extend("force", opts.completion.trigger or {}, {
        prefetch_on_insert = false, -- 無駄な先読みを抑える
      })
    end,
  },
}
