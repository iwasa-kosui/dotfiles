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
    -- lazy.nvim はプラグイン名を "minuetai" と正規化して require を試みるため、
    -- 実モジュール名 minuet と一致せず setup() が呼ばれない。main を明示して
    -- opts を必ず require("minuet").setup() へ渡す。
    main = "minuet",
    opts = {
      provider = "openai_fim_compatible",
      -- 補完メニューに並べる候補数（stream=false なので候補数ぶん curl が走る）。
      n_completions = 4,
      provider_options = {
        openai_fim_compatible = {
          -- ollama は API キー不要。minuet が非空の環境変数名を要求するため TERM を使う。
          api_key = "TERM",
          name = "Ollama",
          end_point = "http://localhost:11434/v1/completions",
          model = "qwen2.5-coder:3b-base",
          -- stream=true だと ollama の FIM ストリーム出力を minuet が解析できず
          -- 空テキスト("returns no text on streaming")になるため非ストリームにする。
          stream = false,
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
        timeout_ms = 10000,
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
