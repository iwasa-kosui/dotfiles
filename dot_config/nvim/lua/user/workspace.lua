local M = {}

local function root()
  return require("lazyvim.util").root.get({ normalize = true }) or vim.uv.cwd()
end

function M.ensure_explorer(opts)
  opts = opts or {}
  local current = vim.api.nvim_get_current_win()
  local cwd = root()
  Snacks.explorer({ cwd = cwd })
  require("user.base_diff").refresh_and_render(cwd)
  if opts.focus == false then
    vim.schedule(function()
      if vim.api.nvim_win_is_valid(current) then
        vim.api.nvim_set_current_win(current)
      end
    end)
  end
end

function M.focus_explorer()
  Snacks.explorer.reveal({ file = vim.api.nvim_buf_get_name(0) })
end

function M.files()
  Snacks.picker.files({ cwd = root() })
end

function M.search()
  Snacks.picker.grep({ cwd = root() })
end

function M.replace()
  require("grug-far").open({ transient = true, prefills = { paths = root() } })
end

function M.next_file()
  vim.cmd.bnext()
end

function M.previous_file()
  vim.cmd.bprevious()
end

function M.git_dock()
  Snacks.lazygit({ cwd = root(), win = { position = "right", width = 0.36, height = 1 } })
end

return M
