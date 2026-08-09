local t = require("testlib")
local ai = require("user.ai_dock")

local context = ai.context("/repo/lua/keymaps.lua", 10, 12, "local x = 1")
t.eq({
	path = "/repo/lua/keymaps.lua",
	startLine = 10,
	endLine = 12,
	text = "local x = 1",
}, context)

t.eq(
	"@lua/keymaps.lua 10-12行を確認してください。\n\n```\nlocal x = 1\n```",
	ai.codex_prompt(context, "/repo")
)
