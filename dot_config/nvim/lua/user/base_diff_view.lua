local M = {}

local Controller = {}
Controller.__index = Controller

local function result_error(result, fallback)
  local detail = vim.trim((result and (result.stderr or result.stdout)) or "")
  return detail ~= "" and detail or fallback
end

local function is_binary_numstat(output)
  for line in (output or ""):gmatch("[^\n]+") do
    if line:sub(1, 5) == "-\t-\t" then
      return true
    end
  end
  return false
end

local function new_scratch_buffer(name, lines)
  local buffer = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_name(buffer, name .. "#" .. buffer)
  vim.bo[buffer].buftype = "nofile"
  vim.bo[buffer].bufhidden = "wipe"
  vim.bo[buffer].swapfile = false
  vim.api.nvim_buf_set_lines(buffer, 0, -1, false, lines or {})
  vim.bo[buffer].modifiable = false
  return buffer
end

local function q_mapping(buffer)
  return vim.api.nvim_buf_call(buffer, function()
    return vim.fn.maparg("q", "n", false, true)
  end)
end

local function restore_q_mapping(buffer, mapping)
  if not vim.api.nvim_buf_is_valid(buffer) then
    return
  end
  pcall(vim.keymap.del, "n", "q", { buffer = buffer })
  if not mapping or vim.tbl_isempty(mapping) then
    return
  end
  vim.keymap.set("n", "q", mapping.callback or mapping.rhs, {
    buffer = buffer,
    desc = mapping.desc,
    expr = mapping.expr == 1,
    noremap = mapping.noremap == 1,
    nowait = mapping.nowait == 1,
    replace_keycodes = mapping.replace_keycodes == 1,
    script = mapping.script == 1,
    silent = mapping.silent == 1,
  })
end

local function default_adapter(controller)
  local adapter = {}

  function adapter.check_binary(snapshot, _, plan, callback)
    local command
    local accepts_diff_exit = false
    if plan.left.kind == "empty" then
      command = { "git", "diff", "--no-index", "--numstat", "--", "/dev/null", plan.right.path }
      accepts_diff_exit = true
    else
      command = vim.list_extend({ "git", "diff", "--numstat", snapshot.merge_base, "--" }, plan.pathspecs)
    end

    vim.system(command, { cwd = snapshot.cwd, text = true }, function(result)
      if result.code ~= 0 and not (accepts_diff_exit and result.code == 1) then
        callback(false, result_error(result, "git diff --numstat failed"))
        return
      end
      callback(is_binary_numstat(result.stdout), nil)
    end)
  end

  function adapter.load_git(source, snapshot, callback)
    vim.system(
      { "git", "show", source.rev .. ":" .. source.path },
      { cwd = snapshot.cwd, text = true },
      function(result)
        if result.code ~= 0 then
          callback(nil, result_error(result, "git show failed"))
          return
        end
        local lines = vim.split(result.stdout or "", "\n", { plain = true })
        if lines[#lines] == "" then
          table.remove(lines)
        end
        callback(lines, nil)
      end
    )
  end

  function adapter.valid_pair(value)
    return type(value) == "table"
      and type(value.left) == "number"
      and type(value.right) == "number"
      and vim.api.nvim_win_is_valid(value.left)
      and vim.api.nvim_win_is_valid(value.right)
  end

  function adapter.valid_window(win)
    return type(win) == "number" and vim.api.nvim_win_is_valid(win)
  end

  function adapter.clear_diff(win)
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_call(win, function()
        vim.cmd("diffoff")
      end)
    end
  end

  function adapter.clear_mapping(win)
    if not vim.api.nvim_win_is_valid(win) then
      return
    end
    local buffer = vim.api.nvim_win_get_buf(win)
    pcall(vim.keymap.del, "n", "q", { buffer = buffer })
  end

  function adapter.restore_mappings(pair)
    for buffer, mapping in pairs(pair._q_mappings or {}) do
      restore_q_mapping(buffer, mapping)
    end
    pair._q_mappings = {}
  end

  function adapter.install_close_mapping(pair, buffer)
    pair._q_mappings = pair._q_mappings or {}
    if pair._q_mappings[buffer] == nil then
      local existing = q_mapping(buffer)
      pair._q_mappings[buffer] = existing.buffer == 1 and existing or false
    end
    vim.keymap.set("n", "q", function()
      controller:close()
    end, { buffer = buffer, silent = true, desc = "Close base diff" })
  end

  function adapter.close_pair(pair, closed_win)
    if
      closed_win ~= pair.right
      and adapter.valid_window(pair.right)
      and type(pair.right_original_buffer) == "number"
      and vim.api.nvim_buf_is_valid(pair.right_original_buffer)
    then
      vim.api.nvim_win_set_buf(pair.right, pair.right_original_buffer)
    end
    if closed_win ~= pair.left and adapter.valid_window(pair.left) then
      pcall(vim.api.nvim_win_close, pair.left, true)
    end
  end

  function adapter.notify(message)
    vim.notify(message, vim.log.levels.WARN)
  end

  function adapter.show(plan, left_lines, target_win, previous, callback, current)
    local pair = previous or {}
    vim.schedule(function()
      if current and not current() then
        return
      end
      local ok, err = xpcall(function()
        local left_win
        local right_win
        if adapter.valid_pair(pair) then
          left_win = pair.left
          right_win = pair.right
          adapter.restore_mappings(pair)
        else
          if not adapter.valid_window(target_win) then
            error("target window is no longer valid")
          end
          right_win = target_win
          pair.right_original_buffer = vim.api.nvim_win_get_buf(right_win)
          left_win = vim.api.nvim_win_call(right_win, function()
            vim.cmd("leftabove vsplit")
            return vim.api.nvim_get_current_win()
          end)
        end

        local left_name
        if plan.left.kind == "git" then
          left_name = "base-diff://" .. plan.left.rev .. "/" .. plan.left.path
        else
          left_name = "base-diff://" .. plan.left.label
        end
        local left_buffer = new_scratch_buffer(left_name, left_lines)
        vim.api.nvim_win_set_buf(left_win, left_buffer)

        if plan.right.kind == "file" then
          vim.api.nvim_win_call(right_win, function()
            vim.cmd("edit " .. vim.fn.fnameescape(plan.right.path))
          end)
        else
          local right_buffer = new_scratch_buffer("base-diff://" .. plan.right.label, {})
          vim.api.nvim_win_set_buf(right_win, right_buffer)
        end

        pair.left = left_win
        pair.right = right_win
        for _, win in ipairs({ left_win, right_win }) do
          vim.api.nvim_win_call(win, function()
            vim.cmd("diffthis")
          end)
          adapter.install_close_mapping(pair, vim.api.nvim_win_get_buf(win))
        end
      end, debug.traceback)
      if not ok then
        callback(nil, "Base diff display failed: " .. err)
        return
      end
      callback(pair, nil)
    end)
  end

  return adapter
end

function M.plan(snapshot, change)
  local right = { kind = "file", path = vim.fs.normalize(snapshot.cwd .. "/" .. change.path) }
  local left = { kind = "git", rev = snapshot.merge_base, path = change.old_path or change.path }
  local pathspecs = change.old_path and { change.old_path, change.path } or { change.path }

  if change.status == "A" then
    left = { kind = "empty", label = "base: " .. change.path }
  elseif change.status == "D" then
    right = { kind = "empty", label = "worktree: " .. change.path }
  elseif change.status ~= "M" and change.status ~= "R" then
    error("unsupported base diff status: " .. tostring(change.status))
  end

  return { left = left, right = right, pathspecs = pathspecs }
end

function Controller:pair()
  return self._pair
end

function Controller:open(snapshot, change, target_win, callback)
  self._generation = self._generation + 1
  local generation = self._generation
  local plan = M.plan(snapshot, change)

  local function current()
    return self._generation == generation
  end

  self._adapter.check_binary(snapshot, change, plan, function(is_binary, err)
    if not current() then
      return
    end
    if err then
      self._adapter.notify("Base diff binary detection failed: " .. err)
      return
    end
    if is_binary then
      self._adapter.notify("Binary files cannot be shown here; inspect them in LazyGit instead.")
      return
    end

    local function show(left_lines)
      if not current() then
        return
      end
      local previous = self._adapter.valid_pair(self._pair) and self._pair or nil
      if not previous and self._adapter.validate_target and not self._adapter.valid_window(target_win) then
        self._adapter.notify("Base diff target window is no longer valid")
        return
      end
      local completed = false
      local function finish(pair, show_err)
        if completed or not current() then
          return
        end
        completed = true
        if show_err then
          self._adapter.notify(show_err)
          return
        end
        self._pair = pair
        if callback then
          callback(pair)
        end
      end
      local pair = self._adapter.show(plan, left_lines, target_win, previous, finish, current)
      if pair ~= nil then
        finish(pair, nil)
      end
    end

    if plan.left.kind == "git" then
      self._adapter.load_git(plan.left, snapshot, function(lines, load_err)
        if not current() then
          return
        end
        if load_err then
          self._adapter.notify("Base diff blob load failed: " .. load_err)
          return
        end
        show(lines)
      end)
      return
    end

    show({})
  end)
end

function Controller:on_win_closed(win)
  local pair = self._pair
  if not pair or (win ~= pair.left and win ~= pair.right) then
    return
  end

  self._generation = self._generation + 1
  local surviving = win == pair.left and pair.right or pair.left
  self._adapter.restore_mappings(pair)
  self._adapter.clear_diff(surviving)
  self._adapter.close_pair(pair, win)
  self._pair = nil
end

function Controller:close()
  self._generation = self._generation + 1
  local pair = self._pair
  if not pair then
    return
  end

  self._pair = nil
  self._adapter.restore_mappings(pair)
  for _, win in ipairs({ pair.left, pair.right }) do
    self._adapter.clear_diff(win)
  end
  self._adapter.close_pair(pair)
end

function M.new(adapter)
  local controller = setmetatable({ _generation = 0, _pair = nil }, Controller)
  controller._adapter = vim.tbl_extend("force", default_adapter(controller), adapter or {})
  controller._adapter.validate_target = adapter == nil or adapter.valid_window ~= nil
  return controller
end

return M
