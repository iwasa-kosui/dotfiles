local t = require("testlib")
local review = require("user.pr_review")

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
local commands = {}
local notifications = {}
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
  observe_surface = function() end,
  command = function(command)
    commands[#commands + 1] = command
  end,
  notify = function(message)
    notifications[#notifications + 1] = message
  end,
}

review.open({ cwd = "/repo path/.wt/feature", branch = branch }, adapter)
t.eq({ "prepare:pr", "activate:pr" }, calls)
t.eq({ { cmd = "Octo", args = { "https://github.com/selected/repo/pull/133" } } }, commands)

commands = {}
adapter.system = function(argv, _, callback)
  t.eq({ "gh", "pr", "view", branch, "--json", "number,url" }, argv)
  callback({ code = 1, stdout = "", stderr = "no pull requests found" })
end
review.open({ cwd = "/repo path/.wt/feature", branch = branch }, adapter)
t.eq(1, restored, "missing PR must restore LazyGit")
t.eq({}, commands, "failed gh output must never reach Octo")
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
t.eq({}, commands, "invalid PR numbers must never be interpolated into an Octo command")

local current_branch_argv
adapter.system = function(argv, _, callback)
  current_branch_argv = argv
  callback({ code = 0, stdout = '{"number":7,"url":"https://github.com/selected/repo/pull/7"}', stderr = "" })
end
review.open({ cwd = "/repo path/.wt/feature", branch = "" }, adapter)
t.eq({ "gh", "pr", "view", "--json", "number,url" }, current_branch_argv)
t.eq({ { cmd = "Octo", args = { "https://github.com/selected/repo/pull/7" } } }, commands)

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
  observe_surface = function() end,
  command = function() end,
  notify = function(message)
    error(message)
  end,
  set_keymap = function() end,
  register_cleanup = function(target, callback)
    cleanups[target] = callback
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
cleanups[901]()

current_buffer = 902
review.open({ cwd = "/repo", branch = "second" }, lifecycle_adapter)
review.attach(902, lifecycle_adapter)
live[902] = false
cleanups[902]()

cleanups[901]()
for _, callback in ipairs(deferred) do
  callback()
end
t.eq(1, lifecycle_restores, "a stale cleanup must not cancel restoration for the current PR session")

cleanups[902]()
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

local repo_commands = {}
local repo_system_calls = {}
local repo_restores = 0
local list_context_cwd
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
    if argv[2] == "pr" then
      callback({
        code = 0,
        stdout = '{"number":42,"url":"https://github.com/selected/repo/pull/42"}',
        stderr = "",
      })
    else
      callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo"}', stderr = "" })
    end
  end,
  schedule = function(callback)
    callback()
  end,
  defer = function() end,
  command = function(command)
    repo_commands[#repo_commands + 1] = command
  end,
  with_cwd = function(cwd, callback)
    list_context_cwd = cwd
    callback()
  end,
  notify = function(message)
    error(message)
  end,
  current_buffer = function()
    return 1001
  end,
  buffer_valid = function()
    return false
  end,
}

review.open({ cwd = "/selected/repo", branch = "feature" }, repo_adapter)
t.eq({
  argv = { "gh", "pr", "view", "feature", "--json", "number,url" },
  cwd = "/canonical/selected/repo",
}, repo_system_calls[1], "the selected canonical repository must own the PR lookup")
t.eq({ cmd = "Octo", args = { "https://github.com/selected/repo/pull/42" } }, repo_commands[1])

repo_commands = {}
repo_system_calls = {}
review.list(repo_adapter)
t.eq({
  argv = { "gh", "repo", "view", "--json", "nameWithOwner" },
  cwd = "/canonical/selected/repo",
}, repo_system_calls[1], "the PR list repository must be resolved from the canonical cwd")
t.eq("/canonical/selected/repo", list_context_cwd, "Octo must resolve the selected repository host from canonical cwd")
t.eq({ cmd = "Octo", args = { "pr", "list", "selected/repo" } }, repo_commands[1])
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
  callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo"}', stderr = "" })
end
repo_adapter.command = function()
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
  notify = function(message)
    error(message)
  end,
  set_keymap = function() end,
  register_cleanup = function(_, callback)
    reused_cleanups[#reused_cleanups + 1] = callback
  end,
  buffer_valid = function()
    return true
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
local async_next_buffer = 1100
local async_buffers = {}
local async_cleanups = {}
local async_deferred = {}
local async_restores = 0
local function create_async_buffer(name, filetype, ready)
  async_next_buffer = async_next_buffer + 1
  local buffer = async_next_buffer
  async_buffers[buffer] = { live = true, name = name, filetype = filetype, ready = ready == true }
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
    if argv[2] == "pr" then
      callback({
        code = 0,
        stdout = '{"number":71,"url":"https://github.com/selected/repo/pull/71"}',
        stderr = "",
      })
    else
      callback({ code = 0, stdout = '{"nameWithOwner":"selected/repo"}', stderr = "" })
    end
  end,
  schedule = function(callback)
    callback()
  end,
  defer = function(callback)
    async_deferred[#async_deferred + 1] = callback
  end,
  command = function(command)
    if command.args[1]:match("^https://") then
      if async_mode == "open-failure" or async_mode == "open-success" or async_mode == "stale-new" then
        create_async_buffer("octo://selected/repo/pull/71", "", false)
      end
    end
  end,
  with_cwd = function(_, callback)
    callback()
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
  delete_buffer = function(buffer)
    wipe_async_buffer(buffer)
  end,
  capture_buffers = function()
    local captured = {}
    for buffer, state in pairs(async_buffers) do
      if state.live then
        captured[buffer] = true
      end
    end
    return captured
  end,
  find_surfaces = function(kind, baseline)
    local surfaces = {}
    for buffer, state in pairs(async_buffers) do
      if state.live and not baseline[buffer] then
        local is_open = kind == "open" and state.name:match("^octo://")
        local is_list = kind == "list" and state.filetype == "TelescopePrompt"
        if is_open or is_list then
          surfaces[#surfaces + 1] = buffer
        end
      end
    end
    return surfaces
  end,
  surface_ready = function(buffer)
    return async_buffers[buffer] and async_buffers[buffer].ready == true
  end,
  max_surface_checks = 3,
}

async_mode = "open-failure"
review.open({ cwd = "/repo", branch = "async-failure" }, async_adapter)
run_async_deferred(10)
t.eq(1, async_restores, "an Octo URL load that never creates a ready surface must restore LazyGit")

async_mode = "open-success"
review.open({ cwd = "/repo", branch = "async-success" }, async_adapter)
local open_surface = async_next_buffer
async_buffers[open_surface].ready = true
run_async_deferred(1)
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
local picker_surface = create_async_buffer("TelescopePrompt", "TelescopePrompt", true)
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
run_async_deferred(10)
t.eq(4, async_restores, "an old async callback must not restore over a new PR surface")
wipe_async_buffer(new_surface)
run_async_deferred(10)
t.eq(5, async_restores)
