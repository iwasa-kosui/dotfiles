local t = require("testlib")
local diff = require("user.base_diff")

local original_system = vim.system
local pending = {}
vim.system = function(_, _, callback)
  pending[#pending + 1] = callback
end

local function respond(index, result)
  pending[index](result)
end

local callbacks = {}
local cwd = "/tmp/base-diff-refresh-spec"
diff.refresh(cwd, function(success)
  callbacks[#callbacks + 1] = success
end)
diff.refresh(cwd, function(success)
  callbacks[#callbacks + 1] = success
end)

respond(2, { code = 1, stdout = "" })
respond(3, { code = 0, stdout = "origin/main\n" })
respond(4, { code = 0, stdout = "base\n" })
respond(5, { code = 0, stdout = "A\tnew.lua\n" })
respond(6, { code = 0, stdout = "" })

respond(1, { code = 1, stdout = "" })

t.truthy(vim.wait(100, function()
  return #callbacks == 1
end), "only the most recent refresh should invoke its callback")
t.eq({ true }, callbacks)
t.eq("A", diff.status(cwd .. "/new.lua"))

vim.system = original_system
