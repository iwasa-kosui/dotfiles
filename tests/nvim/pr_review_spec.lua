local t = require("testlib")
local review = require("user.pr_review")

local previous_lazy_loaded = package.loaded["lazy"]
local previous_lazy_preload = package.preload["lazy"]
local previous_octo_loaded = package.loaded["octo"]
local previous_octo_preload = package.preload["octo"]
local previous_octo_reviews_loaded = package.loaded["octo.reviews"]
local previous_octo_reviews_preload = package.preload["octo.reviews"]
local default_octo_loads = 0
package.loaded["lazy"] = nil
package.loaded["octo"] = nil
package.preload["lazy"] = function()
	return {
		load = function(opts)
			t.eq({ plugins = { "octo.nvim" } }, opts)
			default_octo_loads = default_octo_loads + 1
		end,
	}
end
package.preload["octo"] = function()
	return {}
end
package.loaded["octo.reviews"] = nil
package.preload["octo.reviews"] = function()
	return { get_current_review = function() end }
end

t.eq(133, review.parse_pr('{"number":133}'))
t.eq(nil, review.parse_pr(""))
t.eq(nil, review.parse_pr("not-json"))
t.eq(nil, review.parse_pr('{"number":1.5}'))
t.eq(nil, review.parse_pr('{"number":0}'))
t.eq(nil, review.parse_pr('{"number":-1}'))
t.eq(nil, review.parse_pr('{"number":"1"}'))
t.eq(nil, review.parse_pr('[{"number":1},{"number":2}]'))

local calls = {}
local restored = 0
local loaded_prs = {}
local notifications = {}
local primary_buffer_live = false
local branch = "feat/$(touch hacked);quote'and\"double"
local adapter = {
	root = function(path)
		t.eq("/repo path/.wt/feature", path)
		return "/canonical/repo/.wt/feature"
	end,
	dock = {
		prepare = function(_, name)
			calls[#calls + 1] = "prepare:" .. name
		end,
		activate = function(_, name)
			calls[#calls + 1] = "activate:" .. name
		end,
		deactivate = function(_, name)
			t.eq("pr", name)
			restored = restored + 1
		end,
	},
	system = function(argv, opts, callback)
		t.eq({ "gh", "pr", "view", branch, "--json", "number,url" }, argv)
		t.eq("/canonical/repo/.wt/feature", opts.cwd)
		callback({
			code = 0,
			stdout = '{"number":133,"url":"https://github.com/selected/repo/pull/133"}',
			stderr = "",
		})
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function(callback)
		callback()
	end,
	load_pr = function(target, cwd, callback)
		t.eq("/canonical/repo/.wt/feature", cwd)
		loaded_prs[#loaded_prs + 1] = target
		callback({
			code = 0,
			stdout = vim.json.encode({
				data = {
					repository = {
						pullRequest = {
							id = "PR_" .. target.number,
							number = target.number,
							url = target.url,
							timelineItems = { nodes = {} },
						},
					},
				},
			}),
			stderr = "",
		})
	end,
	create_pr = function()
		primary_buffer_live = true
		return 801
	end,
	buffer_valid = function(target)
		return target == 801 and primary_buffer_live
	end,
	delete_buffer = function(target)
		t.eq(801, target)
		primary_buffer_live = false
	end,
	register_cleanup = function() end,
	reviews = function()
		return { get_current_review = function() end }
	end,
	notify = function(message)
		notifications[#notifications + 1] = message
	end,
}

review.open({ cwd = "/repo path/.wt/feature", branch = branch }, adapter)
t.eq({ "prepare:pr", "activate:pr" }, calls)
t.eq("https://github.com/selected/repo/pull/133", loaded_prs[1].url)

adapter.system = function(argv, _, callback)
	t.eq({ "gh", "pr", "view", branch, "--json", "number,url" }, argv)
	callback({ code = 1, stdout = "", stderr = "no pull requests found" })
end
review.open({ cwd = "/repo path/.wt/feature", branch = branch }, adapter)
t.eq(1, restored, "missing PR must restore LazyGit")
t.eq(1, #loaded_prs, "failed gh output must never reach Octo")
t.truthy(notifications[#notifications]:find(branch, 1, true), "the failure must identify the selected branch")
t.truthy(notifications[#notifications]:find("no pull requests found", 1, true), "the failure must explain gh stderr")

local invalid_outputs = {
	'{"number":"1","url":"https://github.com/selected/repo/pull/1"}',
	'{"number":1.5,"url":"https://github.com/selected/repo/pull/1"}',
	'[{"number":1},{"number":2}]',
	'{"number":1,"url":"https://github.com/selected/repo/pull/2"}',
	'{"number":1,"url":"https://github.com/selected/repo/issues/1"}',
}
for _, stdout in ipairs(invalid_outputs) do
	adapter.system = function(_, _, callback)
		callback({ code = 0, stdout = stdout, stderr = "" })
	end
	review.open({ cwd = "/repo path/.wt/feature", branch = branch }, adapter)
end
t.eq(6, restored, "every ambiguous or invalid PR result must restore LazyGit")
t.eq(1, #loaded_prs, "invalid PR numbers must never reach the Octo data loader")

local current_branch_argv
adapter.system = function(argv, _, callback)
	current_branch_argv = argv
	callback({ code = 0, stdout = '{"number":7,"url":"https://github.com/selected/repo/pull/7"}', stderr = "" })
end
review.open({ cwd = "/repo path/.wt/feature", branch = "" }, adapter)
t.eq({ "gh", "pr", "view", "--json", "number,url" }, current_branch_argv)
t.eq("https://github.com/selected/repo/pull/7", loaded_prs[2].url)

local invalid_root_called = false
local invalid_root_adapter = {
	root = function(path)
		t.eq("/outside", path)
		return nil
	end,
	dock = adapter.dock,
	system = function()
		invalid_root_called = true
	end,
	notify = function(message)
		t.truthy(message:find("Git", 1, true))
	end,
}
review.open({ cwd = "/outside", branch = "feat/review" }, invalid_root_adapter)
t.eq(false, invalid_root_called, "an unverified cwd must never reach gh")

local received
review.receive({ cwd = "/repo", branch = "feat/review" }, {
	open = function(target)
		received = target
	end,
	notify = function(message)
		error(message)
	end,
})
t.eq({ cwd = "/repo", branch = "feat/review" }, received)
local invalid_payload_notified = false
review.receive({ cwd = "", branch = "feat/review" }, {
	open = function()
		error("invalid bridge payload must not be opened")
	end,
	notify = function()
		invalid_payload_notified = true
	end,
})
t.eq(true, invalid_payload_notified)

local function complete_pr_load(target, _, callback)
	callback({
		code = 0,
		stdout = vim.json.encode({
			data = {
				repository = {
					pullRequest = {
						id = "PR_" .. target.number,
						number = target.number,
						url = target.url,
						timelineItems = { nodes = {} },
					},
				},
			},
		}),
		stderr = "",
	})
end

local buffer = vim.api.nvim_create_buf(false, true)
local aliases = {}
local review_actions = {}
local alias_cleanup
local fake_reviews = {
	add_review_comment = function(suggestion)
		review_actions[#review_actions + 1] = suggestion and "suggest" or "comment"
	end,
	submit_review = function()
		review_actions[#review_actions + 1] = "submit"
	end,
	discard_review = function()
		review_actions[#review_actions + 1] = "discard"
	end,
}
local alias_adapter = {
	set_keymap = function(mode, lhs, rhs, opts)
		aliases[mode .. lhs] = { rhs = rhs, opts = opts }
	end,
	reviews = function()
		return fake_reviews
	end,
	command = function(command)
		review_actions[#review_actions + 1] = command
	end,
	register_cleanup = function(_, callback)
		alias_cleanup = callback
	end,
	buffer_filetype = function()
		return ""
	end,
}
review.attach(buffer, alias_adapter)
review.attach(buffer, alias_adapter)
local expected_aliases = {
	["n<leader>pr"] = "Start or resume review",
	["x<leader>pc"] = "Add review comment",
	["x<leader>ps"] = "Add review suggestion",
	["n<leader>pS"] = "Submit review",
	["n<leader>pd"] = "Discard review",
	["n<leader>pq"] = "Close review",
}
for lhs, description in pairs(expected_aliases) do
	t.truthy(aliases[lhs], lhs .. " must be buffer-local")
	t.eq(description, aliases[lhs].opts.desc)
	t.eq(buffer, aliases[lhs].opts.buffer)
end
aliases["n<leader>pr"].rhs()
aliases["x<leader>pc"].rhs()
aliases["x<leader>ps"].rhs()
aliases["n<leader>pS"].rhs()
aliases["n<leader>pd"].rhs()
t.eq({ "Octo review", "comment", "suggest", "submit", "discard" }, review_actions)

t.truthy(alias_cleanup, "review diff buffers must release their duplicate-registration marker")
alias_cleanup()
aliases = {}
review.attach(buffer, alias_adapter)
t.truthy(aliases["n<leader>pr"], "a reused buffer handle must receive fresh review aliases")

vim.api.nvim_buf_delete(buffer, { force = true })

local live = { [901] = true, [902] = true }
local filetypes = { [901] = "octo", [902] = "octo" }
local cleanups = {}
local function run_cleanups(target)
	for _, callback in ipairs(cleanups[target] or {}) do
		callback()
	end
end
local deferred = {}
local current_buffer = 901
local lifecycle_restores = 0
local lifecycle_adapter = {
	root = function()
		return "/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			lifecycle_restores = lifecycle_restores + 1
		end,
	},
	system = function(_, _, callback)
		callback({
			code = 0,
			stdout = '{"number":42,"url":"https://github.com/selected/repo/pull/42"}',
			stderr = "",
		})
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function(callback)
		deferred[#deferred + 1] = callback
	end,
	load_pr = complete_pr_load,
	create_pr = function()
		return current_buffer
	end,
	notify = function(message)
		error(message)
	end,
	set_keymap = function() end,
	register_cleanup = function(target, callback)
		cleanups[target] = cleanups[target] or {}
		cleanups[target][#cleanups[target] + 1] = callback
	end,
	buffer_valid = function(target)
		return live[target] == true
	end,
	buffer_filetype = function(target)
		return filetypes[target]
	end,
	current_buffer = function()
		return current_buffer
	end,
	current_tab = function()
		return 11
	end,
	tab_valid = function()
		return false
	end,
	reviews = function()
		return {
			get_current_review = function()
				return nil
			end,
		}
	end,
	delete_buffer = function(target)
		live[target] = false
	end,
}

review.open({ cwd = "/repo", branch = "first" }, lifecycle_adapter)
review.attach(901, lifecycle_adapter)
live[901] = false
run_cleanups(901)

current_buffer = 902
review.open({ cwd = "/repo", branch = "second" }, lifecycle_adapter)
review.attach(902, lifecycle_adapter)
live[902] = false
run_cleanups(902)

run_cleanups(901)
for _, callback in ipairs(deferred) do
	callback()
end
t.eq(1, lifecycle_restores, "a stale cleanup must not cancel restoration for the current PR session")

run_cleanups(902)
for _, callback in ipairs(deferred) do
	callback()
end
t.eq(1, lifecycle_restores, "a duplicate close must not deactivate a replacement Dock")

live[903] = true
live[904] = true
filetypes[903] = "octo"
filetypes[904] = "diff"
current_buffer = 903
local current_review = {}
local closed_review_tab
local lifecycle_review_tab_live = true
lifecycle_adapter.tab_valid = function(target)
	return target == 11 and lifecycle_review_tab_live
end
lifecycle_adapter.reviews = function()
	return {
		get_current_review = function()
			return current_review
		end,
		close = function(tab)
			closed_review_tab = tab
			current_review = nil
			lifecycle_review_tab_live = false
		end,
	}
end

review.open({ cwd = "/repo", branch = "review" }, lifecycle_adapter)
review.attach(903, lifecycle_adapter)
current_buffer = 904
review.attach_if_review(904, lifecycle_adapter)
review.close(lifecycle_adapter)
t.eq(11, closed_review_tab)
t.eq(2, lifecycle_restores, "leader-pq must restore LazyGit even when the source PR buffer remains valid")

local repo_system_calls = {}
local repo_picker_calls = {}
local repo_loaded_prs = {}
local repo_restores = 0
local repo_buffer_live = false
local repo_adapter = {
	root = function(path)
		if path ~= nil then
			t.eq("/selected/repo", path)
		end
		return "/canonical/selected/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			repo_restores = repo_restores + 1
		end,
	},
	system = function(argv, opts, callback)
		repo_system_calls[#repo_system_calls + 1] = { argv = argv, cwd = opts.cwd }
		if argv[2] == "pr" and argv[3] == "view" then
			callback({
				code = 0,
				stdout = '{"number":42,"url":"https://github.com/selected/repo/pull/42"}',
				stderr = "",
			})
		elseif argv[2] == "repo" then
			callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo"}', stderr = "" })
		else
			callback({
				code = 0,
				stdout = '[{"number":42,"title":"Selected PR","url":"https://github.com/selected/repo/pull/42","state":"OPEN","isDraft":false,"headRefName":"feature"}]',
				stderr = "",
			})
		end
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function() end,
	load_pr = function(target, cwd, callback)
		repo_loaded_prs[#repo_loaded_prs + 1] = target
		complete_pr_load(target, cwd, callback)
	end,
	create_pr = function()
		repo_buffer_live = true
		return 1001
	end,
	pick_prs = function(repo, pull_requests)
		repo_picker_calls[#repo_picker_calls + 1] = { repo = repo, pull_requests = pull_requests }
		repo_buffer_live = true
		return 1001
	end,
	notify = function(message)
		error(message)
	end,
	current_buffer = function()
		return 1001
	end,
	buffer_valid = function(target)
		return target == 1001 and repo_buffer_live
	end,
	delete_buffer = function(target)
		t.eq(1001, target)
		repo_buffer_live = false
	end,
	register_cleanup = function() end,
}

review.open({ cwd = "/selected/repo", branch = "feature" }, repo_adapter)
t.eq({
	argv = { "gh", "pr", "view", "feature", "--json", "number,url" },
	cwd = "/canonical/selected/repo",
}, repo_system_calls[1], "the selected canonical repository must own the PR lookup")
t.eq("https://github.com/selected/repo/pull/42", repo_loaded_prs[1].url)

repo_system_calls = {}
review.list(repo_adapter)
t.eq({
	argv = { "gh", "repo", "view", "--json", "nameWithOwner" },
	cwd = "/canonical/selected/repo",
}, repo_system_calls[1], "the PR list repository must be resolved from the canonical cwd")
t.eq({
	argv = {
		"gh",
		"pr",
		"list",
		"--repo",
		"selected/repo",
		"--state",
		"open",
		"--limit",
		"100",
		"--json",
		"number,title,url,state,isDraft,headRefName",
	},
	cwd = "/canonical/selected/repo",
}, repo_system_calls[2], "the PR list request must preserve argv boundaries in the canonical repository")
t.eq("selected/repo", repo_picker_calls[1].repo)
t.eq(42, repo_picker_calls[1].pull_requests[1].number)
t.eq(0, repo_restores)

local repo_notifications = {}
repo_adapter.notify = function(message)
	repo_notifications[#repo_notifications + 1] = message
end
repo_adapter.system = function()
	error("spawn failed")
end
review.list(repo_adapter)
t.eq(1, repo_restores, "a synchronous repository lookup failure must restore LazyGit")

repo_adapter.system = function(_, _, callback)
	callback({ code = 1, stdout = "", stderr = "repository unavailable" })
end
review.list(repo_adapter)
t.eq(2, repo_restores, "an asynchronous repository lookup failure must restore LazyGit")
t.truthy(repo_notifications[#repo_notifications]:find("repository unavailable", 1, true))

repo_adapter.system = function(_, _, callback)
	callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo;Octo issue list"}', stderr = "" })
end
review.list(repo_adapter)
t.eq(3, repo_restores, "an unsafe repository identity must restore LazyGit")

repo_adapter.system = function(_, _, callback)
	if not repo_adapter._repo_resolved then
		repo_adapter._repo_resolved = true
		callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo"}', stderr = "" })
	else
		callback({
			code = 0,
			stdout = '[{"number":42,"title":"Selected PR","url":"https://github.com/selected/repo/pull/42","state":"OPEN","isDraft":false,"headRefName":"feature"}]',
			stderr = "",
		})
	end
end
repo_adapter.pick_prs = function()
	error("Octo failed")
end
review.list(repo_adapter)
t.eq(4, repo_restores, "an Octo list failure must restore LazyGit")

local tab = 21
local live_tabs = { [21] = true, [22] = true }
local closed_tabs = {}
local multi_tab_restores = 0
local multi_tab_maps = {}
local multi_tab_adapter = {
	root = function()
		return "/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			multi_tab_restores = multi_tab_restores + 1
		end,
	},
	system = function(_, _, callback)
		callback({
			code = 0,
			stdout = '{"number":51,"url":"https://github.com/selected/repo/pull/51"}',
			stderr = "",
		})
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function() end,
	command = function() end,
	load_pr = complete_pr_load,
	create_pr = function()
		return tab == 21 and 921 or 922
	end,
	notify = function(message)
		error(message)
	end,
	set_keymap = function(mode, lhs, rhs)
		multi_tab_maps[mode .. lhs] = rhs
	end,
	register_cleanup = function() end,
	buffer_valid = function()
		return true
	end,
	buffer_filetype = function()
		return "diff"
	end,
	delete_buffer = function() end,
	current_buffer = function()
		return tab == 21 and 921 or 922
	end,
	current_tab = function()
		return tab
	end,
	tab_valid = function(target)
		return live_tabs[target] == true
	end,
	reviews = function()
		return {
			get_current_review = function()
				return {}
			end,
			close = function(target)
				closed_tabs[#closed_tabs + 1] = target
				live_tabs[target] = false
			end,
		}
	end,
}

review.open({ cwd = "/repo", branch = "multi-tab" }, multi_tab_adapter)
review.attach_if_review(921, multi_tab_adapter)
tab = 22
review.attach_if_review(922, multi_tab_adapter)
tab = 21
multi_tab_maps["n<leader>pq"]()
table.sort(closed_tabs)
t.eq({ 21, 22 }, closed_tabs, "leader-pq must close every review tab in its PR session")
t.eq(1, multi_tab_restores, "LazyGit must be restored only after the whole PR session closes")

local silent_tab_live = true
local silent_close_succeeds = false
local silent_close_attempts = 0
local silent_direct_close_attempts = 0
local silent_restores = 0
local silent_map
local silent_adapter = vim.tbl_extend("force", multi_tab_adapter, {
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			silent_restores = silent_restores + 1
		end,
	},
	notify = function() end,
	set_keymap = function(mode, lhs, rhs)
		if mode == "n" and lhs == "<leader>pq" then
			silent_map = rhs
		end
	end,
	current_buffer = function()
		return 931
	end,
	current_tab = function()
		return 31
	end,
	tab_valid = function(target)
		return target == 31 and silent_tab_live
	end,
	close_tab = function(target)
		t.eq(31, target)
		silent_direct_close_attempts = silent_direct_close_attempts + 1
		if silent_close_succeeds then
			silent_tab_live = false
		end
	end,
	reviews = function()
		return {
			get_current_review = function()
				return {}
			end,
			close = function()
				silent_close_attempts = silent_close_attempts + 1
			end,
		}
	end,
})

review.open({ cwd = "/repo", branch = "silent-close" }, silent_adapter)
review.attach_if_review(931, silent_adapter)
silent_map()
t.eq(0, silent_restores, "a live review tab must remain tracked when Octo silently fails to close it")
silent_close_succeeds = true
silent_map()
t.eq(1, silent_close_attempts, "Octo must not be retried after it discarded the review state")
t.eq(1, silent_direct_close_attempts, "leader-pq must directly retry the tab that stayed live")
t.eq(1, silent_restores)

local reused_cleanups = {}
local reused_buffer_live = false
local reused_adapter = {
	root = function()
		return "/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function() end,
	},
	system = function(_, _, callback)
		callback({
			code = 0,
			stdout = '{"number":61,"url":"https://github.com/selected/repo/pull/61"}',
			stderr = "",
		})
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function() end,
	command = function() end,
	load_pr = complete_pr_load,
	create_pr = function()
		reused_buffer_live = true
		return 930
	end,
	notify = function(message)
		error(message)
	end,
	set_keymap = function() end,
	register_cleanup = function(_, callback)
		reused_cleanups[#reused_cleanups + 1] = callback
	end,
	buffer_valid = function()
		return reused_buffer_live
	end,
	delete_buffer = function()
		reused_buffer_live = false
	end,
	buffer_filetype = function()
		return "octo"
	end,
}

review.open({ cwd = "/repo", branch = "old" }, reused_adapter)
review.attach(930, reused_adapter)
review.open({ cwd = "/repo", branch = "new" }, reused_adapter)
review.attach(930, reused_adapter)
t.eq(4, #reused_cleanups)
reused_cleanups[1]()
reused_cleanups[2]()
review.attach(930, reused_adapter)
t.eq(4, #reused_cleanups, "stale cleanup must not clear a reused buffer's current-generation marker")

local retry_map
local delete_attempts = 0
local delete_fails = true
local retry_restores = 0
local retry_adapter = {
	root = function()
		return "/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			retry_restores = retry_restores + 1
		end,
	},
	system = reused_adapter.system,
	schedule = reused_adapter.schedule,
	defer = reused_adapter.defer,
	command = reused_adapter.command,
	load_pr = complete_pr_load,
	create_pr = function()
		return 940
	end,
	notify = function() end,
	set_keymap = function(mode, lhs, rhs)
		if mode == "n" and lhs == "<leader>pq" then
			retry_map = rhs
		end
	end,
	register_cleanup = function() end,
	buffer_valid = function()
		return true
	end,
	buffer_filetype = function()
		return "octo"
	end,
	reviews = function()
		return {
			get_current_review = function()
				return nil
			end,
		}
	end,
	delete_buffer = function()
		delete_attempts = delete_attempts + 1
		if delete_fails then
			error("delete failed")
		end
	end,
}

review.open({ cwd = "/repo", branch = "retry-close" }, retry_adapter)
review.attach(940, retry_adapter)
retry_map()
t.eq(0, retry_restores, "LazyGit must stay hidden while a PR surface failed to close")
delete_fails = false
retry_map()
t.eq(2, delete_attempts, "leader-pq must retry a PR surface that failed to close")
t.eq(1, retry_restores)

local async_mode
local async_late_list_callback
local async_picker_callbacks
local async_selected_pr_callback
local async_next_buffer = 1100
local async_buffers = {}
local async_cleanups = {}
local async_deferred = {}
local async_restores = 0
local function create_async_buffer(name, filetype, ready)
	async_next_buffer = async_next_buffer + 1
	local buffer = async_next_buffer
	async_buffers[buffer] = {
		live = true,
		name = name,
		filetype = filetype,
		ready = ready == true,
	}
	return buffer
end
local function run_async_deferred(limit)
	for _ = 1, limit do
		local callback = table.remove(async_deferred, 1)
		if not callback then
			return
		end
		callback()
	end
end
local function wipe_async_buffer(buffer)
	async_buffers[buffer].live = false
	for _, callback in ipairs(async_cleanups[buffer] or {}) do
		callback()
	end
end
local async_adapter = {
	root = function()
		return "/canonical/selected/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			async_restores = async_restores + 1
		end,
	},
	system = function(argv, _, callback)
		if argv[2] == "pr" and argv[3] == "view" then
			callback({
				code = 0,
				stdout = '{"number":71,"url":"https://github.com/selected/repo/pull/71"}',
				stderr = "",
			})
		elseif argv[2] == "repo" then
			callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo"}', stderr = "" })
		elseif async_mode == "stale-old" then
			async_late_list_callback = callback
		elseif async_mode == "list-empty" then
			callback({ code = 0, stdout = "[]", stderr = "" })
		else
			callback({
				code = 0,
				stdout = '[{"number":71,"title":"Async PR","url":"https://github.com/selected/repo/pull/71","state":"OPEN","isDraft":false,"headRefName":"async"}]',
				stderr = "",
			})
		end
		return { kill = function() end }
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function(callback)
		async_deferred[#async_deferred + 1] = callback
	end,
	load_pr = function(target, _, callback)
		if async_mode == "open-failure" or async_mode == "list-transition" then
			async_selected_pr_callback = callback
		else
			callback({
				code = 0,
				stdout = vim.json.encode({
					data = {
						repository = {
							pullRequest = {
								id = "PR_" .. target.number,
								number = target.number,
								url = target.url,
								timelineItems = { nodes = {} },
							},
						},
					},
				}),
				stderr = "",
			})
		end
		return { kill = function() end }
	end,
	create_pr = function(target)
		return create_async_buffer("octo://" .. target.repo .. "/pull/" .. target.number, "octo", true)
	end,
	notify = function() end,
	current_buffer = function()
		return 1
	end,
	buffer_valid = function(buffer)
		return async_buffers[buffer] and async_buffers[buffer].live == true
	end,
	buffer_filetype = function(buffer)
		return async_buffers[buffer] and async_buffers[buffer].filetype or ""
	end,
	register_cleanup = function(buffer, callback)
		async_cleanups[buffer] = async_cleanups[buffer] or {}
		async_cleanups[buffer][#async_cleanups[buffer] + 1] = callback
	end,
	pick_prs = function(_, _, callbacks)
		async_picker_callbacks = callbacks
		return create_async_buffer("TelescopePrompt", "TelescopePrompt", true)
	end,
	delete_buffer = function(buffer)
		wipe_async_buffer(buffer)
	end,
}

async_mode = "open-failure"
review.open({ cwd = "/repo", branch = "async-failure" }, async_adapter)
run_async_deferred(10)
t.eq(1, async_restores, "an Octo URL load that never creates a ready surface must restore LazyGit")

async_mode = "open-success"
review.open({ cwd = "/repo", branch = "async-success" }, async_adapter)
local open_surface = async_next_buffer
t.eq(1, async_restores, "a ready Octo PR surface must keep LazyGit hidden")
wipe_async_buffer(open_surface)
run_async_deferred(10)
t.eq(2, async_restores, "closing the ready Octo PR surface must restore LazyGit")

async_mode = "list-empty"
review.list(async_adapter)
run_async_deferred(10)
t.eq(3, async_restores, "an empty or failed async PR list must restore LazyGit")

async_mode = "list-picker"
review.list(async_adapter)
local picker_surface = async_next_buffer
run_async_deferred(1)
t.eq(3, async_restores, "a live PR picker must keep LazyGit hidden")
wipe_async_buffer(picker_surface)
run_async_deferred(10)
t.eq(4, async_restores, "canceling the PR picker must restore LazyGit")

async_mode = "stale-old"
review.list(async_adapter)
async_mode = "stale-new"
review.open({ cwd = "/repo", branch = "new-session" }, async_adapter)
local new_surface = async_next_buffer
async_buffers[new_surface].ready = true
async_late_list_callback({
	code = 0,
	stdout = '[{"number":71,"title":"Stale PR","url":"https://github.com/selected/repo/pull/71","state":"OPEN","isDraft":false,"headRefName":"stale"}]',
	stderr = "",
})
run_async_deferred(10)
t.eq(4, async_restores, "an old async callback must not restore over a new PR surface")
wipe_async_buffer(new_surface)
run_async_deferred(10)
t.eq(5, async_restores)

async_mode = "list-unrelated"
review.list(async_adapter)
local unrelated_picker = create_async_buffer("TelescopePrompt", "TelescopePrompt", true)
run_async_deferred(1)
review.close(async_adapter)
t.eq(true, async_buffers[unrelated_picker].live, "a non-Octo picker must not be owned or deleted by the PR session")

async_mode = "list-transition"
local transition_restores = async_restores
review.list(async_adapter)
local transition_picker = async_next_buffer
async_picker_callbacks.transition()
wipe_async_buffer(transition_picker)
async_picker_callbacks.select({
	__typename = "PullRequest",
	number = 71,
	title = "Async PR",
	url = "https://github.com/selected/repo/pull/71",
	state = "OPEN",
	isDraft = false,
	headRefName = "async",
	repository = { nameWithOwner = "selected/repo" },
})
run_async_deferred(1)
t.eq(transition_restores, async_restores, "picker selection must keep the PR session pending after prompt wipe")
async_selected_pr_callback({
	code = 0,
	stdout = '{"data":{"repository":{"pullRequest":{"id":"PR_71","number":71,"url":"https://github.com/selected/repo/pull/71","timelineItems":{"nodes":[]}}}}}',
	stderr = "",
})
local transition_surface = async_next_buffer
t.eq(transition_restores, async_restores, "a delayed provisional PR surface must replace the picker session")
wipe_async_buffer(transition_surface)
run_async_deferred(10)
t.eq(transition_restores + 1, async_restores, "the selected PR session must restore only after its surface closes")

local late_request_callback
local late_request_cancelled = false
local late_picker_calls = 0
local late_request_deferred = {}
local late_request_restores = 0
local late_request_adapter = {
	root = function()
		return "/canonical/selected/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			late_request_restores = late_request_restores + 1
		end,
	},
	system = function(argv, opts, callback)
		t.eq("/canonical/selected/repo", opts.cwd)
		if argv[2] == "repo" then
			callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo"}', stderr = "" })
			return
		end
		t.eq({
			"gh",
			"pr",
			"list",
			"--repo",
			"selected/repo",
			"--state",
			"open",
			"--limit",
			"100",
			"--json",
			"number,title,url,state,isDraft,headRefName",
		}, argv)
		late_request_callback = callback
		return {
			kill = function()
				late_request_cancelled = true
			end,
		}
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function(callback)
		late_request_deferred[#late_request_deferred + 1] = callback
	end,
	request_timeout_ms = 1,
	pick_prs = function()
		late_picker_calls = late_picker_calls + 1
	end,
	notify = function() end,
}

review.list(late_request_adapter)
t.truthy(late_request_callback, "the PR list request must expose its completion callback")
for _, callback in ipairs(late_request_deferred) do
	callback()
end
t.eq(true, late_request_cancelled, "a timed-out PR list request must be cancelled")
t.eq(1, late_request_restores)
late_request_callback({
	code = 0,
	stdout = '[{"number":72,"title":"Late PR","url":"https://github.com/selected/repo/pull/72","state":"OPEN","isDraft":false,"headRefName":"late"}]',
	stderr = "",
})
t.eq(0, late_picker_calls, "a late request callback must not create a picker after LazyGit is restored")

local late_pr_callback
local late_pr_cancelled = false
local late_pr_created = 0
local late_pr_deferred = {}
local late_pr_restores = 0
local late_pr_adapter = {
	root = function()
		return "/canonical/selected/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			late_pr_restores = late_pr_restores + 1
		end,
	},
	system = function(_, _, callback)
		callback({
			code = 0,
			stdout = '{"number":73,"url":"https://github.com/selected/repo/pull/73"}',
			stderr = "",
		})
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function(callback)
		late_pr_deferred[#late_pr_deferred + 1] = callback
	end,
	request_timeout_ms = 1,
	load_pr = function(target, cwd, callback)
		t.eq(73, target.number)
		t.eq("selected/repo", target.repo)
		t.eq("/canonical/selected/repo", cwd)
		late_pr_callback = callback
		return {
			kill = function()
				late_pr_cancelled = true
			end,
		}
	end,
	create_pr = function()
		late_pr_created = late_pr_created + 1
		return 1201
	end,
	cancel_request = function(request)
		request:kill()
	end,
	notify = function() end,
}

review.open({ cwd = "/repo", branch = "late-pr" }, late_pr_adapter)
t.truthy(late_pr_callback, "the Octo PR data load must expose its completion callback")
for _, callback in ipairs(late_pr_deferred) do
	callback()
end
t.eq(true, late_pr_cancelled, "a timed-out Octo PR data load must be cancelled")
t.eq(1, late_pr_restores)
late_pr_callback({
	code = 0,
	stdout = '{"data":{"repository":{"pullRequest":{"id":"PR_73","number":73,"url":"https://github.com/selected/repo/pull/73","timelineItems":{"nodes":[]}}}}}',
	stderr = "",
})
t.eq(0, late_pr_created, "a late PR load must not create an Octo surface after LazyGit is restored")

local metadata_open_callbacks = {}
local metadata_open_cancelled = {}
local metadata_open_deferred = {}
local metadata_open_restores = 0
local metadata_open_loads = 0
local metadata_open_adapter = {
	root = function()
		return "/canonical/selected/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			metadata_open_restores = metadata_open_restores + 1
		end,
	},
	system = function(argv, opts, callback)
		t.eq("/canonical/selected/repo", opts.cwd)
		t.eq("view", argv[3])
		local request = #metadata_open_callbacks + 1
		metadata_open_callbacks[request] = callback
		return {
			kill = function()
				metadata_open_cancelled[request] = true
			end,
		}
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function(callback)
		metadata_open_deferred[#metadata_open_deferred + 1] = callback
	end,
	request_timeout_ms = 1,
	load_pr = function()
		metadata_open_loads = metadata_open_loads + 1
	end,
	notify = function() end,
}

review.open({ cwd = "/repo", branch = "old-metadata" }, metadata_open_adapter)
review.open({ cwd = "/repo", branch = "replacement-metadata" }, metadata_open_adapter)
t.eq(true, metadata_open_cancelled[1], "a replacement PR session must cancel the old metadata request")
metadata_open_deferred[1]()
metadata_open_callbacks[1]({
	code = 0,
	stdout = '{"number":81,"url":"https://github.com/selected/repo/pull/81"}',
	stderr = "",
})
t.eq(0, metadata_open_restores, "an old metadata timeout must not restore over a replacement PR session")
t.eq(0, metadata_open_loads, "a late old metadata callback must not start an Octo request")
metadata_open_deferred[2]()
t.eq(true, metadata_open_cancelled[2], "a timed-out PR metadata request must be cancelled")
t.eq(1, metadata_open_restores, "a timed-out PR metadata request must restore LazyGit")
metadata_open_callbacks[2]({
	code = 0,
	stdout = '{"number":82,"url":"https://github.com/selected/repo/pull/82"}',
	stderr = "",
})
t.eq(0, metadata_open_loads, "late metadata must not open Octo after LazyGit is restored")

local metadata_list_callback
local metadata_list_cancelled = false
local metadata_list_deferred = {}
local metadata_list_restores = 0
local metadata_list_system_calls = 0
local metadata_list_picker_calls = 0
local metadata_list_adapter = {
	root = function()
		return "/canonical/selected/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			metadata_list_restores = metadata_list_restores + 1
		end,
	},
	system = function(argv, opts, callback)
		metadata_list_system_calls = metadata_list_system_calls + 1
		t.eq({ "gh", "repo", "view", "--json", "nameWithOwner" }, argv)
		t.eq("/canonical/selected/repo", opts.cwd)
		metadata_list_callback = callback
		return {
			kill = function()
				metadata_list_cancelled = true
			end,
		}
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function(callback)
		metadata_list_deferred[#metadata_list_deferred + 1] = callback
	end,
	request_timeout_ms = 1,
	pick_prs = function()
		metadata_list_picker_calls = metadata_list_picker_calls + 1
	end,
	notify = function() end,
}

review.list(metadata_list_adapter)
t.truthy(metadata_list_callback, "the repository metadata request must expose its completion callback")
metadata_list_deferred[1]()
t.eq(true, metadata_list_cancelled, "a timed-out repository metadata request must be cancelled")
t.eq(1, metadata_list_restores, "a timed-out repository metadata request must restore LazyGit")
metadata_list_callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo"}', stderr = "" })
t.eq(1, metadata_list_system_calls, "late repository metadata must not start the PR list request")
t.eq(0, metadata_list_picker_calls, "late repository metadata must not create an Octo picker")

local unloaded_octo_picker = 1301
local unloaded_octo_live = true
local unloaded_octo_restores = 0
local unloaded_octo_adapter = {
	root = function()
		return "/canonical/selected/repo"
	end,
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			unloaded_octo_restores = unloaded_octo_restores + 1
		end,
	},
	system = function(argv, _, callback)
		if argv[2] == "repo" then
			callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo"}', stderr = "" })
		else
			callback({
				code = 0,
				stdout = '[{"number":91,"title":"Unloaded Octo","url":"https://github.com/selected/repo/pull/91","state":"OPEN","isDraft":false,"headRefName":"unloaded"}]',
				stderr = "",
			})
		end
		return { kill = function() end }
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function() end,
	pick_prs = function()
		t.eq(1, default_octo_loads, "the terminal-local list path must load Octo before creating its picker")
		return unloaded_octo_picker
	end,
	buffer_valid = function(buffer)
		return buffer == unloaded_octo_picker and unloaded_octo_live
	end,
	register_cleanup = function() end,
	delete_buffer = function(buffer)
		t.eq(unloaded_octo_picker, buffer)
		unloaded_octo_live = false
	end,
	reviews = function()
		return { get_current_review = function() end }
	end,
	notify = function(message)
		error(message)
	end,
}

default_octo_loads = 0
review.list(unloaded_octo_adapter)
t.eq(1, default_octo_loads, "list must explicitly load Octo without lazy.nvim's key handler")
review.close(unloaded_octo_adapter)
t.eq(1, unloaded_octo_restores)

local failed_octo_system_calls = 0
local failed_octo_notifications = {}
local failed_octo_restores = 0
local failed_octo_adapter = vim.tbl_extend("force", unloaded_octo_adapter, {
	dock = {
		prepare = function() end,
		activate = function() end,
		deactivate = function()
			failed_octo_restores = failed_octo_restores + 1
		end,
	},
	load_octo = function()
		error("Octo unavailable")
	end,
	system = function()
		failed_octo_system_calls = failed_octo_system_calls + 1
	end,
	notify = function(message)
		failed_octo_notifications[#failed_octo_notifications + 1] = message
	end,
})

review.list(failed_octo_adapter)
t.eq(0, failed_octo_system_calls, "a failed Octo load must not start repository requests")
t.eq(1, failed_octo_restores, "a failed Octo load must restore LazyGit")
t.truthy(failed_octo_notifications[1]:find("Octo", 1, true))

local transition_next_buffer = 1400
local transition_live_buffers = {}
local transition_filetypes = {}
local transition_cleanups = {}
local transition_deferred = {}
local transition_maps = {}
local transition_events = {}
local transition_picker_callbacks
local transition_review = nil
local transition_tabs = {}
local transition_current_tab = 41
local transition_delete_failure = false
local transition_notifications = {}
local transition_system_calls = 0
local function create_transition_buffer(filetype)
	transition_next_buffer = transition_next_buffer + 1
	transition_live_buffers[transition_next_buffer] = true
	transition_filetypes[transition_next_buffer] = filetype
	return transition_next_buffer
end
local function run_transition_deferred()
	while #transition_deferred > 0 do
		table.remove(transition_deferred, 1)()
	end
end
local function transition_has_event(event)
	return vim.tbl_contains(transition_events, event)
end
local transition_adapter = {
	root = function()
		return "/canonical/selected/repo"
	end,
	dock = {
		prepare = function()
			transition_events[#transition_events + 1] = "prepare"
		end,
		activate = function()
			transition_events[#transition_events + 1] = "activate"
		end,
		deactivate = function()
			transition_events[#transition_events + 1] = "deactivate"
		end,
	},
	load_octo = function() end,
	system = function(argv, _, callback)
		transition_system_calls = transition_system_calls + 1
		if argv[2] == "repo" then
			callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo"}', stderr = "" })
		elseif argv[3] == "list" then
			callback({
				code = 0,
				stdout = '[{"number":102,"title":"Next PR","url":"https://github.com/selected/repo/pull/102","state":"OPEN","isDraft":false,"headRefName":"next"}]',
				stderr = "",
			})
		else
			local number = argv[4] == "third" and 103 or 101
			callback({
				code = 0,
				stdout = ('{"number":%d,"url":"https://github.com/selected/repo/pull/%d"}'):format(number, number),
				stderr = "",
			})
		end
		return { kill = function() end }
	end,
	schedule = function(callback)
		callback()
	end,
	defer = function(callback)
		transition_deferred[#transition_deferred + 1] = callback
	end,
	load_pr = function(target, _, callback)
		callback({
			code = 0,
			stdout = vim.json.encode({
				data = {
					repository = {
						pullRequest = {
							id = "PR_" .. target.number,
							number = target.number,
							url = target.url,
							timelineItems = { nodes = {} },
						},
					},
				},
			}),
			stderr = "",
		})
		return { kill = function() end }
	end,
	create_pr = function()
		return create_transition_buffer("octo")
	end,
	pick_prs = function(_, _, callbacks)
		transition_picker_callbacks = callbacks
		return create_transition_buffer("TelescopePrompt")
	end,
	buffer_valid = function(buffer)
		return transition_live_buffers[buffer] == true
	end,
	buffer_filetype = function(buffer)
		return transition_filetypes[buffer] or ""
	end,
	register_cleanup = function(buffer, callback)
		transition_cleanups[buffer] = transition_cleanups[buffer] or {}
		transition_cleanups[buffer][#transition_cleanups[buffer] + 1] = callback
	end,
	delete_buffer = function(buffer)
		transition_events[#transition_events + 1] = "delete:" .. buffer
		if transition_delete_failure then
			error("buffer delete failed")
		end
		transition_live_buffers[buffer] = false
		for _, callback in ipairs(transition_cleanups[buffer] or {}) do
			callback()
		end
	end,
	set_keymap = function(mode, lhs, rhs, opts)
		transition_maps[opts.buffer] = transition_maps[opts.buffer] or {}
		transition_maps[opts.buffer][mode .. lhs] = rhs
	end,
	current_buffer = function()
		return transition_next_buffer
	end,
	current_tab = function()
		return transition_current_tab
	end,
	tab_valid = function(tab)
		return transition_tabs[tab] == true
	end,
	close_tab = function(tab)
		transition_tabs[tab] = false
	end,
	reviews = function()
		return {
			get_current_review = function()
				return transition_review
			end,
			close = function(tab)
				transition_tabs[tab] = false
				transition_review = nil
			end,
			add_review_comment = function() end,
			submit_review = function() end,
			discard_review = function() end,
		}
	end,
	notify = function(message)
		transition_notifications[#transition_notifications + 1] = message
	end,
}

review.open({ cwd = "/repo", branch = "first" }, transition_adapter)
local first_pr_surface = transition_next_buffer
review.attach(first_pr_surface, transition_adapter)
local first_pr_close = transition_maps[first_pr_surface]["n<leader>pq"]
transition_events = {}
review.list(transition_adapter)
local next_pr_picker = transition_next_buffer
t.eq(false, transition_live_buffers[first_pr_surface], "starting a PR list must retire the previous PR surface")
t.eq(true, transition_live_buffers[next_pr_picker], "the replacement generation must own its exact picker")
run_transition_deferred()
t.eq(false, transition_has_event("deactivate"), "a successful PR session transition must not flash LazyGit")
first_pr_close()
t.eq(true, transition_live_buffers[next_pr_picker], "an old PR keymap must not close the replacement picker")

transition_picker_callbacks.transition()
transition_adapter.delete_buffer(next_pr_picker)
transition_picker_callbacks.select({
	__typename = "PullRequest",
	number = 102,
	title = "Next PR",
	url = "https://github.com/selected/repo/pull/102",
	state = "OPEN",
	isDraft = false,
	headRefName = "next",
	repository = { nameWithOwner = "selected/repo" },
})
local next_pr_surface = transition_next_buffer
run_transition_deferred()
t.eq(true, transition_live_buffers[next_pr_surface], "the selected PR must replace its picker in one generation")
t.eq(false, transition_has_event("deactivate"), "picker selection must not restore LazyGit between surfaces")

transition_review = {}
transition_tabs[transition_current_tab] = true
review.attach_if_review(next_pr_surface, transition_adapter)
local review_close = transition_maps[next_pr_surface]["n<leader>pq"]
review.open({ cwd = "/repo", branch = "third" }, transition_adapter)
local third_pr_surface = transition_next_buffer
t.eq(false, transition_tabs[transition_current_tab], "a replacement PR session must close the old review tab")
t.eq(false, transition_live_buffers[next_pr_surface], "a reviewed PR surface must retire with its review tab")
t.eq(true, transition_live_buffers[third_pr_surface])
review_close()
t.eq(true, transition_live_buffers[third_pr_surface], "an old review keymap must not close the new PR generation")
run_transition_deferred()
t.eq(false, transition_has_event("deactivate"), "review-to-PR transition must keep LazyGit hidden")
review.close(transition_adapter)
run_transition_deferred()
t.eq(true, transition_has_event("deactivate"), "closing the final PR generation must restore LazyGit")

transition_events = {}
review.open({ cwd = "/repo", branch = "first" }, transition_adapter)
local retry_surface = transition_next_buffer
local system_calls_before_failed_transition = transition_system_calls
transition_delete_failure = true
review.list(transition_adapter)
t.eq(true, transition_live_buffers[retry_surface], "a failed cleanup must keep the old PR surface tracked")
t.eq(
	system_calls_before_failed_transition,
	transition_system_calls,
	"a failed cleanup must abort before starting replacement repository requests"
)
t.eq(false, transition_has_event("deactivate"), "a failed cleanup must not restore or overlap LazyGit")
transition_delete_failure = false
review.list(transition_adapter)
local retry_picker = transition_next_buffer
t.eq(false, transition_live_buffers[retry_surface], "a later transition must retry the old surface cleanup")
t.eq(true, transition_live_buffers[retry_picker], "the replacement picker may open only after cleanup succeeds")
review.close(transition_adapter)
run_transition_deferred()

package.loaded["lazy"] = previous_lazy_loaded
package.preload["lazy"] = previous_lazy_preload
package.loaded["octo"] = previous_octo_loaded
package.preload["octo"] = previous_octo_preload
package.loaded["octo.reviews"] = previous_octo_reviews_loaded
package.preload["octo.reviews"] = previous_octo_reviews_preload
