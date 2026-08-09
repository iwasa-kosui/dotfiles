local M = {}

local caches = {}
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
  return vim.fs.normalize(vim.fn.fnamemodify(path, ":p"))
end

local function output_lines(output)
  return vim.split(output or "", "\n", { trimempty = true })
end

local function run(command, cwd, callback)
  vim.system(command, { cwd = cwd, text = true }, callback)
end

function M.parse_name_status(lines)
  local result = {}
  for _, line in ipairs(lines) do
    local columns = vim.split(line, "\t", { plain = true })
    local code = columns[1] and columns[1]:sub(1, 1)
    local path = code == "R" and columns[3] or columns[2]
    if path and code ~= "D" then
      result[path] = code
    end
  end
  return result
end

function M.parse_porcelain(lines)
  local result = {}
  for _, line in ipairs(lines) do
    local code = line:sub(1, 2)
    local path = line:sub(4)
    if code == "??" then
      result[path] = "A"
    elseif path ~= "" then
      if code:find("R", 1, true) then
        result[path] = "R"
      elseif code:find("A", 1, true) then
        result[path] = "A"
      elseif code:find("D", 1, true) then
        result[path] = "D"
      elseif code:find("M", 1, true) then
        result[path] = "M"
      end
    end
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

local function complete(callback, success)
  if callback then
    vim.schedule(function()
      callback(success)
    end)
  end
end

function M.refresh(cwd, callback)
  cwd = normalize(cwd)

  run({ "gh", "pr", "view", "--json", "baseRefName" }, cwd, function(pr_result)
    local pr_base
    if pr_result.code == 0 then
      local ok, pr = pcall(vim.json.decode, pr_result.stdout)
      if ok and type(pr) == "table" then
        pr_base = pr.baseRefName
      end
    end

    run({ "git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD" }, cwd, function(head_result)
      local origin_head = head_result.code == 0 and vim.trim(head_result.stdout) or nil
      local candidates = M.base_candidates(pr_base, origin_head)

      local function try_base(index)
        local base = candidates[index]
        if not base then
          complete(callback, false)
          return
        end

        run({ "git", "merge-base", "HEAD", base }, cwd, function(merge_base_result)
          if merge_base_result.code ~= 0 then
            try_base(index + 1)
            return
          end

          local merge_base = vim.trim(merge_base_result.stdout)
          if merge_base == "" then
            try_base(index + 1)
            return
          end

          run({ "git", "diff", "--name-status", "--find-renames", merge_base }, cwd, function(diff_result)
            if diff_result.code ~= 0 then
              complete(callback, false)
              return
            end

            run({ "git", "status", "--porcelain=v1", "--untracked-files=all" }, cwd, function(status_result)
              if status_result.code ~= 0 then
                complete(callback, false)
                return
              end

              local changes = M.parse_name_status(output_lines(diff_result.stdout))
              for path, status in pairs(M.parse_porcelain(output_lines(status_result.stdout))) do
                if status == "A" then
                  changes[path] = status
                end
              end

              local cache = {}
              for path, status in pairs(changes) do
                cache[normalize(cwd .. "/" .. path)] = status
              end
              caches[cwd] = cache
              complete(callback, true)
            end)
          end)
        end)
      end

      try_base(1)
    end)
  end)
end

function M.status(path)
  local normalized = normalize(path)
  for _, cache in pairs(caches) do
    local status = cache[normalized]
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
  cwd = normalize(cwd)
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
      M.refresh(cwd)
    end)
  )
end

local group = vim.api.nvim_create_augroup("ExplorerBaseDiff", { clear = true })
vim.api.nvim_create_autocmd({ "BufWritePost", "FocusGained", "ShellCmdPost" }, {
  group = group,
  callback = function()
    M.debounce(vim.fn.getcwd())
  end,
})

return M
