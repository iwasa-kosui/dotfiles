local t = require("testlib")
local root = require("user.worktree_root")

local adapter = {
	realpath = function(path)
		local paths = {
			["/repo-link/apps/web"] = "/repo/apps/web",
			["/repo-link"] = "/repo",
			["/repo"] = "/repo",
		}
		return paths[path] or path
	end,
	git_toplevel = function(path)
		t.eq("/repo/apps/web", path)
		return "/repo-link"
	end,
}

t.eq("/repo", root.resolve("/repo-link/apps/web", adapter))
t.eq(
	"/outside",
	root.resolve("/outside", {
		realpath = function(path)
			return path
		end,
		git_toplevel = function()
			return nil
		end,
	})
)
