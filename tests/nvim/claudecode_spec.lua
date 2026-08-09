local t = require("testlib")

local project_root = "/repo/.wt/feature/apps/web"
local worktree_root = "/repo/.wt/feature"
local previous_preload = package.preload["lazyvim.util"]
local previous_loaded = package.loaded["lazyvim.util"]
local previous_worktree_root = package.loaded["user.worktree_root"]

package.loaded["lazyvim.util"] = nil
package.preload["lazyvim.util"] = function()
	return {
		root = {
			get = function(opts)
				t.eq({ normalize = true }, opts)
				return project_root
			end,
		},
	}
end
package.loaded["user.worktree_root"] = {
	resolve = function(path)
		t.eq(project_root, path)
		return worktree_root
	end,
}

local ok, err = pcall(function()
	local plugin = dofile(vim.fn.getcwd() .. "/dot_config/nvim/lua/plugins/claudecode.lua")
	local provider = plugin[1].opts.terminal.cwd_provider
	t.truthy(provider, "Claude cwd provider must be configured")
	t.eq(
		worktree_root,
		provider({
			file = "/outside/project/file.lua",
			file_dir = "/outside/project",
			cwd = "/outside/project",
		})
	)
end)

package.preload["lazyvim.util"] = previous_preload
package.loaded["lazyvim.util"] = previous_loaded
package.loaded["user.worktree_root"] = previous_worktree_root

if not ok then
	error(err)
end

local previous_ai_dock = package.loaded["user.ai_dock"]
local hidden = 0
local notified = 0
package.loaded["user.ai_dock"] = {
	attach = function() end,
	on_hidden = function(provider, buffer)
		t.eq("claude", provider)
		t.eq(77, buffer)
		notified = notified + 1
	end,
}

local plugin = dofile(vim.fn.getcwd() .. "/dot_config/nvim/lua/plugins/claudecode.lua")
local hide = plugin[1].opts.terminal.snacks_win_opts.keys.claude_hide[2]
hide({
	buf = 77,
	hide = function()
		hidden = hidden + 1
	end,
})
t.eq(1, hidden)
t.eq(1, notified)
package.loaded["user.ai_dock"] = previous_ai_dock
