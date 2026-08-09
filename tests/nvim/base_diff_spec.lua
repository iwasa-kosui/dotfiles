local t = require("testlib")
local diff = require("user.base_diff")

t.eq(
	{
		["lua/new.lua"] = "A",
		["lua/edit.lua"] = "M",
		["lua/moved.lua"] = "R",
	},
	diff.parse_name_status({
		"A\tlua/new.lua",
		"M\tlua/edit.lua",
		"R100\tlua/old.lua\tlua/moved.lua",
		"D\tlua/gone.lua",
	})
)

t.eq(
	{
		['lua/"quoted".lua'] = "A",
		["lua/edit file.lua"] = "M",
		["lua/new\nline.lua"] = "M",
		["lua/new name.lua"] = "R",
	},
	diff.parse_porcelain_z(
		'M  lua/edit file.lua\0?? lua/"quoted".lua\0R  lua/new name.lua\0lua/old name.lua\0 M lua/new\nline.lua\0'
	)
)

t.eq({ "origin/develop", "origin/main", "origin/master" }, diff.base_candidates("develop", nil))

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
