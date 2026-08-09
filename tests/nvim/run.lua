local root = vim.fn.getcwd()
package.path = table.concat({
	root .. "/dot_config/nvim/lua/?.lua",
	root .. "/dot_config/nvim/lua/?/init.lua",
	root .. "/tests/nvim/?.lua",
	package.path,
}, ";")

local specs = {}
for name, kind in vim.fs.dir(root .. "/tests/nvim") do
	if kind == "file" and name:match("_spec%.lua$") then
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
