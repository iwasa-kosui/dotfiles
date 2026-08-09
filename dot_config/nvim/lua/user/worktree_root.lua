local M = {}

local function default_realpath(path)
  return vim.uv.fs_realpath(path) or vim.fs.normalize(vim.fn.fnamemodify(path, ":p"))
end

local function default_git_toplevel(path)
  local output = vim.fn.systemlist({ "git", "-C", path, "rev-parse", "--show-toplevel" })
  if vim.v.shell_error ~= 0 or not output[1] or output[1] == "" then
    return nil
  end
  return output[1]
end

function M.normalize(path, adapter)
  adapter = adapter or {}
  local realpath = adapter.realpath or default_realpath
  local normalized = vim.fs.normalize(vim.fn.fnamemodify(path, ":p"))
  return vim.fs.normalize(realpath(normalized) or normalized)
end

function M.resolve(path, adapter)
  adapter = adapter or {}
  local candidate = M.normalize(path or vim.uv.cwd() or vim.fn.getcwd(), adapter)
  local git_toplevel = adapter.git_toplevel or default_git_toplevel
  local toplevel = git_toplevel(candidate)
  return toplevel and M.normalize(toplevel, adapter) or candidate
end

return M
