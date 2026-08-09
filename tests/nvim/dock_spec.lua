local t = require("testlib")
local dock = require("user.dock").new()

local codex = { hidden = 0 }
function codex:hide()
	self.hidden = self.hidden + 1
end
local git = { hidden = 0 }
function git:hide()
	self.hidden = self.hidden + 1
end
local claude = { hidden = 0 }
function claude:hide()
	self.hidden = self.hidden + 1
end

dock:activate("codex", codex)
dock:activate("git", git)
t.eq(1, codex.hidden, "opening Git Dock must hide AI Dock")
dock:activate("claude", claude)
t.eq(1, git.hidden, "opening AI Dock must hide Git Dock")
t.eq(0, claude.hidden)
