local t = require("testlib")
local worktrees = require("user.worktrees")

local items = worktrees.parse_porcelain({
  "worktree /repo",
  "HEAD aaaa",
  "branch refs/heads/main",
  "",
  "worktree /repo/.wt/feat-a",
  "HEAD bbbb",
  "branch refs/heads/feat/a",
  "",
  "worktree /repo/.wt/feat-b",
  "HEAD cccc",
  "branch refs/heads/feat/b",
  "",
})

local sorted = worktrees.sort(items, {
  { path = "/repo/.wt/feat-b", source = "codex", lastUsedAt = 30 },
  { path = "/repo/.wt/feat-a", source = "claude", lastUsedAt = 20 },
}, "/repo/.wt/feat-a")

t.eq({ "feat/a", "feat/b", "main" }, vim.tbl_map(function(item)
  return item.branch
end, sorted))

t.eq("/repo/.wt/feat-a", items[2].path)
