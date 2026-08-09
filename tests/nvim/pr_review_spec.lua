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
    t.eq({ "gh", "pr", "view", branch, "--json", "number" }, argv)
    t.eq("/canonical/repo/.wt/feature", opts.cwd)
    callback({ code = 0, stdout = '{"number":133}', stderr = "" })
  end,
  schedule = function(callback)
    callback()
  end,
  defer = function(callback)
    callback()
  end,
  command = function(command)
    commands[#commands + 1] = command
  end,
  notify = function(message)
    notifications[#notifications + 1] = message
  end,
}

review.open({ cwd = "/repo path/.wt/feature", branch = branch }, adapter)
t.eq({ "prepare:pr", "activate:pr" }, calls)
t.eq({ "Octo pr edit 133" }, commands)

commands = {}
adapter.system = function(argv, _, callback)
  t.eq({ "gh", "pr", "view", branch, "--json", "number" }, argv)
  callback({ code = 1, stdout = "", stderr = "no pull requests found" })
end
review.open({ cwd = "/repo path/.wt/feature", branch = branch }, adapter)
t.eq(1, restored, "missing PR must restore LazyGit")
t.eq({}, commands, "failed gh output must never reach Octo")
t.truthy(notifications[#notifications]:find(branch, 1, true), "the failure must identify the selected branch")
t.truthy(notifications[#notifications]:find("no pull requests found", 1, true), "the failure must explain gh stderr")

local invalid_outputs = {
  '{"number":"1"}',
  '{"number":1.5}',
  '[{"number":1},{"number":2}]',
}
for _, stdout in ipairs(invalid_outputs) do
  adapter.system = function(_, _, callback)
    callback({ code = 0, stdout = stdout, stderr = "" })
  end
  review.open({ cwd = "/repo path/.wt/feature", branch = branch }, adapter)
end
t.eq(4, restored, "every ambiguous or invalid PR result must restore LazyGit")
t.eq({}, commands, "invalid PR numbers must never be interpolated into an Octo command")

local current_branch_argv
adapter.system = function(argv, _, callback)
  current_branch_argv = argv
  callback({ code = 0, stdout = '{"number":7}', stderr = "" })
end
review.open({ cwd = "/repo path/.wt/feature", branch = "" }, adapter)
t.eq({ "gh", "pr", "view", "--json", "number" }, current_branch_argv)
t.eq({ "Octo pr edit 7" }, commands)

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
    callback({ code = 0, stdout = '{"number":42}', stderr = "" })
  end,
  schedule = function(callback)
    callback()
  end,
  defer = function(callback)
    deferred[#deferred + 1] = callback
  end,
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
lifecycle_adapter.reviews = function()
  return {
    get_current_review = function()
      return current_review
    end,
    close = function(tab)
      closed_review_tab = tab
      current_review = nil
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
