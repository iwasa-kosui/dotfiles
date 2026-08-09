local M = {}

local function notify(message)
  vim.notify(message, vim.log.levels.ERROR)
end

local function normalize(path)
  return vim.fs.normalize(vim.fn.fnamemodify(path, ":p"))
end

local function decode_json(output, description)
  local ok, decoded = pcall(vim.json.decode, output or "")
  if not ok then
    notify("Worktree switch: could not decode " .. description)
    return nil
  end
  return decoded
end

local function run(command, callback)
  vim.system(command, { text = true }, callback)
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

local function workspace_ids(node, ids)
  if type(node) ~= "table" then
    return
  end
  if node.id ~= nil then
    ids[tostring(node.id)] = true
  end
  for _, child in pairs(node) do
    workspace_ids(child, ids)
  end
end

local function find_workspace(node, path)
  if type(node) ~= "table" then
    return nil
  end
  local cwd = node.cwd or node.working_directory
  if node.id ~= nil and type(cwd) == "string" and normalize(cwd) == path then
    return tostring(node.id)
  end
  for _, child in pairs(node) do
    local found = find_workspace(child, path)
    if found then
      return found
    end
  end
  return nil
end

local function switch_workspace(cmux, item, repo)
  run({ cmux, "workspace", "list", "--json" }, function(list_result)
    if list_result.code ~= 0 then
      notify("Worktree switch: cmux workspace list failed")
      return
    end
    local listed = decode_json(list_result.stdout, "cmux workspace list")
    if not listed then
      return
    end
    local ids = {}
    workspace_ids(listed, ids)

    run({ cmux, "tree", "--all", "--json" }, function(tree_result)
      if tree_result.code ~= 0 then
        notify("Worktree switch: cmux tree failed")
        return
      end
      local tree = decode_json(tree_result.stdout, "cmux tree")
      if not tree then
        return
      end
      local workspace_id = find_workspace(tree, item.path)
      local command
      if workspace_id and ids[workspace_id] then
        command = { cmux, "workspace", "select", workspace_id }
      else
        command = {
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
        }
      end
      run(command, function(result)
        if result.code ~= 0 then
          notify("Worktree switch: cmux workspace command failed")
        end
      end)
    end)
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
      local activities = decode_json(activity_result.stdout, "activity list")
      if not activities then
        return
      end
      local sorted = M.sort(items, activities, vim.uv.cwd())
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
        switch_workspace(cmux, item, vim.fn.fnamemodify(items[1].path, ":t"))
      end)
    end)
  end)
end

vim.api.nvim_create_autocmd({ "VimEnter", "FocusGained" }, {
  callback = function()
    local cwd = vim.uv.cwd()
    if cwd then
      vim.system({ "worktree-activity", "record", "nvim", cwd }, { text = true })
    end
  end,
})

return M
