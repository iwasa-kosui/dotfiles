local wezterm = require 'wezterm'
local config = wezterm.config_builder()

-- config.color_scheme = 'AdventureTime'
config.automatically_reload_config = true
config.font = wezterm.font_with_fallback {
    { family = 'JetBrains Mono', weight = 'Medium' },
    { family = 'BIZ UDGothic' },
    'Noto Color Emoji',
}
config.font_size = 14.0
config.use_ime = true
config.window_background_opacity = 0.95
config.macos_window_background_blur = 20
config.window_decorations = "RESIZE"
config.leader = { key = 'VoidSymbol', mods = '', timeout_milliseconds = 1000 }

config.keys = {
  {
    key = '|',
    mods = 'CMD',
    action = wezterm.action.SplitHorizontal { domain = 'CurrentPaneDomain' },
  },
  {
    key = 'j',
    mods = 'CTRL',
    action = wezterm.action.ActivatePaneDirection 'Down',
  },
  {
    key = 'k',
    mods = 'CTRL',
    action = wezterm.action.ActivatePaneDirection 'Up',
  },
  {
    key = '-',
    mods = 'CMD',
    action = wezterm.action.SplitVertical { domain = 'CurrentPaneDomain' },
  },
}

return config
