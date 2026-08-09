local root = vim.fn.getcwd()
vim.opt.runtimepath:prepend(root .. "/dot_config/nvim")
package.path = table.concat({
	root .. "/dot_config/nvim/lua/?.lua",
	root .. "/dot_config/nvim/lua/?/init.lua",
	root .. "/tests/nvim/?.lua",
	package.path,
}, ";")

local specs = {}
local only = vim.env.NVIM_TEST_SPEC
for name, kind in vim.fs.dir(root .. "/tests/nvim") do
	if kind == "file" and name:match("_spec%.lua$") and (not only or name == only) then
		specs[#specs + 1] = name
	end
end
table.sort(specs)

for _, name in ipairs(specs) do
	local ok, err = pcall(dofile, root .. "/tests/nvim/" .. name)
	if not ok then
		error(name .. ": " .. tostring(err))
	end
end
