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

t.eq(
	true,
	ai.is_terminal_live({ buf = 7 }, {
		buf_valid = function()
			return true
		end,
		channel_of = function()
			return 42
		end,
		jobwait = function()
			return { -1 }
		end,
	})
)
t.eq(
	false,
	ai.is_terminal_live({ buf = 7 }, {
		buf_valid = function()
			return true
		end,
		channel_of = function()
			return 42
		end,
		jobwait = function()
			return { 0 }
		end,
	})
)

local terminals = {}
local created = 0
local discarded = 0
local adapter = {
	root = function()
		return "/repo/.wt/feature"
	end,
	provider = function()
		return "codex"
	end,
	ensure_explorer = function() end,
	terminal_get = function(command, opts)
		local key = table.concat(command, " ")
		local terminal = terminals[key]
		if not terminal and opts.create ~= false then
			created = created + 1
			terminal = {
				buf = created,
				live = true,
				show = function() end,
				focus = function() end,
				hide = function() end,
			}
			terminals[key] = terminal
		end
		return terminal
	end,
	terminal_live = function(terminal)
		return terminal.live
	end,
	discard_terminal = function(terminal)
		discarded = discarded + 1
		terminal.live = false
		for key, value in pairs(terminals) do
			if value == terminal then
				terminals[key] = nil
			end
		end
	end,
	activate_dock = function() end,
	attach_terminal = function() end,
	select_provider = function() end,
	notify = function(message)
		error(message)
	end,
}

local first = ai.resume_codex(adapter)
t.truthy(first and first.live)
first.live = false
local second = ai.resume_codex(adapter)
t.truthy(second and second.live)
t.truthy(first ~= second, "a second resume after process exit must create a new terminal")
t.eq(2, created)
t.eq(1, discarded)

local commands = {}
local sent_contexts = {}
local send_adapter = {
	provider = function()
		return "claude"
	end,
	show_claude = function() end,
	command = function(command)
		commands[#commands + 1] = command
	end,
	on_context = function(value)
		sent_contexts[#sent_contexts + 1] = value
	end,
}
ai.send_context(ai.context("/repo/file.lua"), false, send_adapter)
ai.send_context(ai.context("/repo/file.lua", 2, 4, "selected"), true, send_adapter)
t.eq({ "ClaudeCodeAdd %", "'<,'>ClaudeCodeSend" }, commands)
t.eq(2, #sent_contexts)

local notifications = {}
local result = ai.send_context(ai.context("/repo/file.lua"), false, {
	provider = function()
		return "codex"
	end,
	root = function()
		return "/repo"
	end,
	select_provider = function() end,
	ensure_explorer = function() end,
	prepare_dock = function() end,
	terminal_get = function()
		return nil
	end,
	notify = function(message)
		notifications[#notifications + 1] = message
	end,
})
t.eq(false, result)
t.truthy(#notifications > 0, "terminal creation failures must notify instead of asserting")

notifications = {}
local send_terminal = {
	buf = 99,
	show = function() end,
	focus = function() end,
}
result = ai.send_context(ai.context("/send/repo/file.lua"), false, {
	provider = function()
		return "codex"
	end,
	root = function()
		return "/send/repo"
	end,
	select_provider = function() end,
	ensure_explorer = function() end,
	prepare_dock = function() end,
	activate_dock = function() end,
	attach_terminal = function() end,
	terminal_get = function()
		return send_terminal
	end,
	terminal_live = function()
		return true
	end,
	channel_of = function()
		return 42
	end,
	channel_send = function()
		error("closed channel")
	end,
	notify = function(message)
		notifications[#notifications + 1] = message
	end,
})
t.eq(false, result)
t.truthy(notifications[#notifications]:find("送信できませんでした", 1, true) ~= nil)
