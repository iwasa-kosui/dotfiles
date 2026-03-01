#!/bin/sh
input=$(cat)
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd')
model=$(echo "$input" | jq -r '.model.display_name // ""')
remaining=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')

user=$(whoami)
host=$(hostname -s)

dir_display=$(echo "$cwd" | sed "s|^$HOME|~|")

# git branch (skip optional locks)
branch=""
if git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(GIT_OPTIONAL_LOCKS=0 git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
fi

# Build status line
line=$(printf "\033[32m%s@%s\033[0m \033[34m%s\033[0m" "$user" "$host" "$dir_display")

if [ -n "$branch" ]; then
  line=$(printf "%s \033[33m(%s)\033[0m" "$line" "$branch")
fi

if [ -n "$model" ]; then
  line=$(printf "%s \033[36m[%s]\033[0m" "$line" "$model")
fi

if [ -n "$remaining" ]; then
  line=$(printf "%s \033[35mctx:%s%%\033[0m" "$line" "$remaining")
fi

printf "%s\n" "$line"
