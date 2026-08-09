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

  function adapter.close_pair(pair)
    if vim.api.nvim_win_is_valid(pair.left) then
      vim.api.nvim_win_close(pair.left, true)
    end
  end

  function adapter.notify(message)
    vim.notify(message, vim.log.levels.WARN)
  end

  function adapter.show(plan, left_lines, target_win, previous)
    local pair = previous or {}
    vim.schedule(function()
      local left_win
      local right_win
      if adapter.valid_pair(pair) then
        left_win = pair.left
        right_win = pair.right
      else
        right_win = target_win
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

      for _, win in ipairs({ left_win, right_win }) do
        vim.api.nvim_win_call(win, function()
          vim.cmd("diffthis")
        end)
        local buffer = vim.api.nvim_win_get_buf(win)
        vim.keymap.set("n", "q", function()
          controller:close()
        end, { buffer = buffer, silent = true, desc = "Close base diff" })
      end

      pair.left = left_win
      pair.right = right_win
    end)
    return pair
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
  local plan = M.plan(snapshot, change)
  self._adapter.check_binary(snapshot, change, plan, function(is_binary, err)
    if err then
      self._adapter.notify("Base diff binary detection failed: " .. err)
      return
    end
    if is_binary then
      self._adapter.notify("Binary files cannot be shown here; inspect them in LazyGit instead.")
      return
    end

    local function show(left_lines)
      local previous = self._adapter.valid_pair(self._pair) and self._pair or nil
      self._pair = self._adapter.show(plan, left_lines, target_win, previous)
      if callback then
        callback(self._pair)
      end
    end

    if plan.left.kind == "git" then
      self._adapter.load_git(plan.left, snapshot, function(lines, load_err)
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

  local surviving = win == pair.left and pair.right or pair.left
  self._adapter.clear_mapping(surviving)
  self._adapter.clear_diff(surviving)
  self._pair = nil
end

function Controller:close()
  local pair = self._pair
  if not pair then
    return
  end

  self._pair = nil
  for _, win in ipairs({ pair.left, pair.right }) do
    self._adapter.clear_mapping(win)
    self._adapter.clear_diff(win)
  end
  self._adapter.close_pair(pair)
end

function M.new(adapter)
  local controller = setmetatable({ _pair = nil }, Controller)
  controller._adapter = vim.tbl_extend("force", default_adapter(controller), adapter or {})
  return controller
end

return M
