local M = {}
local last_editor_by_tab = {}
local pending_panel_by_picker = setmetatable({}, { __mode = "k" })

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
      ensure_base_diff = function(opts)
        return require("user.base_diff_tree").ensure(opts)
      end,
      close_base_diff = function(cwd, explorer_win)
        require("user.base_diff_tree").close(cwd, explorer_win)
      end,
      -- Explorerのwindowはfloatingで、列のsplitを分割しても自動では縮まない
      refit_explorer = function(picker)
        if not picker or picker.closed or not picker.layout then
          return
        end
        pcall(function()
          picker.layout:update()
        end)
      end,
      notify = function(message, level)
        vim.notify(message, level)
      end,
      editor_win = function()
        return M.editor_win()
      end,
      valid_win = function(win)
        return type(win) == "number" and vim.api.nvim_win_is_valid(win)
      end,
      on_picker_show = function(picker, callback)
        local on_show = picker.opts.on_show
        picker.opts.on_show = function(shown_picker)
          if on_show then
            on_show(shown_picker)
          end
          callback(shown_picker)
        end
      end,
      arg_count = function()
        return vim.fn.argc()
      end,
      arg_path = function(index)
        return vim.fn.argv(index)
      end,
      is_directory = function(path)
        return vim.fn.isdirectory(path) == 1
      end,
      current_win = function()
        return vim.api.nvim_get_current_win()
      end,
      current_tab = function()
        return vim.api.nvim_get_current_tabpage()
      end,
      window_info = function(win)
        if not vim.api.nvim_win_is_valid(win) then
          return { valid = false }
        end
        local buf = vim.api.nvim_win_get_buf(win)
        return {
          valid = true,
          tab = vim.api.nvim_win_get_tabpage(win),
          buftype = vim.bo[buf].buftype,
          filetype = vim.bo[buf].filetype,
          relative = vim.api.nvim_win_get_config(win).relative,
          diff = vim.wo[win].diff,
        }
      end,
      tab_windows = function(tab)
        return vim.api.nvim_tabpage_list_wins(tab)
      end,
      create_editor = function(source_win)
        local created
        vim.api.nvim_win_call(source_win, function()
          vim.cmd("rightbelow vsplit")
          created = vim.api.nvim_get_current_win()
          vim.cmd("diffoff")
        end)
        return created
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

local function picker_explorer_win(picker, api)
  if not picker or picker.closed or not (picker.list and picker.list.win) then
    return
  end
  local win = picker.list.win.win
  return api.valid_win(win) and win or nil
end

local function ensure_base_diff(picker, cwd, api)
  local explorer_win = picker_explorer_win(picker, api)
  if not explorer_win then
    return false
  end
  local ok, error = pcall(function()
    api.ensure_base_diff({
      cwd = cwd,
      explorer_win = explorer_win,
      editor_win = api.editor_win,
      refit_explorer = function()
        api.refit_explorer(picker)
      end,
    })
    api.refresh_base_diff(cwd)
  end)
  if not ok then
    pcall(api.close_base_diff, cwd, explorer_win)
    pcall(api.notify, "Base diff panel unavailable: " .. tostring(error), vim.log.levels.WARN)
  end
  return true
end

local function ensure_base_diff_when_ready(picker, cwd, api)
  if ensure_base_diff(picker, cwd, api) or not picker or picker.closed or pending_panel_by_picker[picker] then
    return
  end
  pending_panel_by_picker[picker] = true
  local handled = false
  api.on_picker_show(picker, function(shown_picker)
    if handled then
      return
    end
    handled = true
    pending_panel_by_picker[picker] = nil
    ensure_base_diff(shown_picker, cwd, api)
  end)
end

function M.single_file_session(adapter)
  local api = defaults(adapter)
  if api.arg_count() ~= 1 then
    return false
  end
  local path = api.arg_path(0)
  if type(path) ~= "string" or path == "" then
    return false
  end
  return not api.is_directory(path)
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
  ensure_base_diff_when_ready(picker, cwd, api)
  if opts.focus ~= false and picker then
    picker:focus("list")
  end
  return picker
end

local function is_editor(win, api, tab, allow_diff)
  local info = api.window_info(win)
  return info
    and info.valid
    and info.tab == tab
    and info.relative == ""
    and info.buftype == ""
    and info.filetype ~= "snacks_picker_list"
    and info.filetype ~= "BaseDiffTree"
    and (allow_diff or info.diff ~= true)
end

function M.remember_editor(win, adapter)
  local api = defaults(adapter)
  local tab = api.current_tab()
  win = win or api.current_win()
  if not is_editor(win, api, tab) then
    return false
  end
  last_editor_by_tab[tab] = win
  return true
end

function M.editor_win(adapter)
  local api = defaults(adapter)
  local tab = api.current_tab()
  local remembered = last_editor_by_tab[tab]
  if remembered and is_editor(remembered, api, tab) then
    return remembered
  end
  last_editor_by_tab[tab] = nil
  local diff_editor
  for _, win in ipairs(api.tab_windows(tab)) do
    if is_editor(win, api, tab) then
      return win
    end
    if not diff_editor and is_editor(win, api, tab, true) then
      diff_editor = win
    end
  end
  if diff_editor then
    return api.create_editor(diff_editor)
  end
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

function M.git_dock(opts, adapter)
  adapter = adapter or {}
  local lazygit_dock = adapter.lazygit_dock or require("user.lazygit_dock")
  return lazygit_dock.open(opts or { focus = true })
end

return M
