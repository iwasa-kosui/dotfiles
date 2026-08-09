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

local guarded = { managed = 0, direct = 0 }
function guarded:dock_hide()
	self.managed = self.managed + 1
end
function guarded:hide()
	self.direct = self.direct + 1
end
dock:activate("guarded", guarded)
dock:activate("git", git)
t.eq(1, guarded.managed, "Dock transitions must use the callback-suppressed hide path")
t.eq(0, guarded.direct, "Dock transitions must not look like a user window close")

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

local stale_dock = require("user.dock").new()
local stale_handle = { live = true, hide = function() end }
local current_handle = { live = true, shown = 0, hide = function() end }
function current_handle:show()
	self.shown = self.shown + 1
end
stale_dock:set_default("lazygit", function()
	return current_handle
end, function(handle)
	return handle.live
end)
stale_dock:activate("lazygit", stale_handle)
stale_dock:activate("lazygit", current_handle)
stale_dock:deactivate("lazygit", stale_handle, { explicit = true })
t.eq(current_handle, stale_dock.active.handle, "a stale close must not clear the replacement LazyGit handle")

local stale_codex = { hide = function() end }
stale_dock:activate("codex", stale_codex)
stale_dock:deactivate("codex", stale_codex)
t.eq(current_handle, stale_dock.active.handle, "a stale close must leave the default fallback enabled")
t.eq(1, current_handle.shown)

local race_dock = require("user.dock").new()
local race_lazygit = { live = true, shown = 0, hide = function() end }
function race_lazygit:show()
	self.shown = self.shown + 1
end
race_dock:set_default("lazygit", function()
	return race_lazygit
end, function(handle)
	return handle.live
end)
race_dock:activate("lazygit", race_lazygit)
local race_codex = { hidden = 0 }
function race_codex:hide()
	self.hidden = self.hidden + 1
end
race_dock:activate("codex", race_codex)
race_dock:deactivate("lazygit", race_lazygit, { explicit = true, restore = false })
t.eq(race_codex, race_dock.active.handle, "late LazyGit cleanup must not deactivate the active AI Dock")
t.eq(false, race_dock.default.enabled, "explicit close must disable its matching default handle when inactive")
race_dock:deactivate("codex", race_codex)
t.eq(nil, race_dock.active, "closing AI after explicit LazyGit quit must not restore LazyGit")
t.eq(0, race_lazygit.shown)
