local Controller = {}
Controller.__index = Controller

local function hide(handle)
  local method = handle and (handle.dock_hide or handle.hide)
  if type(method) == "function" then
    pcall(method, handle)
  end
end

local function show(handle)
  local method = handle and (handle.dock_show or handle.show)
  if type(method) == "function" then
    pcall(method, handle)
  end
end

function Controller:prepare(name)
  if self.active and self.active.name ~= name then
    hide(self.active.handle)
    self.active = nil
  end
end

function Controller:activate(name, handle)
  if self.active and self.active.handle ~= handle then
    hide(self.active.handle)
    self.active = nil
  end
  self:prepare(name)
  self.active = { name = name, handle = handle }
  if self.default and self.default.name == name then
    self.default.handle = handle
    self.default.enabled = true
  end
  return handle
end

function Controller:set_default(name, factory, is_live)
  local previous = self.default and self.default.name == name and self.default.handle or nil
  self.default = {
    name = name,
    factory = factory,
    is_live = is_live or function(handle)
      return handle ~= nil
    end,
    handle = previous,
    enabled = true,
  }
end

function Controller:disable_default()
  if self.default then
    self.default.enabled = false
  end
end

function Controller:restore_default()
  local default = self.default
  if not default or not default.enabled then
    return nil
  end
  local handle = default.handle
  if not handle or not default.is_live(handle) then
    handle = default.factory()
    default.handle = handle
  end
  if not handle then
    return nil
  end
  show(handle)
  return self:activate(default.name, handle)
end

function Controller:deactivate(name, handle, opts)
  opts = opts or {}
  local was_active = self.active and self.active.name == name and self.active.handle == handle
  if was_active then
    self.active = nil
  end
  if self.default and self.default.name == name then
    if was_active and opts.explicit then
      self:disable_default()
    end
    return nil
  end
  if was_active and opts.restore ~= false then
    return self:restore_default()
  end
  return nil
end

local M = setmetatable({ active = nil, default = nil }, Controller)

function M.new()
  return setmetatable({ active = nil, default = nil }, Controller)
end

return M
