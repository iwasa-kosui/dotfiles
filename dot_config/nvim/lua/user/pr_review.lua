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
      buffer_filetype = function(buffer)
        return vim.bo[buffer].filetype
      end,
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
    end
    attached_buffers[buffer] = nil
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
  vim.list_extend(args, { "--json", "number" })

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

      local number = M.parse_pr(result.stdout)
      if not number then
        runtime.notify(("PRを一意に解決できませんでした (%s)"):format(target_name(branch)))
        finish(runtime, generation)
        return
      end

      local command_ok, command_error = pcall(runtime.command, ("Octo pr edit %d"):format(number))
      if not command_ok then
        runtime.notify("OctoでPRを開けませんでした: " .. tostring(command_error))
        finish(runtime, generation)
      end
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
  local previous_buffer = runtime.current_buffer()
  local ok, command_error = pcall(runtime.command, "Octo pr list")
  if not ok then
    runtime.notify("OctoのPR一覧を開けませんでした: " .. tostring(command_error))
    finish(runtime, generation)
    return
  end
  runtime.schedule(function()
    if not session or session.generation ~= generation then
      return
    end
    local buffer = runtime.current_buffer()
    if buffer ~= previous_buffer and runtime.buffer_valid(buffer) then
      track_buffer(buffer, picker_buffers, runtime, generation)
    end
  end)
end

function M.attach(buffer, adapter)
  local runtime = defaults(adapter)
  if attached_buffers[buffer] then
    return
  end
  attached_buffers[buffer] = true
  runtime.register_cleanup(buffer, function()
    attached_buffers[buffer] = nil
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
    M.close(runtime)
  end, { buffer = buffer, desc = "Close review" })

  if is_octo_buffer(buffer, runtime) then
    local generation = ensure_session(runtime)
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

function M.close(adapter)
  local runtime = defaults(adapter)
  local generation = session and session.generation
  local ok, reviews = pcall(runtime.reviews)
  local current_review = ok and reviews.get_current_review()
  if current_review then
    local tab = runtime.current_tab()
    reviews.close(tab)
    review_tabs[tostring(tab)] = nil
  else
    local buffer = runtime.current_buffer()
    if is_octo_buffer(buffer, runtime) then
      octo_buffers[buffer] = nil
      runtime.delete_buffer(buffer)
    end
  end
  finish(runtime, generation)
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
