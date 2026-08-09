local Controller = {}
Controller.__index = Controller

local function hide(handle)
  if handle and type(handle.hide) == "function" then
    pcall(handle.hide, handle)
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
  return handle
end

local M = setmetatable({ active = nil }, Controller)

function M.new()
  return setmetatable({ active = nil }, Controller)
end

return M
