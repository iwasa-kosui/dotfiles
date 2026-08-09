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

local resumed_codex = { hidden = 0 }
function resumed_codex:hide()
	self.hidden = self.hidden + 1
end
dock:activate("codex", resumed_codex)
t.eq(1, claude.hidden)

local next_resume = { hidden = 0 }
function next_resume:hide()
	self.hidden = self.hidden + 1
end
dock:activate("codex", next_resume)
t.eq(1, resumed_codex.hidden, "replacing a same-name Dock handle must hide the old handle")
t.eq(next_resume, dock.active.handle, "only the replacement handle may remain active")
dock:activate("codex", next_resume)
t.eq(0, next_resume.hidden, "reactivating the same handle must not hide itself")
