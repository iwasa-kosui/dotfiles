local M = {}

---@class BaseDiffTreeNode
---@field kind "root"|"header"|"directory"|"file"
---@field name string
---@field path string
---@field children? BaseDiffTreeNode[]
---@field status? "A"|"M"|"R"|"D"
---@field old_path? string
---@field change? BaseDiffChange

local function sort_children(node)
  if not node.children then
    return
  end
  table.sort(node.children, function(left, right)
    if left.kind ~= right.kind then
      return left.kind == "directory"
    end
    return left.name < right.name
  end)
  for _, child in ipairs(node.children) do
    sort_children(child)
  end
end

local function find_child(node, kind, name)
  for _, child in ipairs(node.children or {}) do
    if child.kind == kind and child.name == name then
      return child
    end
  end
end

function M.build(changes)
  local root = { kind = "root", name = "", path = "", children = {} }
  for _, change in ipairs(changes or {}) do
    local parent = root
    local segments = vim.split(change.path or "", "/", { plain = true, trimempty = true })
    for index, name in ipairs(segments) do
      local path = parent.path == "" and name or parent.path .. "/" .. name
      if index == #segments then
        parent.children[#parent.children + 1] = {
          kind = "file",
          name = name,
          path = path,
          status = change.status,
          old_path = change.old_path,
          change = change,
        }
      else
        local directory = find_child(parent, "directory", name)
        if not directory then
          directory = { kind = "directory", name = name, path = path, children = {} }
          parent.children[#parent.children + 1] = directory
        end
        parent = directory
      end
    end
  end
  sort_children(root)
  return root
end

local function add_line(rendered, line, item)
  rendered.lines[#rendered.lines + 1] = line
  rendered.items[#rendered.lines] = item
end

local function old_filename(path)
  return (path or ""):match("([^/]+)$") or ""
end

local function collect_dirs(node, result)
  for _, child in ipairs(node.children or {}) do
    if child.kind == "directory" then
      result[#result + 1] = child.path
      collect_dirs(child, result)
    end
  end
end

local function render_children(rendered, node, open_dirs, depth)
  for _, child in ipairs(node.children or {}) do
    local prefix = string.rep("  ", depth)
    if child.kind == "directory" then
      local open = open_dirs[child.path] == true
      add_line(rendered, prefix .. (open and "⌄ " or "▸ ") .. child.name, child)
      if open then
        render_children(rendered, child, open_dirs, depth + 1)
      end
    else
      local file_prefix = string.rep("  ", math.max(depth, 3))
      local line = file_prefix .. (child.status or "?") .. " " .. child.name
      if child.status == "R" and child.old_path then
        line = line .. " ← " .. old_filename(child.old_path)
      end
      add_line(rendered, line, child)
    end
  end
end

function M.render(snapshot, state, error)
  state = state or {}
  local collapsed = state.collapsed == true
  local rendered = { lines = {}, items = {}, valid_open_dirs = {} }
  local header = { kind = "header", name = "BASE CHANGES", path = "" }

  if not snapshot then
    add_line(rendered, (collapsed and "▸" or "⌄") .. " BASE CHANGES · unavailable", header)
    if not collapsed and error and error ~= "" then
      add_line(rendered, "  " .. error, { kind = "root", name = error, path = "" })
    end
    return rendered
  end

  local changes = snapshot.changes or {}
  local suffix = error and error ~= "" and " !" or ""
  add_line(
    rendered,
    (collapsed and "▸" or "⌄")
      .. " BASE CHANGES · "
      .. (snapshot.base_name or "unavailable")
      .. " · "
      .. #changes
      .. suffix,
    header
  )
  local root
  if #changes > 0 then
    root = M.build(changes)
    collect_dirs(root, rendered.valid_open_dirs)
  end
  if collapsed then
    return rendered
  end
  if #changes == 0 then
    add_line(rendered, "  No base changes", { kind = "root", name = "No base changes", path = "" })
    return rendered
  end

  local open_dirs = {}
  for _, path in ipairs(state.open_dirs or {}) do
    open_dirs[path] = true
  end
  render_children(rendered, root, open_dirs, 1)
  return rendered
end

return M
