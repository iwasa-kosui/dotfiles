local root = vim.fn.getcwd()
local t = dofile(root .. "/tests/nvim/testlib.lua")
local config = require("lazy.core.config")
local keys = require("lazy.core.handler.keys")
local plugin = require("lazy.core.plugin")

local function assert_no_single_pr_action(stage)
	for _, mode in ipairs({ "n", "x" }) do
		t.eq({}, vim.fn.maparg("<leader>p", mode, false, true), stage .. ": <leader>p must be prefix-only in " .. mode)
	end
end

local function assert_pr_actions(stage)
	for lhs, desc in pairs({
		["<leader>pp"] = "List PRs for review",
		["<leader>po"] = "Open branch PR for review",
	}) do
		local mapping = vim.fn.maparg(lhs, "n", false, true)
		t.eq(desc, mapping.desc, stage .. ": " .. lhs .. " must remain mapped")
		t.truthy(mapping.callback, stage .. ": " .. lhs .. " must keep its callback")
	end
end

local yanky = config.plugins["yanky.nvim"]
t.truthy(yanky, "resolved config must keep Yanky installed")
t.eq(nil, yanky._.loaded, "Yanky must start unloaded for the pre-load smoke check")

local resolved = keys.resolve(plugin.values(yanky, "keys", true))
t.eq(nil, resolved[" p"], "resolved normal Yank History key must be disabled")
t.eq(nil, resolved[" p (x)"], "resolved visual Yank History key must be disabled")
for _, id in ipairs({
	"y",
	"y (x)",
	"p",
	"p (x)",
	"P",
	"P (x)",
	"gp",
	"gp (x)",
	"gP",
	"gP (x)",
	"[y",
	"]y",
	"]p",
	"[p",
	"]P",
	"[P",
	">p",
	"<p",
	">P",
	"<P",
	"=p",
	"=P",
}) do
	t.truthy(resolved[id], "resolved Yanky key must remain: " .. id)
end

assert_no_single_pr_action("before plugin load")
assert_pr_actions("before plugin load")

require("lazy").load({ plugins = { "yanky.nvim" } })
t.truthy(yanky._.loaded, "Yanky must load for the post-load smoke check")
assert_no_single_pr_action("after Yanky load")
assert_pr_actions("after Yanky load")

local octo = config.plugins["octo.nvim"]
t.eq(nil, octo._.loaded, "Octo must start unloaded for the lazy-load smoke check")
require("lazy").load({ plugins = { "octo.nvim" } })
t.truthy(octo._.loaded, "Octo must load for the post-load smoke check")
assert_no_single_pr_action("after Octo load")
assert_pr_actions("after Octo load")
