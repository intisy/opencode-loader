# opencode-hub


[![npm version](https://img.shields.io/npm/v/opencode-hub)](https://www.npmjs.com/package/opencode-hub)
[![npm downloads](https://img.shields.io/npm/dm/opencode-hub)](https://www.npmjs.com/package/opencode-hub)
[![CI](https://github.com/intisy/opencode-hub/actions/workflows/publish.yml/badge.svg)](https://github.com/intisy/opencode-hub/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

TUI launcher and `oc` shell command for [OpenCode](https://github.com/sst/opencode).

When loaded as an OpenCode plugin, it installs the `oc` command into your shell. Running `oc` opens an interactive TUI for switching between projects and managing plugins.

## Features

- **Project list** — shows recent OpenCode projects sorted by last used, with session counts
- **Pin / Hide / Unhide** — organize your project list
- **Custom path** — open any directory directly
- **Change path** — reassociate sessions when a project moves
- **Plugin manager** — view plugin status, toggle auto-update, force rebuild, downgrade to specific commits
- **Auto-update OpenCode** — checks for new `opencode-ai` npm versions once per day
- **Centralized config** — stores config in `config/oc-config.json`, plugins in `config/plugins.json`
- **`<creator>/<repo>` layout** — plugin repos stored under `repos/<github-user>/<repo-name>` to prevent collisions

## Requirements

- [Bun](https://bun.sh/) runtime (uses `bun:sqlite` for reading the OpenCode session database)

## Installation

### Option A — Via plugin-updater (recommended)

If you have [opencode-plugin-updater](https://github.com/intisy/opencode-plugin-updater) installed, add this entry to `~/.config/opencode/config/plugins.json`:

```json
{
  "name": "opencode-hub",
  "url": "https://github.com/intisy/opencode-hub.git",
  "install": null,
  "build": null,
  "bundle": null,
  "output": "plugin.js",
  "pluginFile": "oc-launcher.js",
  "autoUpdate": true
}
```

Restart OpenCode. The updater will clone the repo and deploy the plugin automatically.

### Option B — npm

Add the package to your `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugins": ["opencode-hub@latest"]
}
```

Restart OpenCode.

### Option C — Manual

```bash
mkdir -p ~/.config/opencode/repos/intisy/opencode-hub
git clone https://github.com/intisy/opencode-hub.git ~/.config/opencode/repos/intisy/opencode-hub
cp ~/.config/opencode/repos/intisy/opencode-hub/plugin.js ~/.config/opencode/plugins/oc-launcher.js
```

Register the plugin in `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugins": {
    "oc-launcher": "./plugins/oc-launcher.js"
  }
}
```

## How It Works

1. **On OpenCode startup** — the plugin installs `oc` (or `oc.cmd` on Windows) into `~/.local/bin/`
2. **When you run `oc`** — the TUI launcher opens, showing your projects and plugins
3. **Select a project** — the launcher `cd`s into the directory and starts `opencode`

The plugin also provides an `oc_remove` tool to uninstall the shell command.

## Usage

```bash
oc              # Launch TUI
oc 3            # Open project #3 directly
oc myproject    # Open first project matching "myproject"
```

### Keyboard shortcuts

#### Projects tab

| Key | Action |
|-----|--------|
| ↑↓ / W S | Navigate |
| Enter | Open action menu |
| O | Open project |
| P | Pin/Unpin |
| H | Hide |
| U | Unhide all |
| C | Custom path |
| ← → | Switch tabs |
| Q | Quit |

#### Plugins tab

| Key | Action |
|-----|--------|
| ↑↓ / W S | Navigate |
| Enter | Open action menu |
| F | Fetch remote updates |
| A | Toggle auto-update |
| U | Update plugin |
| Q | Quit |

## License

MIT

