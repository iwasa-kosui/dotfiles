local M = {}

local providers = { claude = true, codex = true }
local default_provider = "claude"
local codex_commands = {}

---@class AiContext
---@field path string
---@field startLine integer?
---@field endLine integer?
---@field text string?

---@param path string
---@param start_line integer?
---@param end_line integer?
---@param text string?
---@return AiContext
function M.context(path, start_line, end_line, text)
  return {
    path = path,
    startLine = start_line,
    endLine = end_line,
    text = text,
  }
end

---@param context AiContext
---@param root string
---@return string
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

local function root()
  local ok, lazy_root = pcall(require, "lazyvim.util")
  if ok then
    return lazy_root.root.get({ normalize = true }) or vim.uv.cwd() or vim.fn.getcwd()
  end
  return vim.uv.cwd() or vim.fn.getcwd()
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
  if ok and type(state) == "table" and providers[state.provider] then
    return state.provider
  end
  return default_provider
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

local function hide_codex()
  local ok, snacks = pcall(require, "snacks")
  if not ok then
    return
  end
  for _, terminal in ipairs(snacks.terminal.list()) do
    if vim.b[terminal.buf].ai_dock_provider == "codex" and terminal_visible(terminal) then
      terminal:hide()
    end
  end
end

local function hide_claude()
  local ok, terminal = pcall(require, "claudecode.terminal")
  if not ok or not terminal.get_active_terminal_bufnr then
    return
  end
  local buffer = terminal.get_active_terminal_bufnr()
  if not buffer then
    return
  end
  for _, window in ipairs(vim.fn.win_findbuf(buffer)) do
    vim.api.nvim_win_hide(window)
  end
end

local function ensure_explorer()
  local ok, workspace = pcall(require, "user.workspace")
  if ok and workspace.ensure_explorer then
    workspace.ensure_explorer({ focus = false })
  end
end

---@param provider "claude"|"codex"
---@param buffer integer
function M.attach(provider, buffer)
  vim.b[buffer].ai_dock_provider = provider
  vim.keymap.set("n", "p", M.switch_provider, { buffer = buffer, desc = "Switch AI provider" })
  vim.keymap.set("n", "r", M.resume, { buffer = buffer, desc = "Resume AI provider" })
end

local function attach_claude()
  local ok, terminal = pcall(require, "claudecode.terminal")
  if not ok or not terminal.get_active_terminal_bufnr then
    return
  end
  local buffer = terminal.get_active_terminal_bufnr()
  if buffer then
    M.attach("claude", buffer)
  end
end

local function codex_command(cwd)
  return codex_commands[cwd] or { "codex", "-C", cwd }
end

local function show_codex(cwd)
  ensure_explorer()
  hide_claude()
  local command = codex_command(cwd)
  local opts = {
    cwd = cwd,
    auto_close = false,
    win = {
      position = "right",
      width = 0.36,
      height = 1,
      border = "rounded",
    },
  }
  local terminal = Snacks.terminal.get(command, opts)
  assert(terminal, "failed to create Codex terminal")
  M.attach("codex", terminal.buf)
  terminal:show()
  terminal:focus()
end

local function show_claude()
  ensure_explorer()
  hide_codex()
  vim.cmd("ClaudeCodeFocus")
  vim.schedule(attach_claude)
end

local function show_provider(provider)
  select_provider(provider)
  if provider == "codex" then
    show_codex(root())
  else
    show_claude()
  end
end

function M.toggle()
  local provider = current_provider()
  if provider == "codex" then
    local ok, snacks = pcall(require, "snacks")
    local terminal = ok and snacks.terminal.get(codex_command(root()), { cwd = root(), create = false }) or nil
    if terminal_visible(terminal) then
      terminal:hide()
      return
    end
  end
  show_provider(provider)
end

function M.switch_provider()
  show_provider(current_provider() == "claude" and "codex" or "claude")
end

function M.resume()
  local provider = current_provider()
  if provider == "codex" then
    local cwd = root()
    hide_codex()
    codex_commands[cwd] = { "codex", "-C", cwd, "resume", "--last" }
    show_provider("codex")
    return
  end
  hide_codex()
  vim.cmd("ClaudeCode --resume")
  vim.schedule(attach_claude)
end

local function current_file_context()
  local path = vim.api.nvim_buf_get_name(0)
  if path == "" then
    vim.notify("No file is open", vim.log.levels.WARN)
    return nil
  end
  return M.context(path)
end

local function visual_context()
  local start_pos = vim.fn.getpos("'<")
  local end_pos = vim.fn.getpos("'>")
  local start_line, end_line = start_pos[2], end_pos[2]
  if start_line == 0 or end_line == 0 then
    vim.notify("No selection is available", vim.log.levels.WARN)
    return nil
  end
  if start_line > end_line then
    start_line, end_line = end_line, start_line
  end
  local path = vim.api.nvim_buf_get_name(0)
  if path == "" then
    vim.notify("No file is open", vim.log.levels.WARN)
    return nil
  end
  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  return M.context(path, start_line, end_line, table.concat(lines, "\n"))
end

local function send_to_codex(context)
  local cwd = root()
  show_provider("codex")
  local ok, snacks = pcall(require, "snacks")
  if not ok then
    return
  end
  local terminal = snacks.terminal.get(codex_command(cwd), { cwd = cwd, create = false })
  if not terminal then
    return
  end
  local channel = vim.bo[terminal.buf].channel
  vim.api.nvim_chan_send(channel, M.codex_prompt(context, cwd) .. "\n")
end

local function send_to_claude(context, selection)
  local source_buffer = vim.api.nvim_get_current_buf()
  show_provider("claude")
  vim.api.nvim_buf_call(source_buffer, function()
    if selection then
      vim.cmd("'<,'>ClaudeCodeSend")
    else
      vim.cmd("ClaudeCodeAdd %")
    end
  end)
end

function M.send_file()
  local context = current_file_context()
  if not context then
    return
  end
  if current_provider() == "codex" then
    send_to_codex(context)
  else
    send_to_claude(context, false)
  end
end

function M.send_selection()
  local context = visual_context()
  if not context then
    return
  end
  if current_provider() == "codex" then
    send_to_codex(context)
  else
    send_to_claude(context, true)
  end
end

return M
