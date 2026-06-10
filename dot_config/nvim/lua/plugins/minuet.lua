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
      -- num_ctx を 8192 に固定したカスタムモデル(qwen2.5-coder-3b-fim)に合わせ、
      -- カーソル周辺のコードを広く渡して補完の関連性を上げる。
      context_window = 8192,
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
          -- OpenAI 互換 /v1/completions は num_ctx を渡せないため、Modelfile で
          -- num_ctx=8192 を固定したカスタムモデルを使う
          -- (run_onchange_after_ollama-keep-alive.sh.tmpl で ollama create する)。
          model = "qwen2.5-coder-3b-fim",
          stream = false,
          optional = {
            max_tokens = 128,
            top_p = 0.9,
            temperature = 0.2, -- コード補完は決定性を高め、的外れな候補を減らす
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
      -- minuet は virtualtext の自動発火可否を vim.b.minuet_virtual_text_auto_trigger
      -- で判定し、このフラグは setup() 内で登録される FileType autocmd でしか立たない。
      -- 本プラグインは InsertEnter で遅延ロードするため、setup() が走る時点では
      -- 既に開いていたバッファの FileType は発火済みで、その autocmd が二度と回らず
      -- フラグが立たない＝自動ゴーストが永遠に出ない。ロード時点でロード済みの
      -- 全バッファに手動でフラグを立てて補う（以降開くバッファは minuet 側がカバー）。
      for _, buf in ipairs(vim.api.nvim_list_bufs()) do
        if vim.api.nvim_buf_is_loaded(buf) then
          vim.b[buf].minuet_virtual_text_auto_trigger = true
        end
      end
    end,
  },
}
