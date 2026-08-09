local M = {}

local terminals = {}
local started = {}
local explicit_closes = {}
local failures = {}

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
        vim.api.nvim_create_autocmd("TermClose", { buffer = buffer, once = true, callback = callback })
      end,
      ensure_explorer = function()
        require("user.workspace").ensure_explorer({ focus = false })
      end,
      notify = function(message)
        vim.notify(message, vim.log.levels.WARN)
      end,
    },
  })
end

local function setup_keymaps(root, terminal, runtime)
  runtime.set_keymap("t", "<leader>pp", function()
    require("user.pr_review").list()
  end, { buffer = terminal.buf, desc = "List pull requests" })
  runtime.set_keymap("t", "<leader>po", "<F12>", {
    buffer = terminal.buf,
    desc = "Open selected pull request",
  })
  runtime.set_keymap("t", "q", function()
    explicit_closes[root] = true
    return "q"
  end, { buffer = terminal.buf, expr = true, desc = "Quit LazyGit" })
  runtime.set_keymap("t", "<C-c>", function()
    explicit_closes[root] = true
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

local function attach_cleanup(root, terminal, runtime)
  runtime.register_cleanup(terminal.buf, function()
    if terminals[root] ~= terminal then
      return
    end
    terminals[root] = nil
    started[root] = nil
    local explicit = explicit_closes[root] == true
    explicit_closes[root] = nil
    runtime.dock:deactivate("lazygit", terminal, { explicit = explicit, restore = false })
  end)
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
    },
  })
  if not ok or not terminal then
    notify_failure(root, "LazyGitを起動できませんでした", runtime)
    return nil
  end
  terminals[root] = terminal
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
  runtime.ensure_explorer()

  local terminal = terminals[root]
  if terminal and not runtime.terminal_live(terminal) then
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
  if not runtime.has_ui() then
    return nil
  end
  if not runtime.executable() then
    return nil
  end
  local root = runtime.root()
  if not runtime.is_git_repo(root) then
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
end

return M
