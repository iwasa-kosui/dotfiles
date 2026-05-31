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
      provider = "openai_fim_compatible",
      n_completions = 1,
      context_window = 2048,
      request_timeout = 5,
      throttle = 1500,
      debounce = 600,
      -- ゴーストテキスト（virtual-text）フロントエンド。
      -- blink のメニューはキーワード文字や LSP トリガー文字でしか自動で開かず、
      -- 改行直後・行頭・括弧直後では発火しない（trigger 既定の
      -- show_on_blocked_trigger_characters = { ' ', '\n', '\t' }）。
      -- LLM 補完が欲しいのはまさにそれらの位置なので、blink ソースをやめ
      -- minuet 独自の virtualtext でカーソル位置に依らず自動表示する。
      virtualtext = {
        auto_trigger_ft = { "*" }, -- 全ファイルタイプで自動表示
        -- blink(LSP)メニュー表示中もゴーストを隠さず重ねて出す。
        -- メニュー=LSP補完、ゴースト=LLM補完を同時に見られる
        show_on_completion_menu = true,
        keymap = {
          -- <Tab> は使わない。accept はゴースト未表示時にフォールバックせず
          -- 黙って return するため（virtualtext.lua: accept）、<Tab> に割り当てると
          -- 補完が出ていない時のインデント・スニペット移動を奪う。
          accept = "<A-y>", -- 候補全体を確定
          accept_line = "<A-l>", -- 1行だけ確定
          next = "<A-]>", -- 次の候補へ（候補が無ければ手動発火）
          prev = "<A-[>", -- 前の候補へ（候補が無ければ手動発火）
          dismiss = "<A-e>", -- 候補を消す
        },
      },
      provider_options = {
        openai_fim_compatible = {
          api_key = "TERM",
          name = "Ollama",
          end_point = "http://localhost:11434/v1/completions",
          model = "qwen2.5-coder:3b-base",
          stream = false,
          optional = {
            max_tokens = 128,
            top_p = 0.9,
          },
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
    end,
  },
}
