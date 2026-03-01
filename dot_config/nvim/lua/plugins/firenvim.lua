local spec = {
  "glacambre/firenvim",

  build = ":call firenvim#install(0)",
}

if vim.g.started_by_firenvim then
  spec = {
    { "noice.nvim", cond = false },
    vim.tbl_extend("force", spec, {
      lazy = false,
      opts = {
        localSettings = {
          [".*"] = {
            takeover = "never",
            cmdline = "neovim",
          },
        },
      },
      config = function(_, opts)
        if type(opts) == "table" and (opts.localSettings or opts.globalSettings) then
          vim.g.firenvim_config = opts
        end
      end,
    }),
  }
end

return spec
