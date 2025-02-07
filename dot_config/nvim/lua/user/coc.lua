local opts = {silent = true, noremap = true, expr = true, replace_keycodes = false}

vim.keymap.set("i", "<TAB>", 'coc#pum#visible() ? coc#pum#next(1) : v:lua.check_back_space() ? "<TAB>" : coc#refresh()', opts)
vim.keymap.set("i", "<S-TAB>", [[coc#pum#visible() ? coc#pum#prev(1) : "\<C-h>"]], opts)
vim.keymap.set("i", "<cr>", [[coc#pum#visible() ? coc#pum#confirm() : "\<C-g>u\<CR>\<c-r>=coc#on_enter()\<CR>"]], opts)

vim.g.coc_global_extensions = {
  'coc-tsserver',
  'coc-eslint',
  'coc-prettier',
  'coc-git',
  'coc-fzf-preview',
  'coc-lists',
  'coc-lua',
  'coc-json',
  'coc-copilot'
}