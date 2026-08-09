local t = require("testlib")
local tree = require("user.base_diff_tree")

local function make_controller(available_height)
	local heights = {}
	local controller = tree.new({
		load_state = function()
			return { collapsed = false, height = 50, open_dirs = {} }
		end,
		available_height = function()
			return available_height
		end,
		create_panel = function(_, _, height)
			heights[#heights + 1] = height
			return 31, 41
		end,
		valid_win = function(win)
			return win == 31
		end,
		set_height = function(_, height)
			heights[#heights + 1] = height
		end,
		current_diff = function()
			return nil, nil
		end,
		subscribe_diff = function()
			return function() end
		end,
		render_buffer = function() end,
		set_keymaps = function() end,
		save_state = function() end,
		view = { close = function() end },
	})
	controller:ensure({ cwd = "/repo", explorer_win = 30, editor_win = function() end })
	return controller, heights
end

local bounded, bounded_heights = make_controller(12)
t.eq(7, bounded_heights[1], "saved height must leave four Explorer rows and one separator")
bounded:activate(1, "close")
t.eq(1, bounded_heights[#bounded_heights])
bounded:activate(1, "expand")
t.eq(7, bounded_heights[#bounded_heights], "expand must reuse the clamped height")

local tiny, tiny_heights = make_controller(8)
t.eq(1, tiny_heights[1], "a panel that cannot fit at minimum height must collapse")
tiny:activate(1, "expand")
t.eq(1, tiny_heights[#tiny_heights], "a forced one-line panel must not overflow on expand")
