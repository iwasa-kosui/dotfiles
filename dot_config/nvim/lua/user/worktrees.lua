local M = {}
local root = require("user.worktree_root")

local function notify(message)
  vim.notify(message, vim.log.levels.ERROR)
end

local function normalize(path)
  return root.normalize(path)
end

local function decode_json(output, description, report)
  local ok, decoded = pcall(vim.json.decode, output or "")
  if not ok then
    report("Worktree switch: could not decode " .. description)
    return nil
  end
  return decoded
end

local function run(command, callback)
  vim.system(command, { text = true }, vim.schedule_wrap(callback))
end

local function command_detail(result)
  local message = vim.trim((result and (result.stderr or result.stdout)) or "")
  return message ~= "" and message or "unknown error"
end

local function last_output_path(output)
  local path
  for _, line in ipairs(vim.split(output or "", "\n", { plain = true })) do
    local trimmed = vim.trim(line)
    if trimmed ~= "" then
      path = trimmed
    end
  end
  return path
end

function M.parse_porcelain(lines)
  local worktrees = {}
  local current = nil

  local function finish()
    if current and current.path then
      current.branch = current.branch or "(detached)"
      worktrees[#worktrees + 1] = current
    end
    current = nil
  end

  for _, line in ipairs(lines) do
    if line == "" then
      finish()
    elseif line:sub(1, 9) == "worktree " then
      finish()
      current = { path = normalize(line:sub(10)) }
    elseif current and line:sub(1, 7) == "branch " then
      current.branch = line:sub(8):gsub("^refs/heads/", "")
    end
  end
  finish()

  return worktrees
end

function M.sort(items, activities, current)
  local last_used = {}
  for _, activity in ipairs(activities) do
    local path = normalize(activity.path)
    last_used[path] = math.max(last_used[path] or 0, activity.lastUsedAt or 0)
  end

  local sorted = vim.deepcopy(items)
  local normalized_current = normalize(current)
  table.sort(sorted, function(left, right)
    local left_current = left.path == normalized_current
    local right_current = right.path == normalized_current
    if left_current ~= right_current then
      return left_current
    end

    local left_used = last_used[left.path] or 0
    local right_used = last_used[right.path] or 0
    if left_used ~= right_used then
      return left_used > right_used
    end
    return left.branch < right.branch
  end)
  return sorted
end

---@param items { path: string, branch: string }[]
---@param branch string
---@param current string
---@return { state: "current"|"switch"|"missing", path?: string, branch: string }
function M.classify_branch(items, branch, current)
  local normalized_current = normalize(current)
  for _, item in ipairs(items) do
    if item.branch == branch then
      if item.path == normalized_current then
        return { state = "current", path = item.path, branch = branch }
      end
      return { state = "switch", path = item.path, branch = branch }
    end
  end
  return { state = "missing", branch = branch }
end

---@param opts { branch: string, cwd: string, command?: string, on_current: fun(), on_error?: fun(message: string) }
function M.switch_to_branch(opts, adapter)
  adapter = adapter or {}
  local execute = adapter.run
    or function(command, callback)
      vim.system(command, { cwd = opts.cwd, text = true }, vim.schedule_wrap(callback))
    end
  local switch = adapter.restart_in_place or M.restart_in_place
  local resolve = adapter.root or root.resolve
  local report = adapter.notify or notify

  local function fail(message)
    if opts.on_error then
      opts.on_error(message)
    else
      report(message)
    end
  end

  local branch = opts.branch
  if type(branch) ~= "string" or branch == "" then
    fail("Worktree switch: the branch name is empty")
    return
  end

  local function create(start_point)
    local command = { "git", "wt", branch }
    if start_point then
      command[#command + 1] = start_point
    end
    command[#command + 1] = "--nocd"
    execute(command, function(result)
      if result.code ~= 0 then
        fail("Worktree switch: git wt failed: " .. command_detail(result))
        return
      end
      local path = last_output_path(result.stdout)
      if not path then
        fail("Worktree switch: git wt did not report a worktree path")
        return
      end
      switch({ path = path, branch = branch, command = opts.command }, { notify = fail })
    end)
  end

  execute({ "git", "worktree", "list", "--porcelain" }, function(list_result)
    if list_result.code ~= 0 then
      fail("Worktree switch: git worktree list failed: " .. command_detail(list_result))
      return
    end
    local items = M.parse_porcelain(vim.split(list_result.stdout or "", "\n", { plain = true }))
    local target = M.classify_branch(items, branch, resolve(opts.cwd))
    if target.state == "current" then
      opts.on_current()
      return
    end
    if target.state == "switch" then
      switch({ path = target.path, branch = branch, command = opts.command }, { notify = fail })
      return
    end
    execute({ "git", "rev-parse", "--verify", "--quiet", "refs/heads/" .. branch }, function(ref_result)
      if ref_result.code == 0 then
        create(nil)
        return
      end
      execute({ "git", "fetch", "origin", branch }, function(fetch_result)
        if fetch_result.code ~= 0 then
          fail("Worktree switch: git fetch failed: " .. command_detail(fetch_result))
          return
        end
        create("origin/" .. branch)
      end)
    end)
  end)
end

function M.restart_in_place(item, adapter)
  adapter = adapter or {}
  local getcwd = adapter.getcwd or vim.fn.getcwd
  local set_current_dir = adapter.set_current_dir or vim.api.nvim_set_current_dir
  local restart = adapter.restart or function(command)
    if type(command) == "string" and command ~= "" then
      vim.cmd("restart " .. command)
    else
      vim.cmd.restart()
    end
  end
  local report = adapter.notify or notify

  local previous = getcwd()
  set_current_dir(item.path)
  local ok, err = pcall(restart, item.command)
  if ok then
    return true
  end

  set_current_dir(previous)
  report("Worktree switch: Neovim restart failed: " .. tostring(err))
  return false
end

function M.open()
  run({ "git", "worktree", "list", "--porcelain" }, function(git_result)
    if git_result.code ~= 0 then
      notify("Worktree switch: git worktree list failed")
      return
    end
    local items = M.parse_porcelain(vim.split(git_result.stdout or "", "\n", { plain = true }))
    if #items == 0 then
      notify("Worktree switch: no worktrees found")
      return
    end
    run({ "worktree-activity", "list" }, function(activity_result)
      if activity_result.code ~= 0 then
        notify("Worktree switch: activity list failed")
        return
      end
      local activities = decode_json(activity_result.stdout, "activity list", notify)
      if not activities then
        return
      end
      local sorted = M.sort(items, activities, root.resolve(vim.uv.cwd()))
      vim.ui.select(sorted, {
        prompt = "Switch worktree",
        format_item = function(item)
          return item.branch .. "  " .. item.path
        end,
      }, function(item)
        if not item then
          return
        end
        M.restart_in_place(item)
      end)
    end)
  end)
end

function M.record_activity(adapter)
  adapter = adapter or {}
  local cwd = (adapter.root or root.resolve)(vim.uv.cwd())
  if cwd then
    (adapter.system or vim.system)({ "worktree-activity", "record", "nvim", cwd }, { text = true })
  end
end

vim.api.nvim_create_autocmd({ "VimEnter", "FocusGained" }, { callback = M.record_activity })

return M
