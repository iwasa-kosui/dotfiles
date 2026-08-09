local M = {}

local terminals = {}
local started = {}
local explicit_closes = {}
local failures = {}
local terminal_states = setmetatable({}, { __mode = "k" })

local function default_root()
  local candidate = vim.uv.cwd() or vim.fn.getcwd()
  local ok, lazy = pcall(require, "lazyvim.util")
  if ok then
    candidate = lazy.root.get({ normalize = true }) or candidate
  end
  return require("user.worktree_root").resolve(candidate)
end

local function is_git_repo(path)
  local output = vim.fn.systemlist({ "git", "-C", path, "rev-parse", "--is-inside-work-tree" })
  return vim.v.shell_error == 0 and output[1] == "true"
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

local function defaults(adapter)
  adapter = adapter or {}
  return setmetatable(adapter, {
    __index = {
      root = default_root,
      has_ui = function()
        return #vim.api.nvim_list_uis() > 0
      end,
      executable = function()
        return vim.fn.executable("lazygit") == 1
      end,
      is_git_repo = is_git_repo,
      dock = require("user.dock"),
      lazygit = function(opts)
        return Snacks.lazygit(opts)
      end,
      terminal_live = M.is_terminal_live,
      set_keymap = vim.keymap.set,
      register_cleanup = function(buffer, callback)
        vim.api.nvim_create_autocmd({ "TermClose", "BufDelete", "BufWipeout" }, {
          buffer = buffer,
          callback = callback,
        })
      end,
      schedule = vim.schedule,
      discard_terminal = function(terminal)
        if terminal and type(terminal.close) == "function" then
          pcall(terminal.close, terminal, { buf = true })
        end
        if terminal and terminal.buf and vim.api.nvim_buf_is_valid(terminal.buf) then
          pcall(vim.api.nvim_buf_delete, terminal.buf, { force = true })
        end
      end,
      ensure_explorer = function()
        require("user.workspace").ensure_explorer({ focus = false })
      end,
      pr_list = function()
        require("user.pr_review").list()
      end,
      notify = function(message)
        vim.notify(message, vim.log.levels.WARN)
      end,
    },
  })
end

local function setup_keymaps(root, terminal, runtime)
  runtime.set_keymap("t", "<leader>pp", function()
    runtime.pr_list()
  end, { buffer = terminal.buf, desc = "List pull requests" })
  runtime.set_keymap("t", "<leader>po", "<F12>", {
    buffer = terminal.buf,
    desc = "Open selected pull request",
  })
  runtime.set_keymap("t", "q", function()
    explicit_closes[root] = true
    if terminal_states[terminal] then
      terminal_states[terminal].explicit = true
    end
    return "q"
  end, { buffer = terminal.buf, expr = true, desc = "Quit LazyGit" })
  runtime.set_keymap("t", "<C-c>", function()
    explicit_closes[root] = true
    if terminal_states[terminal] then
      terminal_states[terminal].explicit = true
    end
    return "<C-c>"
  end, { buffer = terminal.buf, expr = true, desc = "Quit LazyGit" })
end

local function notify_failure(root, message, runtime)
  if failures[root] then
    return
  end
  failures[root] = true
  runtime.notify(message)
end

local function available(root, runtime)
  return runtime.has_ui() and runtime.executable() and runtime.is_git_repo(root)
end

local function attach_cleanup(root, terminal, runtime)
  local state = terminal_states[terminal]
  runtime.register_cleanup(terminal.buf, function(event)
    if state.cleaned then
      return
    end
    state.cleaned = true
    if terminals[root] == terminal then
      terminals[root] = nil
      started[root] = nil
      explicit_closes[root] = nil
      runtime.dock:deactivate("lazygit", terminal, { explicit = state.explicit, restore = false })
    end
    if event and event.event == "TermClose" then
      state.discarding = true
      runtime.schedule(function()
        runtime.discard_terminal(terminal)
      end)
    end
  end)
end

local function on_window_closed(root, terminal, runtime)
  local state = terminal_states[terminal]
  if not state or state.suppressed > 0 or state.discarding or state.cleaned then
    return
  end
  if terminals[root] == terminal then
    runtime.dock:deactivate("lazygit", terminal, { explicit = true, restore = false })
  end
end

local function create(root, opts, runtime)
  local ok, terminal = pcall(runtime.lazygit, {
    cwd = root,
    auto_close = false,
    win = {
      position = "right",
      width = 0.36,
      height = 1,
      border = "rounded",
      enter = opts.focus ~= false,
      on_close = function(self)
        on_window_closed(root, self, runtime)
      end,
    },
  })
  if not ok or not terminal then
    notify_failure(root, "LazyGitを起動できませんでした", runtime)
    return nil
  end
  terminals[root] = terminal
  terminal_states[terminal] = { cleaned = false, discarding = false, explicit = false, suppressed = 0 }
  terminal.dock_hide = function(self)
    local state = terminal_states[self]
    if not state then
      return self:hide()
    end
    state.suppressed = state.suppressed + 1
    local ok_hide, result = pcall(self.hide, self)
    state.suppressed = state.suppressed - 1
    if not ok_hide then
      error(result)
    end
    return result
  end
  started[root] = true
  explicit_closes[root] = false
  setup_keymaps(root, terminal, runtime)
  attach_cleanup(root, terminal, runtime)
  return terminal
end

function M.open(opts, adapter)
  opts = opts or { focus = true }
  local runtime = defaults(adapter)
  local root = runtime.root()
  if not available(root, runtime) then
    return nil
  end
  runtime.ensure_explorer()

  local terminal = terminals[root]
  if terminal and not runtime.terminal_live(terminal) then
    local state = terminal_states[terminal]
    if state then
      state.discarding = true
      state.cleaned = true
    end
    runtime.discard_terminal(terminal)
    terminals[root] = nil
    terminal = nil
  end
  if not terminal then
    terminal = create(root, opts, runtime)
  end
  if not terminal then
    return nil
  end

  explicit_closes[root] = false
  if terminal_states[terminal] then
    terminal_states[terminal].explicit = false
  end
  runtime.dock:set_default("lazygit", function()
    return M.open({ focus = false }, runtime)
  end, runtime.terminal_live)
  if type(terminal.show) == "function" then
    terminal:show()
  end
  runtime.dock:activate("lazygit", terminal)
  if opts.focus ~= false and type(terminal.focus) == "function" then
    terminal:focus()
  end
  return terminal
end

function M.ensure(opts, adapter)
  opts = opts or { focus = false }
  local runtime = defaults(adapter)
  local root = runtime.root()
  if not available(root, runtime) then
    return nil
  end
  local terminal = terminals[root]
  if started[root] and terminal and runtime.terminal_live(terminal) then
    return terminal
  end
  return M.open(opts, runtime)
end

function M.reset_for_tests()
  terminals = {}
  started = {}
  explicit_closes = {}
  failures = {}
  terminal_states = setmetatable({}, { __mode = "k" })
end

return M
