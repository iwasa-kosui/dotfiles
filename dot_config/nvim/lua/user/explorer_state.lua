local M = {}

local tracked = {}

local function default_path()
  return vim.fn.stdpath("state") .. "/explorer-state.json"
end

local function normalize(path, adapter)
  local realpath = adapter.realpath or function(value)
    return vim.uv.fs_realpath(value) or value
  end
  return vim.fs.normalize(realpath(vim.fs.normalize(path)) or path):gsub("/$", "")
end

local function read_state(adapter)
  local path = adapter.path or default_path()
  local ok, lines
  if adapter.read then
    ok, lines = pcall(adapter.read, path)
  else
    ok, lines = pcall(vim.fn.readfile, path)
  end
  if not ok then
    return {}
  end
  if not lines or #lines == 0 then
    return {}
  end
  local ok, decoded = pcall(vim.json.decode, table.concat(lines, "\n"))
  return ok and type(decoded) == "table" and decoded or {}
end

local function write_state(value, adapter)
  local path = adapter.path or default_path()
  if adapter.write then
    adapter.write(path, { vim.json.encode(value) })
    return
  end
  vim.fn.mkdir(vim.fs.dirname(path), "p")
  vim.fn.writefile({ vim.json.encode(value) }, path)
end

local function is_child(root, path)
  return path:sub(1, #root + 1) == root .. "/"
end

function M.normalize_paths(root, paths, adapter)
  adapter = adapter or {}
  root = normalize(root, adapter)
  local seen = {}
  local result = {}
  for _, path in ipairs(paths or {}) do
    path = normalize(path, adapter)
    if is_child(root, path) and not seen[path] then
      seen[path] = true
      result[#result + 1] = path
    end
  end
  table.sort(result)
  return result
end

function M.load(root, adapter)
  adapter = adapter or {}
  root = normalize(root, adapter)
  return M.normalize_paths(root, read_state(adapter)[root] or {}, adapter)
end

function M.save(root, paths, adapter)
  adapter = adapter or {}
  root = normalize(root, adapter)
  local value = read_state(adapter)
  value[root] = M.normalize_paths(root, paths, adapter)
  write_state(value, adapter)
end

function M.capture(root, tree, adapter)
  local paths = {}
  for path, node in pairs(tree.nodes or {}) do
    if node.dir and node.open then
      paths[#paths + 1] = path
    end
  end
  return M.normalize_paths(root, paths, adapter or {})
end

function M.restore(root, tree, adapter)
  for _, path in ipairs(M.load(root, adapter)) do
    pcall(tree.open, tree, path)
  end
end

function M.track(root)
  tracked[root] = true
end

vim.api.nvim_create_autocmd("VimLeavePre", {
  callback = function()
    local ok, tree = pcall(require, "snacks.explorer.tree")
    if not ok then
      return
    end
    for root in pairs(tracked) do
      pcall(function()
        M.save(root, M.capture(root, tree))
      end)
    end
  end,
})

return M
