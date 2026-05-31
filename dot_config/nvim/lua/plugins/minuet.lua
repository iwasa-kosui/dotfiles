-- ollama (qwen2.5-coder) によるローカルコード補完を blink.cmp に統合する
--
-- 前提: ollama が起動済みで、FIM 対応の base モデルを pull 済みであること
--   ollama pull qwen2.5-coder:3b-base
-- instruct モデルは FIM 補完に不向きなため base タグを使う
return {
  {
    "milanglacier/minuet-ai.nvim",
    event = "InsertEnter",
    dependencies = { "nvim-lua/plenary.nvim" },
    opts = {
      -- ollama の OpenAI 互換 FIM エンドポイントを使う
      provider = "openai_fim_compatible",
      -- ローカルモデルは候補1つに絞ってレイテンシを抑える
      n_completions = 1,
      -- 送る文脈を絞って生成を速くする
      context_window = 512,
      request_timeout = 3,
      -- 自動トリガーの負荷軽減: 入力が止まってから debounce、最短間隔は throttle
      throttle = 1000,
      debounce = 400,
      provider_options = {
        openai_fim_compatible = {
          -- ollama は API キー不要だが minuet がヘッダ構築時に非空の環境変数名を要求する
          api_key = "TERM",
          name = "Ollama",
          end_point = "http://localhost:11434/v1/completions",
          model = "qwen2.5-coder:3b-base",
          stream = true,
          optional = {
            max_tokens = 56,
            top_p = 0.9,
          },
        },
      },
    },
  },

  -- LazyVim 既定の blink.cmp に minuet をソースとして追加する。
  -- sources.default は配列なので opts 関数で insert し、既定の他ソースを壊さない。
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
        -- ローカル生成が間に合わない場合に補完メニューを待たせ過ぎない上限
        timeout_ms = 3000,
        -- 他ソースより上位に表示する
        score_offset = 50,
      }

      -- 無駄な先読みリクエストを抑える
      opts.completion = opts.completion or {}
      opts.completion.trigger = vim.tbl_deep_extend("force", opts.completion.trigger or {}, {
        prefetch_on_insert = false,
      })
    end,
  },
}
