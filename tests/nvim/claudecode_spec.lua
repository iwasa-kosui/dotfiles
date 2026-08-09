local t = require("testlib")

local project_root = "/repo/.wt/feature"
local previous_preload = package.preload["lazyvim.util"]
local previous_loaded = package.loaded["lazyvim.util"]

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

local ok, err = pcall(function()
	local plugin = dofile(vim.fn.getcwd() .. "/dot_config/nvim/lua/plugins/claudecode.lua")
	local provider = plugin[1].opts.terminal.cwd_provider
	t.truthy(provider, "Claude cwd provider must be configured")
	t.eq(
		project_root,
		provider({
			file = "/outside/project/file.lua",
			file_dir = "/outside/project",
			cwd = "/outside/project",
		})
	)
end)

package.preload["lazyvim.util"] = previous_preload
package.loaded["lazyvim.util"] = previous_loaded

if not ok then
	error(err)
end
