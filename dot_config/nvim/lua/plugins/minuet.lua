-- ollama (qwen2.5-coder / swallow) によるローカル補完を blink.cmp に統合する
--
-- 前提: ollama 起動済みで、用途別に以下のモデルを pull しておくこと:
--   ollama pull qwen2.5-coder:3b-base                         # コードの FIM 補完
--   ollama pull schroneko/llama-3.1-swallow-8b-instruct-v0.1  # markdown の日本語散文補完
--   ollama pull qwen2.5-coder:7b                              # duet（次編集予測）
-- instruct モデルは FIM 補完に不向きなため、コード補完には base タグを使う。

-- minuet の provider 値は backends/ のモジュール名（= ollama を叩く API プロトコル）と
-- 一致させる必要があり、用途名には変えられない。コード補完と散文補完では必要なプロトコルが
-- 本質的に異なるため、provider を切り替えると対応するモデルも連動する。
--   CODE_PROVIDER  … FIM(/v1/completions)。穴埋め。コード補完向き。   → qwen2.5-coder:3b-base
--   PROSE_PROVIDER … chat(/v1/chat/completions)。続き生成。散文向き。 → swallow-8b(日本語)
-- 実モデルは各 provider_options.<provider>.model で割り当てる。
local CODE_PROVIDER = "openai_fim_compatible"
local PROSE_PROVIDER = "openai_compatible"

-- 散文（日本語技術文書）として扱う filetype。これらでは PROSE_PROVIDER を使う。
local prose_filetypes = { markdown = true, mdx = true, ["markdown.mdx"] = true }

-- 現在のバッファの filetype に応じて使うべき provider 名を返す。
local function provider_for_current_buffer()
  return prose_filetypes[vim.bo.filetype] and PROSE_PROVIDER or CODE_PROVIDER
end

return {
  {
    "milanglacier/minuet-ai.nvim",
    event = "InsertEnter",
    dependencies = { "nvim-lua/plenary.nvim" },
    -- lazy.nvim はプラグイン名を "minuetai" と正規化して require を試みるため、
    -- 実モジュール名 minuet と一致せず setup() が呼ばれない。main を明示して
    -- opts を必ず require("minuet").setup() へ渡す。
    main = "minuet",
    -- duet（次編集予測）の手動操作。insert モードでは <leader>=スペースがタイピングと
    -- 衝突するため normal モードのみに張る。
    keys = {
      { "<leader>mp", "<cmd>Minuet duet predict<cr>", desc = "Minuet duet: predict" },
      { "<leader>ma", "<cmd>Minuet duet apply<cr>", desc = "Minuet duet: apply" },
      { "<leader>md", "<cmd>Minuet duet dismiss<cr>", desc = "Minuet duet: dismiss" },
    },
    opts = {
      -- デフォルトはコード補完(CODE_PROVIDER)。markdown 等は config 末尾の autocmd で
      -- PROSE_PROVIDER へ切り替わる。
      provider = CODE_PROVIDER,
      -- 補完メニューに並べる候補数（stream=false なので候補数ぶん curl が走る）。
      n_completions = 4,
      -- provider_options のキーは minuet が config.provider_options[config.provider] で
      -- 引くため backends のモジュール名そのものにする必要がある（CODE_PROVIDER /
      -- PROSE_PROVIDER の実体と対応）。
      provider_options = {
        -- CODE_PROVIDER: ollama の FIM。コードの穴埋め補完。
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
        -- PROSE_PROVIDER: ollama の chat。markdown の散文補完。instruct モデルに続きを
        -- 書かせる。日本語技術文書向けに英語混入の少ない swallow を使う。
        openai_compatible = {
          api_key = "TERM",
          name = "Ollama-prose",
          end_point = "http://localhost:11434/v1/chat/completions",
          model = "schroneko/llama-3.1-swallow-8b-instruct-v0.1",
          stream = false,
        },
      },
      -- duet（次編集予測）。自動トリガーはなく :Minuet duet predict/apply/dismiss で操作する。
      -- chat ベースなので instruct モデルを使う。公式はローカル小型モデルでの品質を
      -- 期待薄としており、実験的な位置づけ。
      -- なお、ここの openai_compatible は config.duet.provider_options 配下で、上の本体補完の
      -- PROSE_PROVIDER(openai_compatible=swallow)とは別 namespace。duet backend は
      -- config.duet.provider_options.openai_compatible を読むため衝突しない。
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
      -- minuet は config.provider をリクエスト時に都度参照するため、autocmd で
      -- 書き換えればバッファ単位でモデルを切り替えられる。filetype 別の provider
      -- 切替は公式機能にないため自前で行う。
      local group = vim.api.nvim_create_augroup("MinuetProviderByFiletype", { clear = true })
      vim.api.nvim_create_autocmd("BufEnter", {
        group = group,
        callback = function()
          require("minuet").config.provider = provider_for_current_buffer()
        end,
      })
      -- プラグインロード時点のバッファにも即座に反映する（autocmd は以降の BufEnter で発火）。
      require("minuet").config.provider = provider_for_current_buffer()
    end,
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
