local M = {}

local function default_path()
  return vim.fn.stdpath("state") .. "/base-diff-tree.json"
end

local function default_state()
  return { collapsed = false, height = nil, open_dirs = {} }
end

local function normalize_root(path, adapter)
  local realpath = adapter.realpath or function(value)
    return vim.uv.fs_realpath(value) or value
  end
  return vim.fs.normalize(realpath(vim.fs.normalize(path)) or path):gsub("/$", "")
end

local function normalize_dir(path)
  path = vim.fs.normalize(path or "")
  if path == "." or path == "" or path:sub(1, 1) == "/" or path:match("^%.%./") then
    return nil
  end
  return path
end

local function read_state(adapter)
  local path = adapter.path or default_path()
  local ok, lines
  if adapter.read then
    ok, lines = pcall(adapter.read, path)
  else
    ok, lines = pcall(vim.fn.readfile, path)
  end
  if not ok or not lines or #lines == 0 then
    return {}
  end
  local decoded_ok, decoded = pcall(vim.json.decode, table.concat(lines, "\n"))
  return decoded_ok and type(decoded) == "table" and decoded or {}
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

local function normalize(value)
  value = type(value) == "table" and value or {}
  local open_dirs = {}
  local seen = {}
  for _, path in ipairs(type(value.open_dirs) == "table" and value.open_dirs or {}) do
    path = type(path) == "string" and normalize_dir(path) or nil
    if path and not seen[path] then
      seen[path] = true
      open_dirs[#open_dirs + 1] = path
    end
  end
  table.sort(open_dirs)

  local height = value.height
  if type(height) ~= "number" or height % 1 ~= 0 or height < 4 then
    height = nil
  end

  return {
    collapsed = value.collapsed == true,
    height = height,
    open_dirs = open_dirs,
  }
end

function M.load(root, adapter)
  adapter = adapter or {}
  root = normalize_root(root, adapter)
  return normalize(read_state(adapter)[root] or default_state())
end

function M.save(root, value, adapter)
  adapter = adapter or {}
  root = normalize_root(root, adapter)
  local all = read_state(adapter)
  all[root] = normalize(value)
  write_state(all, adapter)
end

return M
