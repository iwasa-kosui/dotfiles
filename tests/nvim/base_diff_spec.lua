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

t.eq(
  { "origin/develop", "origin/main", "origin/master" },
  diff.base_candidates("develop", nil)
)
