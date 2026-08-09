local t = require("testlib")
local diff = require("user.base_diff")

t.eq({
  ["lua/new.lua"] = "A",
  ["lua/edit.lua"] = "M",
  ["lua/moved.lua"] = "R",
}, diff.parse_name_status({
  "A\tlua/new.lua",
  "M\tlua/edit.lua",
  "R100\tlua/old.lua\tlua/moved.lua",
  "D\tlua/gone.lua",
}))

t.eq({
  ["lua/edit.lua"] = "M",
  ["lua/untracked.lua"] = "A",
}, diff.parse_porcelain({ " M lua/edit.lua", "?? lua/untracked.lua" }))

t.eq({
  ["lua/new-name.lua"] = "R",
}, diff.parse_porcelain({ "R  lua/old-name.lua -> lua/new-name.lua" }))

t.eq(
  { "origin/develop", "origin/main", "origin/master" },
  diff.base_candidates("develop", nil)
)

local refresh = diff.refresh
local refresh_explorers = diff.refresh_explorers
local rendered_cwd
diff.refresh = function(cwd, callback)
  callback(true)
end
diff.refresh_explorers = function(cwd)
  rendered_cwd = cwd
end

diff.refresh_and_render("/tmp/base-diff-spec")
t.eq("/tmp/base-diff-spec", rendered_cwd)

diff.refresh = refresh
diff.refresh_explorers = refresh_explorers
