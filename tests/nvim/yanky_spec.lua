local t = require("testlib")

local ok, specs = pcall(dofile, vim.fn.getcwd() .. "/dot_config/nvim/lua/plugins/yanky.lua")
t.truthy(ok, "local Yanky override must exist")

local yanky = specs[1]
t.eq("gbprod/yanky.nvim", yanky[1], "Yanky must remain enabled")
t.eq(nil, yanky.enabled, "the local override must not disable Yanky")
t.eq(1, #yanky.keys, "the local override must preserve all unrelated Yanky keys")
t.eq("<leader>p", yanky.keys[1][1])
t.eq(false, yanky.keys[1][2], "Lazy.nvim false rhs must disable the inherited mapping")
t.eq({ "n", "x" }, yanky.keys[1].mode, "normal and visual Yank History mappings must both be disabled")
