local t = require("testlib")
local plugin = dofile(vim.fn.getcwd() .. "/dot_config/nvim/lua/plugins/octo.lua")
local submit_win = plugin.opts.mappings.submit_win

t.truthy(submit_win.close_review_win, "submit window cancel must only close the submit window")
t.eq("q", submit_win.close_review_win.lhs)
t.eq("n", submit_win.close_review_win.mode)
t.eq(nil, submit_win.close_review_tab)
t.eq(true, plugin.opts.mappings_disable_default)
t.eq("c", plugin.opts.mappings.review_diff.add_review_comment.lhs)
t.eq({ "x" }, plugin.opts.mappings.review_diff.add_review_comment.mode)
t.eq("s", plugin.opts.mappings.review_diff.add_review_suggestion.lhs)
t.eq({ "x" }, plugin.opts.mappings.review_diff.add_review_suggestion.mode)
t.eq("S", plugin.opts.mappings.review_diff.submit_review.lhs)
