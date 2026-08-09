local M = {}

local attached_buffers = {}
local octo_buffers = {}
local picker_buffers = {}
local review_tabs = {}
local session
local next_generation = 0
local surface_check_tokens = {}

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
      system = vim.system,
      schedule = vim.schedule,
      defer = vim.defer_fn,
      command = vim.cmd,
      with_cwd = function(cwd, callback)
        local previous = vim.fn.getcwd()
        vim.api.nvim_set_current_dir(cwd)
        local ok, result = xpcall(callback, debug.traceback)
        vim.api.nvim_set_current_dir(previous)
        if not ok then
          error(result)
        end
      end,
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
      capture_buffers = function()
        local captured = {}
        for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
          if vim.api.nvim_buf_is_valid(buffer) then
            captured[buffer] = {
              name = vim.api.nvim_buf_get_name(buffer),
              filetype = vim.bo[buffer].filetype,
            }
          end
        end
        return captured
      end,
      find_surfaces = function(kind, baseline)
        local surfaces = {}
        for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
          if vim.api.nvim_buf_is_valid(buffer) then
            local name = vim.api.nvim_buf_get_name(buffer)
            local filetype = vim.bo[buffer].filetype
            local previous = baseline[buffer]
            local changed = not previous or previous.name ~= name or previous.filetype ~= filetype
            local is_open = kind == "open" and name:match("^octo://")
            local is_list = kind == "list"
              and (
                filetype == "TelescopePrompt"
                or filetype == "snacks_picker_input"
                or filetype == "snacks_picker_list"
              )
            if changed and (is_open or is_list) then
              surfaces[#surfaces + 1] = buffer
            end
          end
        end
        return surfaces
      end,
      surface_ready = function(buffer, kind)
        if kind == "list" then
          return true
        end
        return (_G.octo_buffers and _G.octo_buffers[buffer] ~= nil) or vim.bo[buffer].filetype == "octo"
      end,
      max_surface_checks = 200,
      delete_buffer = function(buffer)
        vim.api.nvim_buf_delete(buffer, { force = true })
      end,
    },
  })
end

local function enter(runtime)
  next_generation = next_generation + 1
  local handle = { hide = function() end }
  session = { generation = next_generation, handle = handle, runtime = runtime }
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
  surface_check_tokens[active.generation] = nil
  active.runtime.dock:deactivate("pr", active.handle)
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
    if not has_surface then
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

local function observe_surface(runtime, generation, kind, baseline)
  if runtime.observe_surface then
    runtime.observe_surface(generation, kind, baseline)
    return
  end

  local attempts = 0
  local function check()
    if not session or session.generation ~= generation then
      return
    end

    local surfaces = runtime.find_surfaces(kind, baseline)
    local found = false
    local ready = false
    local entries = kind == "open" and octo_buffers or picker_buffers
    for _, buffer in ipairs(surfaces) do
      if runtime.buffer_valid(buffer) then
        found = true
        track_buffer(buffer, entries, runtime, generation)
        ready = ready or runtime.surface_ready(buffer, kind)
      end
    end
    if found and (kind == "list" or ready) then
      return
    end

    attempts = attempts + 1
    if attempts < runtime.max_surface_checks then
      runtime.defer(check, 50)
      return
    end

    if kind == "open" and found then
      runtime.notify("OctoのPR画面の読み込みが完了しませんでした")
      for buffer, owner in pairs(octo_buffers) do
        if owner == generation and runtime.buffer_valid(buffer) and not runtime.surface_ready(buffer, kind) then
          local deleted, delete_error = pcall(runtime.delete_buffer, buffer)
          if not deleted then
            runtime.notify("PR画面を閉じられませんでした: " .. tostring(delete_error))
            return
          end
          octo_buffers[buffer] = nil
        end
      end
    elseif kind == "list" then
      runtime.notify("OctoのPR一覧が開かれませんでした。PRが存在するか確認してください")
    end
    finish(runtime, generation)
  end

  check()
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
  return { number = number, url = value.url, repo = owner .. "/" .. name }
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
  local ok, system_error = pcall(runtime.system, args, { cwd = cwd, text = true }, function(result)
    runtime.schedule(function()
      if not session or session.generation ~= generation then
        return
      end
      result = result or {}
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

      local baseline = runtime.capture_buffers()
      local command_ok, command_error = pcall(runtime.command, { cmd = "Octo", args = { pr.url } })
      if not command_ok then
        runtime.notify("OctoでPRを開けませんでした: " .. tostring(command_error))
        finish(runtime, generation)
        return
      end
      observe_surface(runtime, generation, "open", baseline)
    end)
  end)
  if not ok then
    runtime.notify("ghを起動できませんでした: " .. tostring(system_error))
    finish(runtime, generation)
  end
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
  local ok, system_error = pcall(
    runtime.system,
    { "gh", "repo", "view", "--json", "nameWithOwner" },
    { cwd = cwd, text = true },
    function(result)
      runtime.schedule(function()
        if not session or session.generation ~= generation then
          return
        end
        result = result or {}
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

        local baseline = runtime.capture_buffers()
        local command_ok, command_error = pcall(runtime.with_cwd, cwd, function()
          runtime.command({ cmd = "Octo", args = { "pr", "list", repo } })
        end)
        if not command_ok then
          runtime.notify("OctoのPR一覧を開けませんでした: " .. tostring(command_error))
          finish(runtime, generation)
          return
        end
        observe_surface(runtime, generation, "list", baseline)
      end)
    end
  )
  if not ok then
    runtime.notify("ghを起動できませんでした: " .. tostring(system_error))
    finish(runtime, generation)
  end
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

function M.close(adapter, requested_generation)
  local runtime = defaults(adapter)
  local generation = session and session.generation
  if not generation or (requested_generation and requested_generation ~= generation) then
    return
  end
  local ok, reviews = pcall(runtime.reviews)
  local closed_all = ok
  local closed_review = false
  local tracked_review = false
  if ok then
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
            runtime.notify(
              "review tabが閉じられていません。もう一度<leader>pqを実行してください"
            )
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
  end
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
