local M = {}

local providers = { claude = true, codex = true }
local default_provider = "claude"
local codex_commands = {}
local claude_handles = {}

---@class AiContext
---@field path string
---@field startLine integer?
---@field endLine integer?
---@field text string?

function M.context(path, start_line, end_line, text)
  return { path = path, startLine = start_line, endLine = end_line, text = text }
end

function M.codex_prompt(context, root)
  local path = vim.fs.relpath(root, context.path) or context.path
  local prompt = "@" .. path
  if context.startLine and context.endLine then
    prompt = prompt .. (" %d-%d行を確認してください。"):format(context.startLine, context.endLine)
  else
    prompt = prompt .. "を確認してください。"
  end
  if context.text then
    prompt = prompt .. "\n\n```\n" .. context.text .. "\n```"
  end
  return prompt
end

local function default_root()
  local candidate = vim.uv.cwd() or vim.fn.getcwd()
  local ok, lazy = pcall(require, "lazyvim.util")
  if ok then
    candidate = lazy.root.get({ normalize = true }) or candidate
  end
  return require("user.worktree_root").resolve(candidate)
end

local function state_path()
  return vim.fn.stdpath("state") .. "/ai-dock.json"
end

local function current_provider()
  local file = io.open(state_path(), "r")
  if not file then
    return default_provider
  end
  local contents = file:read("*a")
  file:close()
  local ok, state = pcall(vim.json.decode, contents)
  return ok and type(state) == "table" and providers[state.provider] and state.provider or default_provider
end

local function select_provider(provider)
  if not providers[provider] then
    return
  end
  vim.fn.mkdir(vim.fn.stdpath("state"), "p")
  vim.fn.writefile({ vim.json.encode({ provider = provider }) }, state_path())
end

local function terminal_visible(terminal)
  return terminal and terminal.win and vim.api.nvim_win_is_valid(terminal.win)
end

function M.is_terminal_live(terminal, adapter)
  adapter = adapter or {}
  local buf_valid = adapter.buf_valid or vim.api.nvim_buf_is_valid
  local channel_of = adapter.channel_of or function(buffer)
    return vim.bo[buffer].channel
  end
  local jobwait = adapter.jobwait or vim.fn.jobwait
  if not terminal or not terminal.buf or not buf_valid(terminal.buf) then
    return false
  end
  local channel = channel_of(terminal.buf)
  if type(channel) ~= "number" or channel <= 0 then
    return false
  end
  local ok, status = pcall(jobwait, { channel }, 0)
  return ok and status[1] == -1
end

local function discard_terminal(terminal)
  if terminal and type(terminal.close) == "function" then
    pcall(terminal.close, terminal, { buf = true })
  end
  if terminal and terminal.buf and vim.api.nvim_buf_is_valid(terminal.buf) then
    pcall(vim.api.nvim_buf_delete, terminal.buf, { force = true })
  end
end

local function api(adapter)
  adapter = adapter or {}
  local dock = require("user.dock")
  return setmetatable(adapter, {
    __index = {
      root = default_root,
      provider = current_provider,
      select_provider = select_provider,
      notify = function(message, level)
        vim.notify(message, level or vim.log.levels.ERROR)
      end,
      ensure_explorer = function()
        require("user.workspace").ensure_explorer({ focus = false })
      end,
      terminal_get = function(command, opts)
        return require("snacks").terminal.get(command, opts)
      end,
      terminal_list = function()
        return require("snacks").terminal.list()
      end,
      terminal_live = M.is_terminal_live,
      discard_terminal = discard_terminal,
      prepare_dock = function(name)
        dock:prepare(name)
      end,
      activate_dock = function(name, handle)
        dock:activate(name, handle)
      end,
      command = vim.cmd,
      schedule = vim.schedule,
      buffer_call = vim.api.nvim_buf_call,
      channel_of = function(buffer)
        return vim.bo[buffer].channel
      end,
      channel_send = vim.api.nvim_chan_send,
      buffer_valid = vim.api.nvim_buf_is_valid,
      windows_for_buffer = vim.fn.win_findbuf,
      hide_window = vim.api.nvim_win_hide,
      register_buffer_cleanup = function(buffer, callback)
        vim.api.nvim_create_autocmd("BufWipeout", { buffer = buffer, once = true, callback = callback })
      end,
      attach_terminal = function(provider, buffer, runtime)
        M.attach(provider, buffer, runtime)
      end,
    },
  })
end

local function claude_handle(buffer, runtime)
  local cached = claude_handles[buffer]
  if cached and runtime.buffer_valid(buffer) then
    return cached
  end
  local handle
  handle = {
    hide = function()
      if claude_handles[buffer] ~= handle then
        return
      end
      for _, window in ipairs(runtime.windows_for_buffer(buffer)) do
        pcall(runtime.hide_window, window)
      end
    end,
  }
  claude_handles[buffer] = handle
  runtime.register_buffer_cleanup(buffer, function()
    if claude_handles[buffer] == handle then
      claude_handles[buffer] = nil
    end
  end)
  return handle
end

function M.attach(provider, buffer, adapter)
  local runtime = api(adapter)
  if not runtime.buffer_valid(buffer) then
    return
  end
  vim.b[buffer].ai_dock_provider = provider
  vim.keymap.set("n", "p", M.switch_provider, { buffer = buffer, desc = "Switch AI provider" })
  vim.keymap.set("n", "r", M.resume, { buffer = buffer, desc = "Resume AI provider" })
  if provider == "claude" then
    runtime.activate_dock("claude", claude_handle(buffer, runtime))
  end
end

local function attach_claude(adapter)
  local ok, terminal = pcall(require, "claudecode.terminal")
  if not ok or not terminal.get_active_terminal_bufnr then
    return
  end
  local buffer = terminal.get_active_terminal_bufnr()
  if buffer then
    M.attach("claude", buffer, adapter)
  end
end

local function codex_command(cwd)
  return codex_commands[cwd] or { "codex", "-C", cwd }
end

local function show_codex(cwd, adapter)
  local runtime = api(adapter)
  runtime.ensure_explorer()
  runtime.prepare_dock("codex")
  local command = codex_command(cwd)
  local lookup = { cwd = cwd, create = false }
  local ok, terminal = pcall(runtime.terminal_get, command, lookup)
  if not ok then
    runtime.notify("Codex Dockを確認できませんでした: " .. tostring(terminal))
    return nil
  end
  if terminal and not runtime.terminal_live(terminal) then
    runtime.discard_terminal(terminal)
    terminal = nil
  end
  if not terminal then
    local opts = {
      cwd = cwd,
      auto_close = false,
      win = { position = "right", width = 0.36, height = 1, border = "rounded" },
    }
    ok, terminal = pcall(runtime.terminal_get, command, opts)
  end
  if not ok or not terminal then
    runtime.notify("Codex Dockを作成できませんでした" .. (ok and "" or ": " .. tostring(terminal)))
    return nil
  end
  runtime.attach_terminal("codex", terminal.buf, runtime)
  local shown, show_error = pcall(function()
    terminal:show()
    terminal:focus()
  end)
  if not shown then
    runtime.notify("Codex Dockを表示できませんでした: " .. tostring(show_error))
    return nil
  end
  runtime.activate_dock("codex", terminal)
  return terminal
end

local function show_claude(adapter)
  local runtime = api(adapter)
  runtime.ensure_explorer()
  runtime.prepare_dock("claude")
  local ok, err = pcall(runtime.command, "ClaudeCodeFocus")
  if not ok then
    runtime.notify("Claude Dockを表示できませんでした: " .. tostring(err))
    return
  end
  runtime.schedule(function()
    attach_claude(runtime)
  end)
end

local function show_provider(provider, adapter)
  local runtime = api(adapter)
  runtime.select_provider(provider)
  if provider == "codex" then
    return show_codex(runtime.root(), runtime)
  end
  return show_claude(runtime)
end

function M.toggle(adapter)
  local runtime = api(adapter)
  local provider = runtime.provider()
  if provider == "codex" then
    local cwd = runtime.root()
    local terminal = runtime.terminal_get(codex_command(cwd), { cwd = cwd, create = false })
    if terminal_visible(terminal) then
      terminal:hide()
      return
    end
  end
  show_provider(provider, runtime)
end

function M.switch_provider(adapter)
  local runtime = api(adapter)
  show_provider(runtime.provider() == "claude" and "codex" or "claude", runtime)
end

function M.resume_codex(adapter)
  local runtime = api(adapter)
  local cwd = runtime.root()
  codex_commands[cwd] = { "codex", "-C", cwd, "resume", "--last" }
  return show_provider("codex", runtime)
end

function M.resume(adapter)
  local runtime = api(adapter)
  if runtime.provider() == "codex" then
    return M.resume_codex(runtime)
  end
  runtime.ensure_explorer()
  runtime.prepare_dock("claude")
  local ok, err = pcall(runtime.command, "ClaudeCode --resume")
  if not ok then
    runtime.notify("Claudeセッションを再開できませんでした: " .. tostring(err))
    return
  end
  runtime.schedule(function()
    attach_claude(runtime)
  end)
end

local function send_to_codex(context, adapter)
  local runtime = api(adapter)
  local cwd = runtime.root()
  local terminal = show_codex(cwd, runtime)
  if not terminal or not runtime.terminal_live(terminal) then
    runtime.notify("Codexプロセスが起動していません")
    return false
  end
  local channel = runtime.channel_of(terminal.buf)
  local ok, err = pcall(runtime.channel_send, channel, M.codex_prompt(context, cwd) .. "\n")
  if not ok then
    runtime.notify("Codexへコンテキストを送信できませんでした: " .. tostring(err))
    return false
  end
  return true
end

function M.send_context(context, selection, adapter)
  local runtime = api(adapter)
  if runtime.on_context then
    runtime.on_context(context)
  end
  if runtime.provider() == "codex" then
    return send_to_codex(context, runtime)
  end
  local source_buffer = vim.api.nvim_get_current_buf()
  if runtime.show_claude then
    runtime.show_claude()
  else
    show_claude(runtime)
  end
  local command = selection and "'<,'>ClaudeCodeSend" or "ClaudeCodeAdd %"
  local ok, err = pcall(runtime.buffer_call, source_buffer, function()
    runtime.command(command)
  end)
  if not ok then
    runtime.notify("Claudeへコンテキストを送信できませんでした: " .. tostring(err))
    return false
  end
  return true
end

local function current_file_context(adapter)
  local path = adapter.current_file and adapter.current_file() or vim.api.nvim_buf_get_name(0)
  if path == "" then
    adapter.notify("No file is open", vim.log.levels.WARN)
    return nil
  end
  return M.context(path)
end

local function visual_context(adapter)
  local start_pos = vim.fn.getpos("'<")
  local end_pos = vim.fn.getpos("'>")
  local start_line, end_line = start_pos[2], end_pos[2]
  if start_line == 0 or end_line == 0 then
    adapter.notify("No selection is available", vim.log.levels.WARN)
    return nil
  end
  if start_line > end_line then
    start_line, end_line = end_line, start_line
  end
  local path = adapter.current_file and adapter.current_file() or vim.api.nvim_buf_get_name(0)
  if path == "" then
    adapter.notify("No file is open", vim.log.levels.WARN)
    return nil
  end
  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  return M.context(path, start_line, end_line, table.concat(lines, "\n"))
end

function M.send_file(adapter)
  local runtime = api(adapter)
  local context = current_file_context(runtime)
  return context and M.send_context(context, false, runtime) or false
end

function M.send_selection(adapter)
  local runtime = api(adapter)
  local context = visual_context(runtime)
  return context and M.send_context(context, true, runtime) or false
end

return M
