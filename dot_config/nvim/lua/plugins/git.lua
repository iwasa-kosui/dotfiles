local function collect_worktrees()
  local output = vim.fn.systemlist({ "git", "worktree", "list", "--porcelain" })
  if vim.v.shell_error ~= 0 then
    return nil, table.concat(output, "\n")
  end

  local worktrees = {}
  local current = {}
  local function flush()
    if current.path then
      table.insert(worktrees, current)
    end
    current = {}
  end
  for _, line in ipairs(output) do
    if line == "" then
      flush()
    else
      local key, value = line:match("^(%S+)%s?(.*)$")
      if key == "worktree" then
        current.path = value
      elseif key == "HEAD" then
        current.head = value
      elseif key == "branch" then
        current.branch = value:gsub("^refs/heads/", "")
      elseif key == "bare" then
        current.bare = true
      elseif key == "detached" then
        current.detached = true
      end
    end
  end
  flush()
  return worktrees
end

local function worktree_picker()
  local worktrees, err = collect_worktrees()
  if not worktrees then
    vim.notify("git worktree list failed: " .. (err or ""), vim.log.levels.ERROR)
    return
  end

  local cwd = vim.uv.cwd() or vim.fn.getcwd()
  local items = {}
  for _, wt in ipairs(worktrees) do
    if not wt.bare then
      local label = wt.branch or (wt.detached and "(detached)") or "?"
      table.insert(items, {
        text = label .. "\t" .. wt.path,
        path = wt.path,
        branch = label,
        current = wt.path == cwd,
      })
    end
  end
  table.sort(items, function(a, b)
    if a.current ~= b.current then
      return a.current
    end
    return a.branch < b.branch
  end)

  require("snacks").picker({
    source = "git_worktrees",
    title = "Git Worktrees",
    items = items,
    format = function(item)
      local ret = {}
      ret[#ret + 1] = { item.current and "● " or "  ", "SnacksPickerGitBranchCurrent" }
      ret[#ret + 1] = { item.branch, "SnacksPickerGitBranch" }
      ret[#ret + 1] = { "  ", "SnacksPickerDelim" }
      ret[#ret + 1] = { vim.fn.fnamemodify(item.path, ":~"), "SnacksPickerDir" }
      return ret
    end,
    confirm = function(picker, item)
      picker:close()
      if not item or not item.path then
        return
      end
      if vim.fn.isdirectory(item.path) == 0 then
        vim.notify("worktree path missing: " .. item.path, vim.log.levels.ERROR)
        return
      end
      vim.cmd("cd " .. vim.fn.fnameescape(item.path))
      vim.notify(("cd %s [%s]"):format(vim.fn.fnamemodify(item.path, ":~"), item.branch))
    end,
  })
end

return {
  {
    "kdheepak/lazygit.nvim",
    keys = {
      { "<leader>gg", "<cmd>LazyGit<cr>", desc = "LazyGit" },
    },
  },
  {
    "sindrets/diffview.nvim",
    cmd = { "DiffviewOpen", "DiffviewFileHistory" },
    keys = {
      { "<leader>gz", "<cmd>DiffviewOpen main<cr>", desc = "Diffview Open" },
      { "<leader>gh", "<cmd>DiffviewFileHistory %<cr>", desc = "File History" },
      { "<leader>gH", "<cmd>DiffviewFileHistory<cr>", desc = "Branch History" },
    },
  },
  {
    "folke/snacks.nvim",
    keys = {
      { "<leader>gw", worktree_picker, desc = "Git Worktrees" },
    },
  },
}

