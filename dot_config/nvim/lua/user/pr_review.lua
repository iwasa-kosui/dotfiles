local M = {}

function M.parse_pr(json)
  if type(json) ~= "string" then
    return nil
  end

  local ok, value = pcall(vim.json.decode, json)
  if
    not ok
    or type(value) ~= "table"
    or type(value.number) ~= "number"
    or value.number <= 0
    or value.number % 1 ~= 0
  then
    return nil
  end

  return value.number
end

local function open_list(edit_error)
  local ok, list_error = pcall(vim.cmd, "Octo pr list")
  if not ok then
    vim.notify(
      "Octo の PR 画面を開けませんでした: " .. tostring(edit_error or list_error),
      vim.log.levels.ERROR
    )
  end
end

function M.open()
  vim.system({ "gh", "pr", "view", "--json", "number" }, { text = true }, function(result)
    local number = result.code == 0 and M.parse_pr(result.stdout) or nil
    vim.schedule(function()
      if not number then
        open_list()
        return
      end

      local ok, edit_error = pcall(vim.cmd, "Octo pr edit " .. number)
      if not ok then
        open_list(edit_error)
      end
    end)
  end)
end

function M.ensure_review_explorer()
  local octo_window = vim.api.nvim_get_current_win()
  vim.schedule(function()
    require("user.workspace").ensure_explorer({ focus = false })
    vim.schedule(function()
      if vim.api.nvim_win_is_valid(octo_window) then
        vim.api.nvim_set_current_win(octo_window)
      end
    end)
  end)
end

return M
