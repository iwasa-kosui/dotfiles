local M = {}
local worktree_root = require("user.worktree_root")

local snapshots = {}
local errors = {}
local subscribers = {}
local generations = {}
local timers = {}

local highlights = {
  A = "ExplorerBaseAdded",
  M = "ExplorerBaseModified",
  R = "ExplorerBaseRenamed",
}

vim.api.nvim_set_hl(0, "ExplorerBaseAdded", { link = "GitSignsAdd" })
vim.api.nvim_set_hl(0, "ExplorerBaseModified", { link = "GitSignsChange" })
vim.api.nvim_set_hl(0, "ExplorerBaseRenamed", { link = "GitSignsChange" })

local function normalize(path)
  return worktree_root.normalize(path)
end

local function run(command, cwd, callback)
  vim.system(command, { cwd = cwd, text = true }, callback)
end

---@class BaseDiffChange
---@field status "A"|"M"|"R"|"D"
---@field path string
---@field old_path? string

---@class BaseDiffSnapshot
---@field cwd string
---@field base_ref string
---@field base_name string
---@field merge_base string
---@field changes BaseDiffChange[]
---@field statuses table<string, string>

function M.parse_name_status_z(output)
  local records = vim.split(output or "", "\0", { plain = true })
  local changes = {}
  local index = 1
  while index <= #records do
    local raw = records[index]
    local status = raw:sub(1, 1)
    if raw == "" then
      break
    end
    if status == "R" then
      changes[#changes + 1] = {
        status = "R",
        old_path = records[index + 1],
        path = records[index + 2],
      }
      index = index + 3
    elseif vim.tbl_contains({ "A", "M", "D" }, status) then
      changes[#changes + 1] = { status = status, path = records[index + 1] }
      index = index + 2
    else
      index = index + 1
    end
  end
  return changes
end

function M.parse_porcelain_z(output)
  local result = {}
  local records = vim.split(output or "", "\0", { plain = true })
  local index = 1
  while index <= #records do
    local record = records[index]
    local code = record:sub(1, 2)
    local path = record:sub(4)
    if code == "??" then
      result[path] = "A"
    elseif path ~= "" then
      if code:find("R", 1, true) then
        result[path] = "R"
        index = index + 1
      elseif code:find("A", 1, true) then
        result[path] = "A"
      elseif code:find("D", 1, true) then
        result[path] = "D"
      elseif code:find("M", 1, true) then
        result[path] = "M"
      end
    end
    index = index + 1
  end
  return result
end

function M.base_candidates(pr_base, origin_head)
  local candidates = {}
  local seen = {}
  local function add(branch)
    if branch and branch ~= "" then
      branch = branch:gsub("^%s+", ""):gsub("%s+$", "")
      if branch ~= "" then
        if not branch:match("^origin/") then
          branch = "origin/" .. branch
        end
        if not seen[branch] then
          seen[branch] = true
          candidates[#candidates + 1] = branch
        end
      end
    end
  end

  add(pr_base)
  add(origin_head)
  add("origin/main")
  add("origin/master")
  return candidates
end

local function complete(callback, success, snapshot, err, current)
  if callback then
    vim.schedule(function()
      if current() then
        callback(success, snapshot, err)
      end
    end)
  end
end

function M.snapshot(cwd)
  return snapshots[worktree_root.resolve(cwd)]
end

function M.error(cwd)
  return errors[worktree_root.resolve(cwd)]
end

function M.subscribe(cwd, callback)
  cwd = worktree_root.resolve(cwd)
  subscribers[cwd] = subscribers[cwd] or {}
  subscribers[cwd][callback] = true
  return function()
    if subscribers[cwd] then
      subscribers[cwd][callback] = nil
    end
  end
end

local function publish(cwd, snapshot, err, current)
  for callback in pairs(subscribers[cwd] or {}) do
    vim.schedule(function()
      if current() then
        callback(snapshot, err)
      end
    end)
  end
end

local function result_error(result, fallback)
  local detail = vim.trim((result and (result.stderr or result.stdout)) or "")
  return detail ~= "" and detail or fallback
end

function M.refresh(cwd, callback, adapter)
  adapter = adapter or {}
  cwd = (adapter.root or worktree_root.resolve)(cwd)
  local execute = adapter.run or run
  local generation = (generations[cwd] or 0) + 1
  generations[cwd] = generation

  local function current()
    return generations[cwd] == generation
  end

  local function finish(success, snapshot, err)
    if current() then
      complete(callback, success, snapshot, err, current)
    end
  end

  local function fail(err)
    if current() then
      errors[cwd] = err
      local snapshot = snapshots[cwd]
      publish(cwd, snapshot, err, current)
      finish(false, snapshot, err)
    end
  end

  execute({ "gh", "pr", "view", "--json", "baseRefName" }, cwd, function(pr_result)
    if not current() then
      return
    end

    local pr_base
    if pr_result.code == 0 then
      local ok, pr = pcall(vim.json.decode, pr_result.stdout or "")
      if ok and type(pr) == "table" then
        pr_base = pr.baseRefName
      end
    end

    execute({ "git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD" }, cwd, function(head_result)
      if not current() then
        return
      end

      local origin_head = head_result.code == 0 and vim.trim(head_result.stdout or "") or nil
      local candidates = M.base_candidates(pr_base, origin_head)

      local function try_base(index)
        if not current() then
          return
        end

        local base = candidates[index]
        if not base then
          fail("Unable to resolve a merge base from configured base candidates")
          return
        end

        execute({ "git", "merge-base", "HEAD", base }, cwd, function(merge_base_result)
          if not current() then
            return
          end

          if merge_base_result.code ~= 0 then
            try_base(index + 1)
            return
          end

          local merge_base = vim.trim(merge_base_result.stdout or "")
          if merge_base == "" then
            try_base(index + 1)
            return
          end

          execute({ "git", "diff", "--name-status", "-z", "--find-renames", merge_base }, cwd, function(diff_result)
            if not current() then
              return
            end

            if diff_result.code ~= 0 then
              fail(result_error(diff_result, "git diff failed"))
              return
            end

            execute({ "git", "status", "--porcelain=v1", "-z", "--untracked-files=all" }, cwd, function(status_result)
              if not current() then
                return
              end

              if status_result.code ~= 0 then
                fail(result_error(status_result, "git status failed"))
                return
              end

              local changes = M.parse_name_status_z(diff_result.stdout)
              local seen = {}
              for _, change in ipairs(changes) do
                seen[change.path] = true
              end
              for path, status in pairs(M.parse_porcelain_z(status_result.stdout)) do
                if status == "A" and not seen[path] then
                  changes[#changes + 1] = { status = "A", path = path }
                  seen[path] = true
                end
              end

              table.sort(changes, function(left, right)
                return left.path < right.path
              end)
              local statuses = {}
              for _, change in ipairs(changes) do
                if change.status ~= "D" then
                  statuses[normalize(cwd .. "/" .. change.path)] = change.status
                end
              end
              local snapshot = {
                cwd = cwd,
                base_ref = base,
                base_name = base:gsub("^origin/", ""),
                merge_base = merge_base,
                changes = changes,
                statuses = statuses,
              }
              if current() then
                snapshots[cwd] = snapshot
                errors[cwd] = nil
                publish(cwd, snapshot, nil, current)
                finish(true, snapshot, nil)
              end
            end)
          end)
        end)
      end

      try_base(1)
    end)
  end)
end

function M.refresh_explorers(cwd)
  cwd = worktree_root.resolve(cwd)
  local actions = require("snacks.explorer.actions")
  for _, picker in ipairs(Snacks.picker.get({ source = "explorer" })) do
    if normalize(picker:cwd()) == cwd then
      actions.update(picker, { refresh = true })
    end
  end
end

function M.refresh_and_render(cwd, opts)
  opts = opts or {}
  M.refresh(cwd, function(success, _, err)
    if success then
      M.refresh_explorers(cwd)
    elseif opts.notify and err then
      vim.notify("Base diff refresh failed: " .. err, vim.log.levels.WARN)
    end
  end)
end

function M.status(path)
  local normalized = normalize(path)
  for _, snapshot in pairs(snapshots) do
    local status = snapshot.statuses[normalized]
    if status then
      return status
    end
  end
end

function M.format(item, picker)
  local chunks = Snacks.picker.format.file(item, picker)
  local path = item.path or (item.file and item.file.path)
  local highlight = path and highlights[M.status(path)]
  if highlight then
    for _, chunk in ipairs(chunks) do
      if chunk.field == "file" then
        chunk[2] = highlight
      end
    end
  end
  return chunks
end

function M.debounce(cwd)
  cwd = worktree_root.resolve(cwd)
  local timer = timers[cwd]
  if not timer then
    timer = vim.uv.new_timer()
    timers[cwd] = timer
  end
  timer:stop()
  timer:start(
    200,
    0,
    vim.schedule_wrap(function()
      M.refresh_and_render(cwd)
    end)
  )
end

local group = vim.api.nvim_create_augroup("ExplorerBaseDiff", { clear = true })
vim.api.nvim_create_autocmd({ "BufWritePost", "FocusGained", "ShellCmdPost" }, {
  group = group,
  callback = function()
    M.debounce(worktree_root.resolve(vim.fn.getcwd()))
  end,
})

return M
