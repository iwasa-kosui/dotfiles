local M = {}

local function default_root()
  local candidate = vim.uv.cwd() or vim.fn.getcwd()
  local ok, lazy = pcall(require, "lazyvim.util")
  if ok then
    candidate = lazy.root.get({ normalize = true }) or candidate
  end
  return require("user.worktree_root").resolve(candidate)
end

local function defaults(adapter)
  adapter = adapter or {}
  return setmetatable(adapter, {
    __index = {
      root = default_root,
      explorers = function()
        return Snacks.picker.get({ source = "explorer" })
      end,
      open_explorer = function(opts)
        return Snacks.explorer(opts)
      end,
      reveal = function(opts)
        return Snacks.explorer.reveal(opts)
      end,
      current_file = function()
        return vim.api.nvim_buf_get_name(0)
      end,
      refresh_base_diff = function(cwd)
        require("user.base_diff").refresh_and_render(cwd)
      end,
      restore_explorer = function(cwd)
        local state = require("user.explorer_state")
        state.restore_once(cwd, require("snacks.explorer.tree"))
      end,
      track_explorer = function(cwd)
        local state = require("user.explorer_state")
        state.track(cwd)
      end,
    },
  })
end

function M.ensure_explorer(opts, adapter)
  opts = opts or {}
  local api = defaults(adapter)
  local cwd = api.root()
  api.track_explorer(cwd)
  api.restore_explorer(cwd)
  local picker = api.explorers()[1]
  if not picker then
    picker = api.open_explorer({ cwd = cwd, focus = false, enter = false })
  end
  api.refresh_base_diff(cwd)
  if opts.focus ~= false and picker then
    picker:focus("list")
  end
  return picker
end

function M.focus_explorer(adapter)
  local api = defaults(adapter)
  local file = api.current_file()
  local picker = M.ensure_explorer({ focus = false }, api)
  if file ~= "" then
    picker = api.reveal({ file = file }) or picker
  end
  if picker then
    picker:focus("list")
  end
end

function M.files()
  Snacks.picker.files({ cwd = default_root() })
end

function M.search()
  Snacks.picker.grep({ cwd = default_root() })
end

function M.replace()
  require("grug-far").open({ transient = true, prefills = { paths = default_root() } })
end

function M.next_file()
  vim.cmd.bnext()
end

function M.previous_file()
  vim.cmd.bprevious()
end

function M.git_dock(adapter)
  adapter = adapter or {}
  local dock = adapter.dock or require("user.dock")
  local root = adapter.root or default_root
  local lazygit = adapter.lazygit or function(opts)
    return Snacks.lazygit(opts)
  end
  dock:prepare("git")
  local terminal = lazygit({
    cwd = root(),
    win = { position = "right", width = 0.36, height = 1 },
  })
  if terminal then
    dock:activate("git", terminal)
  end
  return terminal
end

return M
