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
