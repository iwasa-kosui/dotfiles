if vim.g.vscode then
  -- VSCode Neovim
  require "user.vscode_keymaps"
else
  -- Ordinary Neovim
  vim.g.mapleader = ' ' 
  vim.o.expandtab = true
  vim.o.tabstop = 2
  vim.o.shiftwidth = 2
  vim.api.nvim_set_keymap('n', '<Leader>t', ':NERDTreeFocus<CR>', {noremap=true})
  vim.api.nvim_set_keymap('n', '<Leader>f', ':Files<CR>', {noremap=true})


  vim.cmd [[packadd packer.nvim]]
  return require('packer').startup(function(use)
    use 'wbthomason/packer.nvim'
    use {
      'neoclide/coc.nvim',
      branch = 'release',
    }
    use 'Xuyuanp/nerdtree-git-plugin'
    use 'airblade/vim-gitgutter'
    use 'preservim/nerdtree'
    use { 'junegunn/fzf', run = ":call fzf#install()" }
    use { 'junegunn/fzf.vim' }
  end)
end

