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

local fallback_dock = require("user.dock").new()
local created = 0
local lazygit = { hidden = 0, shown = 0, live = true }
function lazygit:hide()
	self.hidden = self.hidden + 1
end
function lazygit:show()
	self.shown = self.shown + 1
end

fallback_dock:set_default("lazygit", function()
	created = created + 1
	return lazygit
end, function(handle)
	return handle.live
end)
fallback_dock:activate("lazygit", lazygit)

local fallback_codex = { hide = function() end }
fallback_dock:activate("codex", fallback_codex)
t.eq(1, lazygit.hidden)
fallback_dock:deactivate("codex", fallback_codex)
t.eq(1, lazygit.shown, "closing Codex must restore the live LazyGit handle")
t.eq(lazygit, fallback_dock.active.handle)

lazygit.live = false
fallback_dock:activate("codex", fallback_codex)
local replacement = { shown = 0, live = true, hide = function() end }
function replacement:show()
	self.shown = self.shown + 1
end
fallback_dock.default.factory = function()
	created = created + 1
	return replacement
end
fallback_dock:deactivate("codex", fallback_codex)
t.eq(replacement, fallback_dock.active.handle, "dead LazyGit must be recreated")
t.eq(1, replacement.shown)

fallback_dock:deactivate("lazygit", replacement, { explicit = true, restore = false })
fallback_dock:restore_default()
t.eq(nil, fallback_dock.active, "explicit LazyGit close must disable automatic restore")
