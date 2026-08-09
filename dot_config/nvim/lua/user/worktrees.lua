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

local function cmux_path()
  local executable = vim.fn.exepath("cmux")
  if executable ~= "" then
    return executable
  end
  local bundled = "/Applications/cmux.app/Contents/Resources/bin/cmux"
  if vim.fn.executable(bundled) == 1 then
    return bundled
  end
  return nil
end

local function add_workspace_refs(node, refs, seen)
  if type(node) == "string" then
    if node:match("^workspace:") and not seen[node] then
      seen[node] = true
      refs[#refs + 1] = node
    end
    return
  end
  if type(node) ~= "table" then
    return
  end
  if type(node.ref) == "string" then
    add_workspace_refs(node.ref, refs, seen)
  end
  if vim.islist(node) then
    for _, child in ipairs(node) do
      add_workspace_refs(child, refs, seen)
    end
    return
  end
  for _, key in ipairs({ "workspaces", "items", "data" }) do
    if node[key] then
      add_workspace_refs(node[key], refs, seen)
    end
  end
end

function M.workspace_refs(node)
  local refs = {}
  add_workspace_refs(node, refs, {})
  return refs
end

local function sidebar_cwd(node)
  if type(node) ~= "table" then
    return nil
  end
  if type(node.cwd) == "string" then
    return node.cwd
  end
  for _, child in pairs(node) do
    local cwd = sidebar_cwd(child)
    if cwd then
      return cwd
    end
  end
end

function M.switch_workspace(cmux, item, repo, adapter)
  adapter = adapter or {}
  local execute = adapter.run or run
  local report = adapter.notify or notify
  local target = normalize(item.path)

  local function workspace_command(command)
    execute(command, function(result)
      if result.code ~= 0 then
        report("Worktree switch: cmux workspace command failed")
      end
    end)
  end

  execute({ cmux, "workspace", "list", "--json" }, function(list_result)
    if list_result.code ~= 0 then
      report("Worktree switch: cmux workspace list failed")
      return
    end
    local listed = decode_json(list_result.stdout, "cmux workspace list", report)
    if not listed then
      return
    end
    local refs = M.workspace_refs(listed)

    local function inspect(index)
      local ref = refs[index]
      if not ref then
        workspace_command({
          cmux,
          "workspace",
          "create",
          "--name",
          repo .. ":" .. item.branch,
          "--cwd",
          item.path,
          "--command",
          "nvim",
          "--json",
        })
        return
      end

      execute({ cmux, "sidebar-state", "--workspace", ref, "--json" }, function(state_result)
        if state_result.code ~= 0 then
          report("Worktree switch: cmux sidebar-state failed for " .. ref)
          return
        end
        local state = decode_json(state_result.stdout, "cmux sidebar-state for " .. ref, report)
        if not state then
          return
        end
        local cwd = sidebar_cwd(state)
        if not cwd then
          report("Worktree switch: cmux sidebar-state has no cwd for " .. ref)
          return
        end
        if normalize(cwd) == target then
          workspace_command({ cmux, "workspace", "select", ref })
          return
        end
        inspect(index + 1)
      end)
    end

    inspect(1)
  end)
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
        local cmux = cmux_path()
        if not cmux then
          notify("Worktree switch: cmux executable not found")
          return
        end
        M.switch_workspace(cmux, item, vim.fn.fnamemodify(items[1].path, ":t"))
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
