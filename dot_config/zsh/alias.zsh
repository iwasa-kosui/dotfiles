# ------------------------------------------------------------------------------
# completion
# ------------------------------------------------------------------------------

zstyle ':completion:*' verbose yes
zstyle ':completion:*' format '%B%d%b'
zstyle ':completion:*:warnings' format 'No matches for: %d'
zstyle ':completion:*' group-name ''

# ------------------------------------------------------------------------------
# A-Z
# ------------------------------------------------------------------------------

alias c='code'
alias c.='code .'
alias d='docker compose'
alias e='exec $SHELL -l'
alias o='open'
alias o.='open .'
t () {
	tmux attach -t $1 2> /dev/null || tmux new -s $1 2> /dev/null || tmux ls
}
_t() { _values 'sessions' "${(@f)$(tmux ls -F '#S' 2>/dev/null )}" }
compdef _t t
alias tmux="TERM=xterm-256color tmux"
alias x='/Applications/Xcode.app/Contents/MacOS/Xcode'
alias x.='x .'

# ------------------------------------------------------------------------------
# git
# ------------------------------------------------------------------------------

echocmd() {
  GREY='\033[1;30m'
  NC='\033[0m'
  echo "${GREY}❯ $@${NC}";
}

g() {
  echocmd 'git' $@;
  git "$@";
}
gl() {
  echocmd 'git pull origin `git rev-parse --abbrev-ref @`';
  git pull origin `git rev-parse --abbrev-ref @`;
}
gm() {
  echocmd 'git merge' $@;
  git merge "$@";
}
gmo() {
  echocmd 'git merge origin/`git rev-parse --abbrev-ref @`';
  git merge origin/`git rev-parse --abbrev-ref @`;
}
gco() {
  echocmd 'git switch' $@;
  git switch "$@";
}
gsw() {
  echocmd 'git switch' $@;
  git switch "$@";
}
gpo() {
  echocmd 'git push origin HEAD' $@;
  git push origin HEAD "$@";
}
gf() {
  echocmd 'git fetch' $@;
  git fetch "$@";
}

# ------------------------------------------------------------------------------
# misc
# ------------------------------------------------------------------------------
if type "nvim" > /dev/null; then
  alias vim=nvim
fi
