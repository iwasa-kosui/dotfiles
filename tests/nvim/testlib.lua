local M = {}

function M.eq(expected, actual, message)
	if not vim.deep_equal(expected, actual) then
		error(
			(message or "values differ")
				.. "\nexpected: "
				.. vim.inspect(expected)
				.. "\nactual: "
				.. vim.inspect(actual)
		)
	end
end

function M.truthy(value, message)
	if not value then
		error(message or "expected a truthy value")
	end
end

return M
