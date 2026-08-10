local M = {}

local Controller = {}
Controller.__index = Controller

local MIN_PANEL_HEIGHT = 4
local MIN_EXPLORER_HEIGHT = 4
local SPLIT_SEPARATOR_HEIGHT = 1

local panel_namespace = vim.api.nvim_create_namespace("ExplorerBaseDiffTree")
local lifecycle_group = vim.api.nvim_create_augroup("ExplorerBaseDiffTreeLifecycle", { clear = true })

local status_highlights = {
  A = "ExplorerBaseAdded",
  M = "ExplorerBaseModified",
  R = "ExplorerBaseRenamed",
  D = "ExplorerBaseDeleted",
}

vim.api.nvim_set_hl(0, "ExplorerBaseAdded", { link = "GitSignsAdd" })
vim.api.nvim_set_hl(0, "ExplorerBaseModified", { link = "GitSignsChange" })
vim.api.nvim_set_hl(0, "ExplorerBaseRenamed", { link = "GitSignsChange" })
vim.api.nvim_set_hl(0, "ExplorerBaseDeleted", { link = "GitSignsDelete" })

---@class BaseDiffTreeNode
---@field kind "root"|"header"|"directory"|"file"
---@field name string
---@field path string
---@field children? BaseDiffTreeNode[]
---@field status? "A"|"M"|"R"|"D"
---@field old_path? string
---@field change? BaseDiffChange

local function sort_children(node)
  if not node.children then
    return
  end
  table.sort(node.children, function(left, right)
    if left.kind ~= right.kind then
      return left.kind == "directory"
    end
    return left.name < right.name
  end)
  for _, child in ipairs(node.children) do
    sort_children(child)
  end
end

local function find_child(node, kind, name)
  for _, child in ipairs(node.children or {}) do
    if child.kind == kind and child.name == name then
      return child
    end
  end
end

function M.build(changes)
  local root = { kind = "root", name = "", path = "", children = {} }
  for _, change in ipairs(changes or {}) do
    local parent = root
    local segments = vim.split(change.path or "", "/", { plain = true, trimempty = true })
    for index, name in ipairs(segments) do
      local path = parent.path == "" and name or parent.path .. "/" .. name
      if index == #segments then
        parent.children[#parent.children + 1] = {
          kind = "file",
          name = name,
          path = path,
          status = change.status,
          old_path = change.old_path,
          change = change,
        }
      else
        local directory = find_child(parent, "directory", name)
        if not directory then
          directory = { kind = "directory", name = name, path = path, children = {} }
          parent.children[#parent.children + 1] = directory
        end
        parent = directory
      end
    end
  end
  sort_children(root)
  return root
end

local function add_line(rendered, line, item)
  rendered.lines[#rendered.lines + 1] = line
  rendered.items[#rendered.lines] = item
end

local function old_filename(path)
  return (path or ""):match("([^/]+)$") or ""
end

local function display_name(name)
  return vim.fn.strtrans(name or "")
end

local function collect_dirs(node, result)
  for _, child in ipairs(node.children or {}) do
    if child.kind == "directory" then
      result[#result + 1] = child.path
      collect_dirs(child, result)
    end
  end
end

local function render_children(rendered, node, open_dirs, depth)
  for _, child in ipairs(node.children or {}) do
    local prefix = string.rep("  ", depth)
    if child.kind == "directory" then
      local open = open_dirs[child.path] == true
      add_line(rendered, prefix .. (open and "⌄ " or "▸ ") .. display_name(child.name), child)
      if open then
        render_children(rendered, child, open_dirs, depth + 1)
      end
    else
      local file_prefix = string.rep("  ", math.max(depth, 3))
      local line = file_prefix .. (child.status or "?") .. " " .. display_name(child.name)
      if child.status == "R" and child.old_path then
        line = line .. " ← " .. display_name(old_filename(child.old_path))
      end
      add_line(rendered, line, child)
    end
  end
end

function M.render(snapshot, state, error)
  state = state or {}
  local collapsed = state.collapsed == true
  local rendered = { lines = {}, items = {}, valid_open_dirs = {} }
  local header = { kind = "header", name = "BASE CHANGES", path = "" }

  if not snapshot then
    add_line(rendered, (collapsed and "▸" or "⌄") .. " BASE CHANGES · unavailable", header)
    if not collapsed and error and error ~= "" then
      add_line(rendered, "  " .. error, { kind = "root", name = error, path = "" })
    end
    return rendered
  end

  local changes = snapshot.changes or {}
  local suffix = error and error ~= "" and " !" or ""
  add_line(
    rendered,
    (collapsed and "▸" or "⌄")
      .. " BASE CHANGES · "
      .. (snapshot.base_name or "unavailable")
      .. " · "
      .. #changes
      .. suffix,
    header
  )
  local root
  if #changes > 0 then
    root = M.build(changes)
    collect_dirs(root, rendered.valid_open_dirs)
  end
  if collapsed then
    return rendered
  end
  if #changes == 0 then
    add_line(rendered, "  No base changes", { kind = "root", name = "No base changes", path = "" })
    return rendered
  end

  local open_dirs = {}
  for _, path in ipairs(state.open_dirs or {}) do
    open_dirs[path] = true
  end
  render_children(rendered, root, open_dirs, 1)
  return rendered
end

local function filter_open_dirs(open_dirs, valid_open_dirs)
  local valid = {}
  for _, path in ipairs(valid_open_dirs or {}) do
    valid[path] = true
  end

  local filtered = {}
  local changed = false
  for _, path in ipairs(open_dirs or {}) do
    if valid[path] then
      filtered[#filtered + 1] = path
    else
      changed = true
    end
  end
  return filtered, changed
end

local function toggle_open_dir(open_dirs, path)
  for index, open_path in ipairs(open_dirs) do
    if open_path == path then
      table.remove(open_dirs, index)
      return
    end
  end
  open_dirs[#open_dirs + 1] = path
  table.sort(open_dirs)
end

local function default_adapter(controller)
  local base_diff = require("user.base_diff")
  local base_diff_state = require("user.base_diff_state")
  local adapter = {}

  function adapter.load_state(cwd)
    return base_diff_state.load(cwd)
  end

  function adapter.save_state(cwd, state)
    base_diff_state.save(cwd, state)
  end

  -- Snacks Explorerのlistはlayout rootのsplitへ重ねたfloating windowで、floating windowは分割できない。
  -- 分割すると新しいwindowがEditor Group側へ作られるため、列を所有するroot windowまで辿る。
  function adapter.column_host(explorer_win)
    if not controller.adapter.valid_win(explorer_win) then
      return explorer_win
    end
    local config = vim.api.nvim_win_get_config(explorer_win)
    if config.relative ~= "" and controller.adapter.valid_win(config.win) then
      return config.win
    end
    return explorer_win
  end

  function adapter.create_panel(host_win, cwd, height)
    local buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_name(buf, "base-diff-tree://" .. cwd .. "#" .. buf)
    vim.bo[buf].buftype = "nofile"
    vim.bo[buf].bufhidden = "wipe"
    vim.bo[buf].swapfile = false
    vim.bo[buf].modifiable = false
    vim.bo[buf].filetype = "BaseDiffTree"
    vim.bo[buf].buflisted = false

    local panel_win = vim.api.nvim_open_win(buf, false, { split = "below", win = host_win, height = height })
    vim.wo[panel_win].winfixwidth = true
    return panel_win, buf
  end

  function adapter.valid_win(win)
    return type(win) == "number" and vim.api.nvim_win_is_valid(win)
  end

  function adapter.available_height(host_win, panel_win)
    local height = vim.api.nvim_win_get_height(host_win)
    if controller.adapter.valid_win(panel_win) then
      height = height + vim.api.nvim_win_get_height(panel_win) + SPLIT_SEPARATOR_HEIGHT
    end
    return height
  end

  function adapter.get_height(win)
    return vim.api.nvim_win_get_height(win)
  end

  function adapter.set_height(panel_win, height)
    if controller.adapter.valid_win(panel_win) then
      vim.api.nvim_win_set_height(panel_win, height)
    end
  end

  function adapter.render_buffer(buf, rendered, panel_win)
    if not vim.api.nvim_buf_is_valid(buf) then
      return
    end

    vim.bo[buf].modifiable = true
    local ok, err = pcall(function()
      vim.api.nvim_buf_clear_namespace(buf, panel_namespace, 0, -1)
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, rendered.lines)
      for line, item in pairs(rendered.items) do
        local highlight = item.status and status_highlights[item.status]
        if highlight then
          local start_col = (rendered.lines[line]:find(item.status, 1, true) or 1) - 1
          vim.api.nvim_buf_set_extmark(buf, panel_namespace, line - 1, start_col, {
            end_col = start_col + 1,
            hl_group = highlight,
          })
        end
      end
    end)
    vim.bo[buf].modifiable = false
    if not ok then
      error(err)
    end

    if controller.adapter.valid_win(panel_win) and #rendered.lines > 0 then
      local cursor = vim.api.nvim_win_get_cursor(panel_win)
      vim.api.nvim_win_set_cursor(panel_win, { math.min(cursor[1], #rendered.lines), 0 })
    end
  end

  function adapter.set_keymaps(buf)
    local mappings = {
      ["<CR>"] = "default",
      ["<Space>"] = "default",
      o = "open",
      zc = "close",
      zo = "expand",
    }
    for key, action in pairs(mappings) do
      vim.keymap.set("n", key, function()
        controller:activate(vim.api.nvim_win_get_cursor(0)[1], action)
      end, { buffer = buf, silent = true, desc = "Base diff tree: " .. action })
    end
    vim.keymap.set("n", "R", function()
      controller.adapter.refresh_diff(controller.cwd, true)
    end, { buffer = buf, silent = true, desc = "Refresh base diff tree" })
    vim.keymap.set("n", "?", function()
      controller.adapter.notify(
        "Base diff: <CR>/<Space> open diff or toggle, o open file, zc close, zo expand, R refresh"
      )
    end, { buffer = buf, silent = true, desc = "Show base diff tree help" })
  end

  function adapter.close_win(win)
    if controller.adapter.valid_win(win) then
      pcall(vim.api.nvim_win_close, win, true)
    end
  end

  function adapter.current_diff(cwd)
    return base_diff.snapshot(cwd), base_diff.error(cwd)
  end

  function adapter.subscribe_diff(cwd, callback)
    return base_diff.subscribe(cwd, callback)
  end

  function adapter.refresh_diff(cwd, notify)
    base_diff.refresh_and_render(cwd, { notify = notify })
  end

  function adapter.open_file(path, target, callback)
    local stat = vim.uv.fs_lstat(path)
    if not stat or not controller.adapter.valid_win(target) then
      callback(false)
      return
    end
    if stat.type == "link" then
      local link_target = vim.uv.fs_readlink(path)
      if not link_target then
        callback(false)
        return
      end
      local ok = pcall(vim.api.nvim_win_call, target, function()
        local buf = vim.api.nvim_create_buf(false, true)
        vim.api.nvim_buf_set_name(buf, "base-diff://worktree symlink: " .. path .. "#" .. buf)
        vim.bo[buf].buftype = "nofile"
        vim.bo[buf].bufhidden = "wipe"
        vim.bo[buf].swapfile = false
        vim.api.nvim_buf_set_lines(buf, 0, -1, false, { link_target })
        vim.bo[buf].modifiable = false
        vim.api.nvim_win_set_buf(target, buf)
        vim.cmd("diffoff")
      end)
      callback(ok)
      return
    end
    local ok = pcall(vim.api.nvim_win_call, target, function()
      vim.cmd.edit(vim.fn.fnameescape(path))
      vim.cmd("diffoff")
    end)
    callback(ok)
  end

  function adapter.notify(message)
    vim.notify(message, vim.log.levels.WARN)
  end

  function adapter.install_lifecycle()
    controller._autocmds = {
      vim.api.nvim_create_autocmd("WinResized", {
        group = lifecycle_group,
        callback = function()
          controller:on_resized(vim.v.event.windows or {})
        end,
      }),
      vim.api.nvim_create_autocmd("WinClosed", {
        group = lifecycle_group,
        callback = function(args)
          local closed_win = tonumber(args.match)
          if closed_win == controller.explorer_win or closed_win == controller.panel_win then
            controller:close()
            return
          end
          controller.view:on_win_closed(closed_win)
        end,
      }),
    }
  end

  function adapter.remove_lifecycle()
    for _, autocmd in ipairs(controller._autocmds or {}) do
      pcall(vim.api.nvim_del_autocmd, autocmd)
    end
    controller._autocmds = nil
  end

  return adapter
end

function Controller:is_collapsed()
  return self.state.collapsed == true or self.force_collapsed == true
end

function Controller:render_state()
  return vim.tbl_extend("force", {}, self.state, { collapsed = self:is_collapsed() })
end

function Controller:refit_explorer()
  if self.refit_explorer_callback then
    pcall(self.refit_explorer_callback)
  end
end

function Controller:apply_height(height)
  self._programmatic_height = height
  self.adapter.set_height(self.panel_win, height)
  self:refit_explorer()
end

function Controller:recalculate_layout(resize)
  local available_height = self.adapter.available_height(self.host_win, self.panel_win)
  local max_expanded_height = available_height - MIN_EXPLORER_HEIGHT - SPLIT_SEPARATOR_HEIGHT
  self.available_height = available_height
  self.force_collapsed = max_expanded_height < MIN_PANEL_HEIGHT
  local desired_height = self.state.height or math.max(MIN_PANEL_HEIGHT, math.floor(available_height / 2))
  self.expanded_height = self.force_collapsed and MIN_PANEL_HEIGHT or math.min(desired_height, max_expanded_height)
  if resize and self.adapter.valid_win(self.panel_win) then
    self:apply_height(self:is_collapsed() and 1 or self.expanded_height)
  end
end

function Controller:on_resized(windows)
  if not self.adapter.valid_win(self.panel_win) or not self.adapter.valid_win(self.explorer_win) then
    return
  end
  local relevant = false
  for _, win in ipairs(windows or {}) do
    win = tonumber(win)
    -- Explorer自身のwindowはlayoutが列の高さへ追従させるだけなので、列とパネルの変化だけを見る
    if win == self.panel_win or win == self.host_win then
      relevant = true
      break
    end
  end
  if not relevant then
    return
  end

  local available_height = self.adapter.available_height(self.host_win, self.panel_win)
  local panel_height = self.adapter.get_height(self.panel_win)
  if self._programmatic_height == panel_height and self.available_height == available_height then
    self._programmatic_height = nil
    return
  end
  self._programmatic_height = nil

  if self.available_height == available_height and not self:is_collapsed() and panel_height >= MIN_PANEL_HEIGHT then
    local max_expanded_height = available_height - MIN_EXPLORER_HEIGHT - SPLIT_SEPARATOR_HEIGHT
    local height = math.min(panel_height, max_expanded_height)
    self.state.height = height
    self.expanded_height = height
    self.adapter.save_state(self.cwd, self.state)
    if height ~= panel_height then
      self:apply_height(height)
    else
      self:refit_explorer()
    end
    return
  end

  local was_collapsed = self:is_collapsed()
  self:recalculate_layout(true)
  if was_collapsed ~= self:is_collapsed() then
    self:update(self.snapshot, self.error)
  end
end

function Controller:ensure(opts)
  if self.adapter.valid_win(self.panel_win) then
    return self.panel_win
  end

  local ok, result = xpcall(function()
    self.cwd = opts.cwd
    self.explorer_win = opts.explorer_win
    self.editor_win = opts.editor_win
    self.refit_explorer_callback = opts.refit_explorer
    self.host_win = self.adapter.column_host(self.explorer_win)
    if not self.state then
      self.state = self.adapter.load_state(self.cwd)
    end

    self:recalculate_layout(false)
    local height = self:is_collapsed() and 1 or self.expanded_height
    self.panel_win, self.buf = self.adapter.create_panel(self.host_win, self.cwd, height)
    self:refit_explorer()
    self._subscription_generation = (self._subscription_generation or 0) + 1
    local subscription_generation = self._subscription_generation
    self.unsubscribe = self.adapter.subscribe_diff(self.cwd, function(snapshot, error)
      if self._subscription_generation ~= subscription_generation then
        return
      end
      self:update(snapshot, error)
    end)
    local snapshot, error = self.adapter.current_diff(self.cwd)
    self:update(snapshot, error)
    self.adapter.set_keymaps(self.buf)
    if self.adapter.install_lifecycle then
      self.adapter.install_lifecycle()
    end
    return self.panel_win
  end, debug.traceback)
  if not ok then
    self:close()
    error(result, 0)
  end
  return result
end

function Controller:update(snapshot, error)
  self.snapshot = snapshot
  self.error = error
  self.rendered = M.render(snapshot, self:render_state(), error)
  if snapshot then
    local filtered, changed = filter_open_dirs(self.state.open_dirs, self.rendered.valid_open_dirs)
    if changed then
      self.state.open_dirs = filtered
      self.adapter.save_state(self.cwd, self.state)
      self.rendered = M.render(snapshot, self:render_state(), error)
    end
  end
  self.adapter.render_buffer(self.buf, self.rendered, self.panel_win)
end

function Controller:activate(line, action)
  local item = self.rendered and self.rendered.items[line]
  local state_changed = false
  if action == "close" then
    self.state.collapsed = true
    state_changed = true
  elseif action == "expand" then
    self.state.collapsed = false
    state_changed = true
  elseif item and item.kind == "header" then
    if self.force_collapsed then
      self.state.collapsed = false
    else
      self.state.collapsed = not self.state.collapsed
    end
    state_changed = true
  elseif item and item.kind == "directory" then
    toggle_open_dir(self.state.open_dirs, item.path)
    state_changed = true
  elseif item and item.kind == "file" and action == "open" then
    if item.status == "D" then
      self.adapter.notify("Deleted file can only be opened as a diff")
    else
      if self.view.close then
        self.view:close()
      end
      local target = self.editor_win()
      self.adapter.open_file(self.cwd .. "/" .. item.path, target, function(opened)
        if not opened then
          self.adapter.notify("Base diff file no longer exists: " .. item.path)
          self.adapter.refresh_diff(self.cwd, false)
        end
      end)
    end
  elseif item and item.kind == "file" then
    local pair = self.view.pair and self.view:pair()
    local target = pair and self.adapter.valid_win(pair.left) and self.adapter.valid_win(pair.right) and pair.right
      or self.editor_win()
    if target then
      self.view:open(self.snapshot, item.change, target)
    else
      self.adapter.notify("No Editor Group is available for the base diff")
    end
  end

  if not state_changed then
    return
  end
  if self.snapshot then
    self.state.open_dirs = filter_open_dirs(self.state.open_dirs, self.rendered.valid_open_dirs)
  end
  self.adapter.save_state(self.cwd, self.state)
  self:apply_height(self:is_collapsed() and 1 or self.expanded_height)
  self:update(self.snapshot, self.error)
end

function Controller:close()
  self._subscription_generation = (self._subscription_generation or 0) + 1
  if self.unsubscribe then
    self.unsubscribe()
    self.unsubscribe = nil
  end
  if self.adapter.remove_lifecycle then
    self.adapter.remove_lifecycle()
  end
  if self.view.close then
    self.view:close()
  end
  self.adapter.close_win(self.panel_win)
  self.panel_win = nil
  self.buf = nil
  self.rendered = nil
  self.host_win = nil
  self:refit_explorer()
end

function M.new(adapter)
  local controller = setmetatable({}, Controller)
  controller.adapter = vim.tbl_extend("force", default_adapter(controller), adapter or {})
  if adapter and adapter.install_lifecycle == nil then
    controller.adapter.install_lifecycle = nil
    controller.adapter.remove_lifecycle = nil
  end
  controller.view = controller.adapter.view or require("user.base_diff_view").new()
  return controller
end

local controllers = {}

function M.ensure(opts)
  local cwd = require("user.worktree_root").resolve(opts.cwd)
  local controller = controllers[opts.explorer_win]
  if controller and controller.cwd ~= cwd then
    controller:close()
    controller = nil
  end
  if not controller then
    controller = M.new()
    controllers[opts.explorer_win] = controller
  end
  opts = vim.tbl_extend("force", opts, { cwd = cwd })
  return controller:ensure(opts)
end

function M.close(cwd, target_explorer_win)
  cwd = require("user.worktree_root").resolve(cwd)
  for explorer_win, controller in pairs(controllers) do
    if controller.cwd == cwd and (not target_explorer_win or explorer_win == target_explorer_win) then
      controller:close()
      controllers[explorer_win] = nil
    end
  end
end

return M
