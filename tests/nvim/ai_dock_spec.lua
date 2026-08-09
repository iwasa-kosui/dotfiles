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

local claude_dock = require("user.dock").new()
local first_claude_buffer = vim.api.nvim_create_buf(false, true)
local second_claude_buffer = vim.api.nvim_create_buf(false, true)
local hidden_claude_windows = {}
local claude_buffer_cleanups = {}
local claude_adapter = {
	buffer_valid = function(buffer)
		return vim.api.nvim_buf_is_valid(buffer)
	end,
	register_buffer_cleanup = function(buffer, callback)
		claude_buffer_cleanups[buffer] = callback
	end,
	windows_for_buffer = function(buffer)
		return { buffer + 1000 }
	end,
	hide_window = function(window)
		hidden_claude_windows[window] = (hidden_claude_windows[window] or 0) + 1
	end,
	activate_dock = function(name, handle)
		claude_dock:activate(name, handle)
	end,
}

ai.attach("claude", first_claude_buffer, claude_adapter)
local first_claude_handle = claude_dock.active.handle
ai.attach("claude", first_claude_buffer, claude_adapter)
t.eq(first_claude_handle, claude_dock.active.handle, "the same live Claude buffer must reuse its Dock handle")
t.eq(0, hidden_claude_windows[first_claude_buffer + 1000] or 0, "reattach must not hide the same Claude window")

claude_buffer_cleanups[first_claude_buffer]()
ai.attach("claude", first_claude_buffer, claude_adapter)
local replacement_claude_handle = claude_dock.active.handle
t.truthy(first_claude_handle ~= replacement_claude_handle, "a wiped and reused buffer number needs a new Dock handle")
t.eq(0, hidden_claude_windows[first_claude_buffer + 1000] or 0, "an invalidated handle must not hide its replacement")

ai.attach("claude", second_claude_buffer, claude_adapter)
t.truthy(replacement_claude_handle ~= claude_dock.active.handle, "a replacement Claude buffer needs a new Dock handle")
t.eq(1, hidden_claude_windows[first_claude_buffer + 1000], "replacing the Claude buffer must hide its old window")
t.eq(0, hidden_claude_windows[second_claude_buffer + 1000] or 0)

vim.api.nvim_buf_delete(first_claude_buffer, { force = true })
vim.api.nvim_buf_delete(second_claude_buffer, { force = true })

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

local function expect_claude_attach_failure(preload, reason)
	local previous_terminal = package.loaded["claudecode.terminal"]
	local previous_preload = package.preload["claudecode.terminal"]
	local restored = 0
	local notifications = {}
	local activated = 0
	local cleanup_registrations = 0
	package.loaded["claudecode.terminal"] = nil
	package.preload["claudecode.terminal"] = preload

	ai.switch_provider({
		provider = function()
			return "codex"
		end,
		select_provider = function() end,
		ensure_explorer = function() end,
		prepare_dock = function() end,
		command = function() end,
		activate_dock = function()
			activated = activated + 1
		end,
		register_buffer_cleanup = function()
			cleanup_registrations = cleanup_registrations + 1
		end,
		schedule = function(callback)
			callback()
		end,
		restore_dock = function()
			restored = restored + 1
		end,
		notify = function(message)
			notifications[#notifications + 1] = message
		end,
	})

	package.loaded["claudecode.terminal"] = previous_terminal
	package.preload["claudecode.terminal"] = previous_preload
	t.eq(1, restored, reason .. " must restore LazyGit")
	t.truthy(#notifications > 0, reason .. " must notify")
	t.eq(0, activated, reason .. " must not activate Claude Dock")
	t.eq(0, cleanup_registrations, reason .. " must not register cleanup")
end

expect_claude_attach_failure(function()
	error("terminal module failed")
end, "Claude terminal require failure")
expect_claude_attach_failure(function()
	return {}
end, "missing active-terminal getter")
expect_claude_attach_failure(function()
	return {
		get_active_terminal_bufnr = function()
			error("active terminal lookup failed")
		end,
	}
end, "active-terminal getter failure")
expect_claude_attach_failure(function()
	return {
		get_active_terminal_bufnr = function()
			return nil
		end,
	}
end, "missing active Claude buffer")

local function expect_stale_claude_callback_is_ignored(preload, reason)
	local previous_terminal = package.loaded["claudecode.terminal"]
	local previous_preload = package.preload["claudecode.terminal"]
	local callbacks = {}
	local notifications = {}
	local restored = 0
	local shared_dock = require("user.dock").new()
	local codex = {
		buf = 202,
		live = true,
		show = function() end,
		focus = function() end,
		hide = function() end,
	}
	package.loaded["claudecode.terminal"] = nil
	package.preload["claudecode.terminal"] = preload

	local adapter = {
		provider = function()
			return "codex"
		end,
		root = function()
			return "/repo"
		end,
		select_provider = function() end,
		ensure_explorer = function() end,
		prepare_dock = function(name)
			shared_dock:prepare(name)
		end,
		activate_dock = function(name, handle)
			shared_dock:activate(name, handle)
		end,
		deactivate_dock = function(name, handle)
			shared_dock:deactivate(name, handle)
		end,
		restore_dock = function()
			restored = restored + 1
		end,
		command = function() end,
		schedule = function(callback)
			callbacks[#callbacks + 1] = callback
		end,
		terminal_get = function(_, opts)
			if opts.create == false then
				return nil
			end
			return codex
		end,
		terminal_live = function()
			return true
		end,
		terminal_visible = function()
			return false
		end,
		attach_terminal = function() end,
		notify = function(message)
			notifications[#notifications + 1] = message
		end,
	}

	ai.switch_provider(adapter)
	t.eq(1, #callbacks, reason .. " must schedule Claude attach")
	ai.toggle(adapter)
	t.eq(codex, shared_dock.active.handle, reason .. " must activate Codex before old Claude callback")
	callbacks[1]()

	package.loaded["claudecode.terminal"] = previous_terminal
	package.preload["claudecode.terminal"] = previous_preload
	t.eq(codex, shared_dock.active.handle, reason .. " must not replace current Codex")
	t.eq(0, restored, reason .. " must not restore LazyGit")
	t.eq(0, #notifications, reason .. " must not notify")
end

expect_stale_claude_callback_is_ignored(function()
	return {
		get_active_terminal_bufnr = function()
			return vim.api.nvim_create_buf(false, true)
		end,
	}
end, "stale successful Claude callback")
expect_stale_claude_callback_is_ignored(function()
	error("terminal module failed")
end, "stale failed Claude callback")

local original_create_autocmd = vim.api.nvim_create_autocmd
local registered_cleanup_events
local cleanup_callbacks = {}
vim.api.nvim_create_autocmd = function(events, opts)
	registered_cleanup_events = events
	cleanup_callbacks[#cleanup_callbacks + 1] = opts.callback
	return 1
end
local cleanup_buffer = vim.api.nvim_create_buf(false, true)
local cleanup_dock = require("user.dock").new()
local cleanup_lazygit = { shown = 0, live = true }
function cleanup_lazygit:show()
	self.shown = self.shown + 1
end
cleanup_dock:set_default("lazygit", function()
	return cleanup_lazygit
end, function(handle)
	return handle.live
end)
cleanup_dock:activate("lazygit", cleanup_lazygit)
local cleanup_discards = 0
local cleanup_codex = {
	hide = function() end,
	close = function(_, opts)
		t.eq({ buf = true }, opts)
		cleanup_discards = cleanup_discards + 1
	end,
}
cleanup_dock:activate("codex", cleanup_codex)
ai.attach("codex", cleanup_buffer, {
	buffer_valid = function()
		return true
	end,
	activate_dock = function() end,
	deactivate_dock = function(name, handle)
		cleanup_dock:deactivate(name, handle)
	end,
	discard_terminal = function(handle)
		handle:close({ buf = true })
	end,
	schedule = function(callback)
		callback()
	end,
}, cleanup_codex)
t.eq({ "TermClose", "BufDelete", "BufWipeout" }, registered_cleanup_events)
for _, event in ipairs({ "TermClose", "BufDelete", "BufWipeout" }) do
	cleanup_callbacks[1]({ event = event })
end
t.eq(cleanup_lazygit, cleanup_dock.active.handle, "the active Codex cleanup must restore LazyGit once")
t.eq(1, cleanup_lazygit.shown, "duplicate cleanup events must be idempotent")
t.eq(1, cleanup_discards, "Codex TermClose must destroy its dead Snacks window and buffer once")

local current_codex = { hide = function() end }
cleanup_dock:activate("codex", current_codex)
cleanup_callbacks[1]({ event = "BufDelete" })
t.eq(current_codex, cleanup_dock.active.handle, "a stale cleanup must keep the replacement AI Dock active")

local disabled_buffer = vim.api.nvim_create_buf(false, true)
local disabled_codex = { hide = function() end }
cleanup_dock:activate("codex", disabled_codex)
ai.attach("codex", disabled_buffer, {
	buffer_valid = function()
		return true
	end,
	activate_dock = function() end,
	deactivate_dock = function(name, handle)
		cleanup_dock:deactivate(name, handle)
	end,
}, disabled_codex)
cleanup_dock:disable_default()
cleanup_callbacks[2]({ event = "TermClose" })
t.eq(nil, cleanup_dock.active, "disabled LazyGit fallback must not reopen after AI cleanup")
vim.api.nvim_create_autocmd = original_create_autocmd
vim.api.nvim_buf_delete(cleanup_buffer, { force = true })
vim.api.nvim_buf_delete(disabled_buffer, { force = true })

local deactivated = {}
local visible_codex = {
	buf = 88,
	win = vim.api.nvim_get_current_win(),
	hide = function(self)
		self.hidden = true
	end,
}
ai.toggle({
	provider = function()
		return "codex"
	end,
	select_provider = function() end,
	root = function()
		return "/repo"
	end,
	terminal_get = function()
		return visible_codex
	end,
	terminal_visible = function()
		return true
	end,
	deactivate_dock = function(name, handle)
		deactivated[#deactivated + 1] = { name, handle }
	end,
})
t.eq(true, visible_codex.hidden)
t.eq({ { "codex", visible_codex } }, deactivated)

local restored = 0
ai.toggle({
	provider = function()
		return "codex"
	end,
	select_provider = function() end,
	root = function()
		return "/repo"
	end,
	ensure_explorer = function() end,
	prepare_dock = function() end,
	terminal_get = function()
		error("terminal failed")
	end,
	restore_dock = function()
		restored = restored + 1
	end,
	notify = function() end,
})
t.eq(1, restored, "Codex creation failure must restore LazyGit")

local transition_dock = require("user.dock").new()
local transition_terminals = {}
local transition_created = 0
local transition_adapter = {
	root = function()
		return "/repo/.wt/live-transition"
	end,
	provider = function()
		return "codex"
	end,
	select_provider = function() end,
	ensure_explorer = function() end,
	prepare_dock = function(name)
		transition_dock:prepare(name)
	end,
	activate_dock = function(name, terminal)
		transition_dock:activate(name, terminal)
	end,
	terminal_get = function(command, opts)
		local key = table.concat(command, " ")
		local terminal = transition_terminals[key]
		if not terminal and opts.create ~= false then
			transition_created = transition_created + 1
			terminal = {
				buf = transition_created,
				live = true,
				hidden = 0,
				show = function() end,
				focus = function() end,
				hide = function(self)
					self.hidden = self.hidden + 1
					if self.on_close then
						self.on_close(self)
					end
				end,
			}
			terminal.on_close = opts.win.on_close
			transition_terminals[key] = terminal
		end
		return terminal
	end,
	terminal_live = function(terminal)
		return terminal.live
	end,
	discard_terminal = function() end,
	attach_terminal = function() end,
	deactivate_dock = function(name, terminal)
		transition_dock:deactivate(name, terminal)
	end,
	notify = function(message)
		error(message)
	end,
}

ai.toggle(transition_adapter)
local normal = transition_terminals["codex -C /repo/.wt/live-transition"]
t.truthy(normal and normal.live, "the live normal Codex terminal must be active before resume")
local resumed = ai.resume_codex(transition_adapter)
t.truthy(resumed and resumed ~= normal, "resume must create a distinct command terminal")
t.eq(1, normal.hidden, "resume must hide the live normal Codex terminal")
t.eq(0, resumed.hidden, "the resumed Codex terminal must remain visible")
t.eq(resumed, transition_dock.active.handle, "only the resumed terminal may remain active")

local hide_dock = require("user.dock").new()
local hide_lazygit = { live = true, shown = 0, hide = function() end }
function hide_lazygit:show()
	self.shown = self.shown + 1
end
hide_dock:set_default("lazygit", function()
	return hide_lazygit
end, function(handle)
	return handle.live
end)
hide_dock:activate("lazygit", hide_lazygit)
local codex_opts
local hidden_codex_buffer = vim.api.nvim_create_buf(false, true)
local hidden_codex = {
	buf = hidden_codex_buffer,
	live = true,
	show = function() end,
	focus = function() end,
	hide = function(self)
		if codex_opts and codex_opts.win.on_close then
			codex_opts.win.on_close(self)
		end
	end,
}
local hide_adapter = {
	root = function()
		return "/repo/hide"
	end,
	provider = function()
		return "codex"
	end,
	select_provider = function() end,
	ensure_explorer = function() end,
	prepare_dock = function(name)
		hide_dock:prepare(name)
	end,
	activate_dock = function(name, handle)
		hide_dock:activate(name, handle)
	end,
	deactivate_dock = function(name, handle)
		hide_dock:deactivate(name, handle)
	end,
	terminal_get = function(_, opts)
		if opts.create == false and not codex_opts then
			return nil
		end
		codex_opts = opts.create == false and codex_opts or opts
		return hidden_codex
	end,
	terminal_live = function()
		return true
	end,
	terminal_visible = function()
		return codex_opts ~= nil and hide_dock.active and hide_dock.active.handle == hidden_codex
	end,
	attach_terminal = function(provider, buffer, runtime, handle)
		ai.attach(provider, buffer, runtime, handle)
	end,
	buffer_valid = function()
		return true
	end,
	register_buffer_cleanup = function() end,
	notify = function(message)
		error(message)
	end,
}
ai.toggle(hide_adapter)
t.eq(hidden_codex, hide_dock.active.handle)
codex_opts.win.on_close(hidden_codex)
t.eq(hide_lazygit, hide_dock.active.handle, "Codex normal q/window close must restore LazyGit")
t.eq(1, hide_lazygit.shown)
codex_opts.win.on_close(hidden_codex)
t.eq(hide_lazygit, hide_dock.active.handle, "duplicate Codex close must not disturb restored LazyGit")
vim.api.nvim_buf_delete(hidden_codex_buffer, { force = true })

local claude_dock_toggle = require("user.dock").new()
local claude_lazygit = { live = true, shown = 0, hide = function() end }
function claude_lazygit:show()
	self.shown = self.shown + 1
end
claude_dock_toggle:set_default("lazygit", function()
	return claude_lazygit
end, function(handle)
	return handle.live
end)
claude_dock_toggle:activate("lazygit", claude_lazygit)
local claude_buffer = vim.api.nvim_create_buf(false, true)
local claude_visible = false
local claude_command_calls = 0
local claude_toggle_adapter = {
	prepare_dock = function(name)
		claude_dock_toggle:prepare(name)
	end,
	activate_dock = function(name, handle)
		claude_dock_toggle:activate(name, handle)
	end,
	deactivate_dock = function(name, handle)
		claude_dock_toggle:deactivate(name, handle)
	end,
	ensure_explorer = function() end,
	claude_buffer = function()
		return claude_buffer
	end,
	buffer_valid = function()
		return true
	end,
	buffer_visible = function()
		return claude_visible
	end,
	buffer_focused = function()
		return claude_visible
	end,
	command = function()
		claude_command_calls = claude_command_calls + 1
		claude_visible = not claude_visible
	end,
	schedule = function(callback)
		callback()
	end,
	register_buffer_cleanup = function() end,
	windows_for_buffer = function()
		return {}
	end,
}
ai.toggle_claude(claude_toggle_adapter)
t.eq("claude", claude_dock_toggle.active.name, "<leader>aa must activate Claude when opening")
ai.toggle_claude(claude_toggle_adapter)
t.eq(claude_lazygit, claude_dock_toggle.active.handle, "<leader>aa must restore LazyGit when hiding")
ai.focus_claude(claude_toggle_adapter)
t.eq("claude", claude_dock_toggle.active.name, "global <C-,> must activate Claude when opening")
ai.focus_claude(claude_toggle_adapter)
t.eq(claude_lazygit, claude_dock_toggle.active.handle, "global <C-,> must restore LazyGit when hiding")
t.eq(4, claude_command_calls)
vim.api.nvim_buf_delete(claude_buffer, { force = true })

local provider_dock = require("user.dock").new()
local provider_lazygit = { live = true, shown = 0, hide = function() end }
function provider_lazygit:show()
	self.shown = self.shown + 1
end
provider_dock:set_default("lazygit", function()
	return provider_lazygit
end, function(handle)
	return handle.live
end)
provider_dock:activate("lazygit", provider_lazygit)
local provider_claude_buffer = vim.api.nvim_create_buf(false, true)
local provider_codex_buffer = vim.api.nvim_create_buf(false, true)
local provider_codex_opts
local provider_codex = {
	buf = provider_codex_buffer,
	live = true,
	show = function() end,
	focus = function() end,
	hide = function(self)
		provider_codex_opts.win.on_close(self)
	end,
}
local selected_provider = "claude"
local provider_adapter
provider_adapter = {
	provider = function()
		return selected_provider
	end,
	select_provider = function(provider)
		selected_provider = provider
	end,
	root = function()
		return "/repo/providers"
	end,
	ensure_explorer = function() end,
	prepare_dock = function(name)
		provider_dock:prepare(name)
	end,
	activate_dock = function(name, handle)
		provider_dock:activate(name, handle)
	end,
	deactivate_dock = function(name, handle)
		provider_dock:deactivate(name, handle)
	end,
	terminal_get = function(_, opts)
		if opts.create == false and not provider_codex_opts then
			return nil
		end
		provider_codex_opts = opts.create == false and provider_codex_opts or opts
		return provider_codex
	end,
	terminal_live = function()
		return true
	end,
	attach_terminal = function(provider, buffer, runtime, handle)
		ai.attach(provider, buffer, runtime, handle)
	end,
	claude_buffer = function()
		return provider_claude_buffer
	end,
	buffer_valid = function()
		return true
	end,
	register_buffer_cleanup = function() end,
	windows_for_buffer = function()
		return { 9001 }
	end,
	hide_window = function()
		ai.on_hidden("claude", provider_claude_buffer, provider_adapter)
	end,
	command = function() end,
	schedule = function(callback)
		callback()
	end,
	notify = function(message)
		error(message)
	end,
}
ai.attach("claude", provider_claude_buffer, provider_adapter)
ai.switch_provider(provider_adapter)
t.eq("codex", provider_dock.active.name, "Claude to Codex must not restore LazyGit between providers")
t.eq(0, provider_lazygit.shown)
ai.switch_provider(provider_adapter)
t.eq("claude", provider_dock.active.name, "Codex to Claude must not restore LazyGit between providers")
t.eq(0, provider_lazygit.shown)
vim.api.nvim_buf_delete(provider_claude_buffer, { force = true })
vim.api.nvim_buf_delete(provider_codex_buffer, { force = true })

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
