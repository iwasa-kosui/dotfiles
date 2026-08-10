local M = {}

local attached_buffers = {}
local octo_buffers = {}
local picker_buffers = {}
local review_tabs = {}
local session
local next_generation = 0
local surface_check_tokens = {}
local retire_session

local function current_candidate()
  local candidate = vim.uv.cwd() or vim.fn.getcwd()
  local ok, lazy = pcall(require, "lazyvim.util")
  if ok then
    candidate = lazy.root.get({ normalize = true }) or candidate
  end
  return candidate
end

local function default_root(path)
  local root = require("user.worktree_root")
  local candidate = root.normalize(path or current_candidate())
  local output = vim.fn.systemlist({ "git", "-C", candidate, "rev-parse", "--show-toplevel" })
  if vim.v.shell_error ~= 0 or not output[1] or output[1] == "" then
    return nil
  end
  return root.normalize(output[1])
end

local function defaults(adapter)
  adapter = adapter or {}
  return setmetatable(adapter, {
    __index = {
      root = default_root,
      dock = require("user.dock"),
      switch_worktree = function(opts)
        require("user.worktrees").switch_to_branch(opts)
      end,
      system = vim.system,
      schedule = vim.schedule,
      defer = vim.defer_fn,
      command = vim.cmd,
      notify = function(message)
        vim.notify(message, vim.log.levels.ERROR)
      end,
      set_keymap = vim.keymap.set,
      register_cleanup = function(buffer, callback)
        vim.api.nvim_create_autocmd("BufWipeout", { buffer = buffer, once = true, callback = callback })
      end,
      reviews = function()
        return require("octo.reviews")
      end,
      current_buffer = vim.api.nvim_get_current_buf,
      current_tab = vim.api.nvim_get_current_tabpage,
      buffer_valid = vim.api.nvim_buf_is_valid,
      tab_valid = vim.api.nvim_tabpage_is_valid,
      close_tab = function(tab)
        vim.cmd.tabclose(vim.api.nvim_tabpage_get_number(tab))
      end,
      buffer_filetype = function(buffer)
        return vim.bo[buffer].filetype
      end,
      request_timeout_ms = 10000,
      cancel_request = function(request)
        if request and type(request.kill) == "function" then
          request:kill(15)
        end
      end,
      load_octo = function()
        require("lazy").load({ plugins = { "octo.nvim" } })
        return require("octo")
      end,
      load_pr = function(target, cwd, callback)
        local graphql = require("octo.gh.graphql")
        local query = graphql("pull_request_query", target.owner, target.name, target.number, _G.octo_pv2_fragment)
        local args = { "gh", "api", "graphql", "--paginate", "--jq", ".", "--raw-field", "query=" .. query }
        if target.host ~= "github.com" then
          vim.list_extend(args, { "--hostname", target.host })
        end
        return vim.system(args, { cwd = cwd, text = true }, callback)
      end,
      decode_pr = function(output)
        if type(output) ~= "string" or output == "" then
          return nil
        end
        local pages = {}
        for line in (output .. "\n"):gmatch("([^\n]+)\n") do
          local ok, page = pcall(vim.json.decode, line)
          if not ok or type(page) ~= "table" then
            return nil
          end
          pages[#pages + 1] = page
        end
        local first = pages[1]
        local pull = first and first.data and first.data.repository and first.data.repository.pullRequest
        if type(pull) ~= "table" then
          return nil
        end
        pull.timelineItems = pull.timelineItems or { nodes = {} }
        pull.timelineItems.nodes = pull.timelineItems.nodes or {}
        for index = 2, #pages do
          local page_pull = pages[index].data
            and pages[index].data.repository
            and pages[index].data.repository.pullRequest
          local nodes = page_pull and page_pull.timelineItems and page_pull.timelineItems.nodes
          if type(nodes) ~= "table" then
            return nil
          end
          vim.list_extend(pull.timelineItems.nodes, nodes)
        end
        return pull
      end,
      create_pr = function(target, pull)
        require("octo").create_buffer(
          "pull",
          pull,
          target.repo,
          true,
          target.host ~= "github.com" and target.host or nil
        )
        return vim.api.nvim_get_current_buf()
      end,
      pick_prs = function(repo, pull_requests, callbacks)
        local actions = require("telescope.actions")
        local action_set = require("telescope.actions.set")
        local action_state = require("telescope.actions.state")
        local conf = require("telescope.config").values
        local entry_maker = require("octo.pickers.telescope.entry_maker")
        local finders = require("telescope.finders")
        local pickers = require("telescope.pickers")
        local previewers = require("octo.pickers.telescope.previewers")
        local max_number = 1
        for _, pull in ipairs(pull_requests) do
          max_number = math.max(max_number, #tostring(pull.number))
        end
        local opts = {
          prompt_title = "Pull requests · " .. repo,
          results_title = "",
          preview_title = "",
        }
        local picker = pickers.new(opts, {
          finder = finders.new_table({
            results = pull_requests,
            entry_maker = entry_maker.gen_from_issue(max_number),
          }),
          sorter = conf.generic_sorter(opts),
          previewer = previewers.issue.new(opts),
          attach_mappings = function()
            action_set.select:replace(function(prompt_buffer)
              local selected = action_state.get_selected_entry(prompt_buffer)
              actions.close(prompt_buffer)
              callbacks.transition()
              callbacks.select(selected and selected.obj or nil)
            end)
            return true
          end,
        })
        picker:find()
        return picker.prompt_bufnr
      end,
      delete_buffer = function(buffer)
        vim.api.nvim_buf_delete(buffer, { force = true })
      end,
    },
  })
end

local function enter(runtime)
  if session and not retire_session() then
    return nil
  end
  next_generation = next_generation + 1
  local handle = { hide = function() end }
  session = { generation = next_generation, handle = handle, runtime = runtime, pending = false }
  runtime.dock:prepare("pr")
  runtime.dock:activate("pr", handle)
  return session.generation
end

local function ensure_session(runtime)
  if session then
    return session.generation
  end
  return enter(runtime)
end

local function finish(runtime, generation)
  if not session or (generation and session.generation ~= generation) then
    return
  end
  local active = session
  session = nil
  if active.request and not active.request.completed then
    active.request.completed = true
    pcall(active.runtime.cancel_request, active.request.handle)
  end
  surface_check_tokens[active.generation] = nil
  active.runtime.dock:deactivate("pr", active.handle)
end

local function ensure_octo(runtime, generation)
  local ok, load_error = pcall(runtime.load_octo)
  if not ok then
    runtime.notify("Octoを読み込めませんでした: " .. tostring(load_error))
    finish(runtime, generation)
    return false
  end
  return session ~= nil and session.generation == generation
end

local function start_managed_request(runtime, generation, start, on_complete, on_start_error, on_timeout)
  if not session or session.generation ~= generation then
    return
  end
  local request_state = { completed = false }
  session.request = request_state
  local request_ok, request_error = pcall(function()
    request_state.handle = start(function(result)
      if request_state.completed then
        return
      end
      request_state.completed = true
      runtime.schedule(function()
        if not session or session.generation ~= generation or session.request ~= request_state then
          return
        end
        session.request = nil
        on_complete(result or {})
      end)
    end)
  end)
  if not request_ok then
    if session and session.generation == generation then
      if session.request == request_state then
        session.request = nil
      end
      on_start_error(request_error)
      finish(runtime, generation)
    end
    return
  end
  if request_state.completed then
    return
  end
  runtime.defer(function()
    if request_state.completed then
      return
    end
    request_state.completed = true
    pcall(runtime.cancel_request, request_state.handle)
    if session and session.generation == generation and session.request == request_state then
      session.request = nil
      on_timeout()
      finish(runtime, generation)
    end
  end, runtime.request_timeout_ms)
end

local function is_octo_buffer(buffer, runtime)
  if not runtime.buffer_valid(buffer) then
    return false
  end
  local filetype = runtime.buffer_filetype(buffer)
  return filetype == "octo" or filetype == "octo_panel"
end

local function has_live_buffer(entries, generation, runtime)
  local found = false
  for buffer, owner in pairs(entries) do
    if owner == generation then
      if runtime.buffer_valid(buffer) then
        found = true
      else
        entries[buffer] = nil
      end
    end
  end
  return found
end

local function has_live_tab(generation, runtime)
  local found = false
  for key, tracked in pairs(review_tabs) do
    if tracked.generation == generation then
      if runtime.tab_valid(tracked.handle) then
        found = true
      else
        review_tabs[key] = nil
      end
    end
  end
  return found
end

local function schedule_surface_check(runtime, generation)
  generation = generation or (session and session.generation)
  if not generation then
    return
  end
  local token = (surface_check_tokens[generation] or 0) + 1
  surface_check_tokens[generation] = token
  runtime.defer(function()
    if token ~= surface_check_tokens[generation] or not session or session.generation ~= generation then
      return
    end
    local has_surface = has_live_buffer(picker_buffers, generation, runtime)
      or has_live_buffer(octo_buffers, generation, runtime)
      or has_live_tab(generation, runtime)
    local pending = session and session.generation == generation and (session.pending or session.transitioning)
    if not has_surface and not pending then
      finish(runtime, generation)
    end
  end, 50)
end

local function track_buffer(buffer, entries, runtime, generation)
  if not runtime.buffer_valid(buffer) or entries[buffer] == generation then
    return
  end
  entries[buffer] = generation
  runtime.register_cleanup(buffer, function()
    if entries[buffer] == generation then
      entries[buffer] = nil
      if attached_buffers[buffer] == generation then
        attached_buffers[buffer] = nil
      end
    end
    schedule_surface_check(runtime, generation)
  end)
end

local function target_name(branch)
  return branch ~= "" and branch or "現在のbranch"
end

local function short_error(stderr)
  local message = type(stderr) == "string" and vim.trim(stderr) or ""
  if message == "" then
    return "gh pr viewが失敗しました"
  end
  if #message > 240 then
    return message:sub(1, 237) .. "..."
  end
  return message
end

function M.parse_pr(json)
  if type(json) ~= "string" then
    return nil
  end

  local ok, value = pcall(vim.json.decode, json)
  if
    not ok
    or type(value) ~= "table"
    or type(value.number) ~= "number"
    or value.number <= 0
    or value.number % 1 ~= 0
  then
    return nil
  end

  return value.number
end

local function parse_pr_target(json)
  if type(json) ~= "string" then
    return nil
  end
  local ok, value = pcall(vim.json.decode, json)
  if not ok or type(value) ~= "table" or type(value.url) ~= "string" then
    return nil
  end
  local number = M.parse_pr(json)
  if not number then
    return nil
  end
  local host, owner, name, url_number = value.url:match("^https://([^/]+)/([^/]+)/([^/]+)/pull/(%d+)$")
  if
    not host
    or not host:match("^[%w.-]+$")
    or not owner:match("^[%w_.-]+$")
    or not name:match("^[%w_.-]+$")
    or tonumber(url_number) ~= number
  then
    return nil
  end
  return {
    number = number,
    url = value.url,
    repo = owner .. "/" .. name,
    owner = owner,
    name = name,
    host = host,
  }
end

local function parse_repo(json)
  if type(json) ~= "string" then
    return nil
  end
  local ok, value = pcall(vim.json.decode, json)
  if not ok or type(value) ~= "table" or type(value.nameWithOwner) ~= "string" then
    return nil
  end
  if not value.nameWithOwner:match("^[%w_.-]+/[%w_.-]+$") then
    return nil
  end
  return value.nameWithOwner
end

local function parse_pr_list(json, repo)
  if type(json) ~= "string" then
    return nil
  end
  local ok, values = pcall(vim.json.decode, json)
  if not ok or type(values) ~= "table" or not vim.islist(values) then
    return nil
  end

  local pull_requests = {}
  for _, value in ipairs(values) do
    if
      type(value) ~= "table"
      or type(value.number) ~= "number"
      or value.number <= 0
      or value.number % 1 ~= 0
      or type(value.title) ~= "string"
      or type(value.url) ~= "string"
      or type(value.state) ~= "string"
      or type(value.isDraft) ~= "boolean"
      or type(value.headRefName) ~= "string"
    then
      return nil
    end
    local host, owner, name, url_number = value.url:match("^https://([^/]+)/([^/]+)/([^/]+)/pull/(%d+)$")
    if
      not host
      or not host:match("^[%w.-]+$")
      or owner .. "/" .. name ~= repo
      or tonumber(url_number) ~= value.number
    then
      return nil
    end
    pull_requests[#pull_requests + 1] = {
      __typename = "PullRequest",
      number = value.number,
      title = value.title,
      url = value.url,
      state = value.state,
      isDraft = value.isDraft,
      headRefName = value.headRefName,
      repository = { nameWithOwner = repo },
    }
  end
  return pull_requests
end

local function selected_pr_target(value, repo)
  if
    type(value) ~= "table"
    or type(value.number) ~= "number"
    or value.number <= 0
    or value.number % 1 ~= 0
    or type(value.url) ~= "string"
    or type(value.repository) ~= "table"
    or value.repository.nameWithOwner ~= repo
  then
    return nil
  end
  if type(value.headRefName) ~= "string" or value.headRefName == "" then
    return nil
  end
  local host, owner, name, url_number = value.url:match("^https://([^/]+)/([^/]+)/([^/]+)/pull/(%d+)$")
  if
    not host
    or not host:match("^[%w.-]+$")
    or owner .. "/" .. name ~= repo
    or tonumber(url_number) ~= value.number
  then
    return nil
  end
  return {
    number = value.number,
    url = value.url,
    repo = repo,
    owner = owner,
    name = name,
    host = host,
    branch = value.headRefName,
  }
end

local function load_pr_surface(runtime, generation, target, cwd)
  if not session or session.generation ~= generation then
    return
  end
  session.pending = true
  start_managed_request(runtime, generation, function(callback)
    return runtime.load_pr(target, cwd, callback)
  end, function(result)
    if result.code ~= 0 then
      session.pending = false
      runtime.notify("OctoのPRデータを取得できませんでした: " .. short_error(result.stderr))
      finish(runtime, generation)
      return
    end
    local pull = runtime.decode_pr(result.stdout)
    if
      type(pull) ~= "table"
      or type(pull.id) ~= "string"
      or pull.id == ""
      or pull.number ~= target.number
      or pull.url ~= target.url
    then
      session.pending = false
      runtime.notify("OctoのPRデータが不正です")
      finish(runtime, generation)
      return
    end
    local created, buffer = pcall(runtime.create_pr, target, pull)
    if not created or not runtime.buffer_valid(buffer) then
      session.pending = false
      runtime.notify("OctoのPR画面を作成できませんでした: " .. tostring(buffer))
      finish(runtime, generation)
      return
    end
    session.pending = false
    track_buffer(buffer, octo_buffers, runtime, generation)
  end, function(request_error)
    session.pending = false
    runtime.notify("OctoのPRデータ取得を開始できませんでした: " .. tostring(request_error))
  end, function()
    session.pending = false
    runtime.notify("OctoのPRデータ取得がtimeoutしました")
  end)
end

function M.open(target, adapter)
  target = target or {}
  local runtime = defaults(adapter)
  if type(target) ~= "table" or (target.branch ~= nil and type(target.branch) ~= "string") then
    runtime.notify("PRの対象branchが不正です")
    return
  end

  local cwd = runtime.root(target.cwd)
  if not cwd then
    runtime.notify("PRを開けません: Git repositoryを確認できませんでした")
    return
  end

  local branch = target.branch or ""
  local args = { "gh", "pr", "view" }
  if branch ~= "" then
    args[#args + 1] = branch
  end
  vim.list_extend(args, { "--json", "number,url" })

  local generation = enter(runtime)
  if not generation then
    return
  end
  if not ensure_octo(runtime, generation) then
    return
  end
  start_managed_request(runtime, generation, function(callback)
    return runtime.system(args, { cwd = cwd, text = true }, callback)
  end, function(result)
    if result.code ~= 0 then
      runtime.notify(("PRを開けません (%s): %s"):format(target_name(branch), short_error(result.stderr)))
      finish(runtime, generation)
      return
    end

    local pr = parse_pr_target(result.stdout)
    if not pr then
      runtime.notify(("PRを一意に解決できませんでした (%s)"):format(target_name(branch)))
      finish(runtime, generation)
      return
    end

    load_pr_surface(runtime, generation, pr, cwd)
  end, function(system_error)
    runtime.notify("ghを起動できませんでした: " .. tostring(system_error))
  end, function()
    runtime.notify("PR情報の取得がtimeoutしました")
  end)
end

function M.receive(payload, adapter)
  adapter = adapter or {}
  local notify = adapter.notify or function(message)
    vim.notify(message, vim.log.levels.ERROR)
  end
  if
    type(payload) ~= "table"
    or type(payload.cwd) ~= "string"
    or not payload.cwd:find("%S")
    or type(payload.branch) ~= "string"
  then
    notify("LazyGitから受け取ったPR情報が不正です")
    return
  end
  local open = adapter.open or M.open
  open({ cwd = payload.cwd, branch = payload.branch })
end

function M.list(adapter)
  local runtime = defaults(adapter)
  local cwd = runtime.root()
  if not cwd then
    runtime.notify("PR一覧を開けません: Git repositoryを確認できませんでした")
    return
  end
  local generation = enter(runtime)
  if not generation then
    return
  end
  if not ensure_octo(runtime, generation) then
    return
  end
  start_managed_request(runtime, generation, function(callback)
    return runtime.system({ "gh", "repo", "view", "--json", "nameWithOwner" }, { cwd = cwd, text = true }, callback)
  end, function(result)
    if result.code ~= 0 then
      runtime.notify("PR一覧のrepositoryを解決できませんでした: " .. short_error(result.stderr))
      finish(runtime, generation)
      return
    end
    local repo = parse_repo(result.stdout)
    if not repo then
      runtime.notify("PR一覧のrepository情報が不正です")
      finish(runtime, generation)
      return
    end

    start_managed_request(runtime, generation, function(callback)
      return runtime.system({
        "gh",
        "pr",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,title,url,state,isDraft,headRefName",
      }, { cwd = cwd, text = true }, callback)
    end, function(list_result)
      if list_result.code ~= 0 then
        runtime.notify("PR一覧を取得できませんでした: " .. short_error(list_result.stderr))
        finish(runtime, generation)
        return
      end
      local pull_requests = parse_pr_list(list_result.stdout, repo)
      if not pull_requests then
        runtime.notify("PR一覧の応答が不正です")
        finish(runtime, generation)
        return
      end
      if #pull_requests == 0 then
        runtime.notify("表示できるopen PRがありません")
        finish(runtime, generation)
        return
      end

      local picker_ok, picker = pcall(runtime.pick_prs, repo, pull_requests, {
        transition = function()
          if session and session.generation == generation then
            session.pending = true
          end
        end,
        select = function(selected)
          if not session or session.generation ~= generation then
            return
          end
          local target = selected_pr_target(selected, repo)
          if not target then
            runtime.notify("選択されたPR情報が不正です")
            session.pending = false
            finish(runtime, generation)
            return
          end
          session.pending = true
          runtime.switch_worktree({
            branch = target.branch,
            cwd = cwd,
            command = "lua require('user.pr_review').open()",
            should_continue = function()
              return session ~= nil and session.generation == generation
            end,
            on_current = function()
              if not session or session.generation ~= generation then
                return
              end
              load_pr_surface(runtime, generation, target, cwd)
            end,
            on_error = function(message)
              if not session or session.generation ~= generation then
                return
              end
              session.pending = false
              runtime.notify(message)
              finish(runtime, generation)
            end,
          })
        end,
      })
      if not picker_ok or not runtime.buffer_valid(picker) then
        runtime.notify("OctoのPR一覧を開けませんでした: " .. tostring(picker))
        finish(runtime, generation)
        return
      end
      track_buffer(picker, picker_buffers, runtime, generation)
    end, function(request_error)
      runtime.notify("PR一覧の取得を開始できませんでした: " .. tostring(request_error))
    end, function()
      runtime.notify("PR一覧の取得がtimeoutしました")
    end)
  end, function(system_error)
    runtime.notify("ghを起動できませんでした: " .. tostring(system_error))
  end, function()
    runtime.notify("PR一覧のrepository取得がtimeoutしました")
  end)
end

function M.attach(buffer, adapter)
  local runtime = defaults(adapter)
  local generation
  local octo_buffer = is_octo_buffer(buffer, runtime)
  if octo_buffer then
    generation = ensure_session(runtime)
  elseif session then
    generation = session.generation
  end
  local owner = generation or true
  if attached_buffers[buffer] == owner then
    return
  end
  attached_buffers[buffer] = owner
  runtime.register_cleanup(buffer, function()
    if attached_buffers[buffer] == owner then
      attached_buffers[buffer] = nil
    end
  end)

  runtime.set_keymap("n", "<leader>pr", function()
    runtime.command("Octo review")
  end, { buffer = buffer, desc = "Start or resume review" })
  runtime.set_keymap("x", "<leader>pc", function()
    runtime.reviews().add_review_comment(false)
  end, { buffer = buffer, desc = "Add review comment" })
  runtime.set_keymap("x", "<leader>ps", function()
    runtime.reviews().add_review_comment(true)
  end, { buffer = buffer, desc = "Add review suggestion" })
  runtime.set_keymap("n", "<leader>pS", function()
    runtime.reviews().submit_review()
  end, { buffer = buffer, desc = "Submit review" })
  runtime.set_keymap("n", "<leader>pd", function()
    runtime.reviews().discard_review()
  end, { buffer = buffer, desc = "Discard review" })
  runtime.set_keymap("n", "<leader>pq", function()
    M.close(runtime, generation)
  end, { buffer = buffer, desc = "Close review" })

  if octo_buffer then
    track_buffer(buffer, octo_buffers, runtime, generation)
  end
end

function M.attach_if_review(buffer, adapter)
  local runtime = defaults(adapter)
  local ok, reviews = pcall(runtime.reviews)
  if not ok or not reviews.get_current_review() then
    return
  end
  local generation = ensure_session(runtime)
  M.attach(buffer, runtime)
  local tab = runtime.current_tab()
  review_tabs[tostring(tab)] = { handle = tab, generation = generation }
end

function M.on_tab_closed(_, adapter)
  local runtime = defaults(adapter)
  schedule_surface_check(runtime)
end

local function close_buffers(entries, generation, runtime)
  local ok = true
  for buffer, owner in pairs(entries) do
    if owner == generation then
      if runtime.buffer_valid(buffer) then
        local deleted, delete_error = pcall(runtime.delete_buffer, buffer)
        if not deleted then
          ok = false
          runtime.notify("PR画面を閉じられませんでした: " .. tostring(delete_error))
        else
          entries[buffer] = nil
        end
      else
        entries[buffer] = nil
      end
    end
  end
  return ok
end

local function close_review_tabs(generation, runtime)
  local ok, reviews = pcall(runtime.reviews)
  if not ok then
    runtime.notify("review tabを確認できませんでした: " .. tostring(reviews))
    return false
  end
  local closed_all = true
  local closed_review = false
  local tracked_review = false
  for key, tracked in pairs(review_tabs) do
    if tracked.generation == generation then
      tracked_review = true
      if runtime.tab_valid(tracked.handle) then
        local close = tracked.octo_detached and runtime.close_tab or reviews.close
        local closed, close_error = pcall(close, tracked.handle)
        if not closed then
          closed_all = false
          runtime.notify("review tabを閉じられませんでした: " .. tostring(close_error))
        elseif runtime.tab_valid(tracked.handle) then
          tracked.octo_detached = true
          closed_all = false
          runtime.notify("review tabが閉じられていません。もう一度<leader>pqを実行してください")
        else
          closed_review = true
          review_tabs[key] = nil
        end
      else
        review_tabs[key] = nil
      end
    end
  end
  if not tracked_review and not closed_review and reviews.get_current_review() then
    local tab = runtime.current_tab()
    local closed, close_error = pcall(reviews.close, tab)
    if not closed then
      closed_all = false
      runtime.notify("review tabを閉じられませんでした: " .. tostring(close_error))
    elseif runtime.tab_valid(tab) then
      review_tabs[tostring(tab)] = { handle = tab, generation = generation, octo_detached = true }
      closed_all = false
      runtime.notify("review tabが閉じられていません。もう一度<leader>pqを実行してください")
    end
  end
  return closed_all
end

retire_session = function()
  local active = session
  if not active then
    return true
  end
  local generation = active.generation
  local runtime = active.runtime
  active.transitioning = true
  if active.request and not active.request.completed then
    active.request.completed = true
    pcall(runtime.cancel_request, active.request.handle)
  end
  local closed_all = close_review_tabs(generation, runtime)
  closed_all = close_buffers(picker_buffers, generation, runtime) and closed_all
  closed_all = close_buffers(octo_buffers, generation, runtime) and closed_all
  if not closed_all then
    active.transitioning = false
    return false
  end
  surface_check_tokens[generation] = nil
  session = nil
  return true
end

function M.close(adapter, requested_generation)
  local runtime = defaults(adapter)
  local generation = session and session.generation
  if not generation or (requested_generation and requested_generation ~= generation) then
    return
  end
  local closed_all = close_review_tabs(generation, runtime)
  closed_all = close_buffers(picker_buffers, generation, runtime) and closed_all
  closed_all = close_buffers(octo_buffers, generation, runtime) and closed_all
  if closed_all then
    finish(runtime, generation)
  end
end

function M.ensure_review_explorer()
  local octo_window = vim.api.nvim_get_current_win()
  vim.schedule(function()
    require("user.workspace").ensure_explorer({ focus = false })
    vim.schedule(function()
      if vim.api.nvim_win_is_valid(octo_window) then
        vim.api.nvim_set_current_win(octo_window)
      end
    end)
  end)
end

return M
