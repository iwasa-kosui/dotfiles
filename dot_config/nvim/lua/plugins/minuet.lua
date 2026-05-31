-- OpenRouter 経由の deepseek-v4-flash を補完バックエンドに使う。
-- OpenRouter は FIM(suffix)非対応のため、コード補完も chat エンドポイント経由で行う
-- （minuet は前後の文脈をプロンプトに含めるため chat モデルでもコード補完できる）。
-- API キーは環境変数 OPENROUTER_API_KEY から読む。値はここに書かない。
local PROVIDER_OPTIONS = {
  api_key = "OPENROUTER_API_KEY",
  name = "OpenRouter",
  end_point = "https://openrouter.ai/api/v1/chat/completions",
  model = "deepseek/deepseek-v4-flash",
  stream = true,
  optional = {
    max_tokens = 256,
    -- deepseek-v4 は推論モデル。補完では推論不要かつレイテンシを悪化させるため無効化する。
    -- モデル側が推論を強制し拒否する場合はこの行を削除する。
    reasoning = { enabled = false },
  },
}

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
      provider = "openai_compatible",
      n_completions = 1, -- リクエスト本数を絞りレイテンシとコストを抑える
      context_window = 2048, -- 補完に渡す前後文脈の文字数
      request_timeout = 5,
      throttle = 1500,
      debounce = 600,
      provider_options = {
        openai_compatible = PROVIDER_OPTIONS,
      },
      duet = {
        provider = "openai_compatible",
        provider_options = {
          openai_compatible = PROVIDER_OPTIONS,
        },
      },
    },
    config = function(_, opts)
      require("minuet").setup(opts)
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
        timeout_ms = 5000, -- minuet の request_timeout(5秒)と揃える
        async = true,
      }

      opts.completion = opts.completion or {}
      opts.completion.trigger = vim.tbl_deep_extend("force", opts.completion.trigger or {}, {
        prefetch_on_insert = false,
      })
    end,
  },
}
