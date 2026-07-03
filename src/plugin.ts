import { existsSync, writeFileSync, mkdirSync, readFileSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath, pathToFileURL } from "url";
// @ts-ignore — generated bundle, no .d.ts
import { maybeRunCli, deployLoaderCommands } from "./commands.js";
// @ts-ignore — generated bundle, no .d.ts
import { makeWriteLog, defineConfig, defineReadme, maybeRunReadmeCli } from "../core/dist/index.js";

// Slash-command invocations shell in as `node <this file> <action>`; handle them
// first and exit, so command/config runs never go through plugin activation.
// Register config defaults BEFORE the CLI guard so `config schema` sees them (no write).
defineConfig("opencode-loader", {
  logging: true,
  auto_update_check: true,
  update_check_delay_ms: 1500,
  update_check_interval_hours: 24,
  catalog_cache_hours: 6,
  default_tab: "projects",
});

defineReadme({
  description:
    "TUI launcher and `oc` shell command for [OpenCode](https://github.com/sst/opencode). When loaded as an OpenCode plugin it installs an `oc` command into your shell; running `oc` opens an interactive TUI for switching between projects, managing plugins, and signing in to providers. It also drives [plugin-updater](https://github.com/intisy-ai/plugin-updater) on startup so all your git-based plugins stay current.",
  architecture: `flowchart TD
    START[OpenCode startup] -->|activate| PLUGIN[plugin.js]
    PLUGIN -->|earlyLaunch| UPDATER[plugin-updater]
    PLUGIN -->|install| OCBIN["oc / oc.cmd in ~/.local/bin"]
    PLUGIN -->|deployCommands| CMDS["/opencode-loader-config, /plugins, /accounts"]
    OCBIN -->|run oc| TUI["core-loader TUI (bun run tui.js)"]
    TUI --> PROJ[Projects tab]
    TUI --> PLUG[Plugins tab]
    TUI --> PROV[Providers tab — tui-extension.js]
    PROV --> COREAUTH[(core-auth account store)]`,
  structure: {
    src: [
      "`plugin.ts` — the OpenCode plugin entry (`activate`/`cleanup`); installs the `oc` wrapper, runs plugin-updater, deploys commands. Also acts as the command CLI (`node plugin.js <config|plugins|accounts>`).",
      "`tui-extension.ts` — the loader's custom Providers tab (auto-discovers installed providers).",
      "`commands.ts` — cross-app slash-command definitions + their CLI actions.",
      "`core-loader/` — git submodule ([`intisy-ai/core-loader`](https://github.com/intisy-ai/core-loader)): the TUI engine (`core-loader/dist/tui.js`), built and bundled at publish time.",
      "`core/` — git submodule ([`intisy-ai/core`](https://github.com/intisy-ai/core)): shared config + the cross-app command framework, bundled to `core/dist/index.js`.",
    ],
    dist: ["compiled output (generated; not committed)."],
  },
  dependencies: ["core-loader", "core", "plugin-updater", "Bun"],
  extraSections: [
    {
      id: "requirements",
      title: "Requirements",
      after: "structure",
      body: "- [Bun](https://bun.sh/) runtime (the TUI uses `bun:sqlite` to read the OpenCode session database).",
    },
    {
      id: "loader-install-detail",
      title: "Plugin-updater entry",
      after: "installation",
      body: [
        "When using plugin-updater, add this entry to `~/.config/opencode/config/plugins.json`:",
        "",
        "```json",
        '{ "name": "opencode-loader", "url": "https://github.com/intisy-ai/opencode-loader", "enabled": true, "autoUpdate": true }',
        "```",
        "Restart OpenCode — the updater clones, builds (including the submodules), and loads it.",
        "",
        "When using npm directly, add to `~/.config/opencode/opencode.json`:",
        "",
        "```jsonc",
        '{ "plugins": ["opencode-loader@latest"] }',
        "```",
      ].join("\n"),
    },
    {
      id: "usage",
      title: "Usage",
      after: "loader-install-detail",
      body: [
        "```bash",
        "oc              # Launch the TUI",
        "oc 3            # Open project #3 directly",
        "oc myproject    # Open the first project matching \"myproject\"",
        "```",
        "",
        "### Keyboard shortcuts",
        "",
        "| Key | Projects tab | Plugins tab |",
        "|-----|--------------|-------------|",
        "| ↑↓ / W S | Navigate | Navigate |",
        "| Enter | Open action menu | Open action menu |",
        "| O | Open project | — |",
        "| P | Pin/Unpin | — |",
        "| H / U | Hide / Unhide all | — |",
        "| F | — | Fetch remote updates |",
        "| A | — | Toggle auto-update |",
        "| ← → | Switch tabs | Switch tabs |",
        "| Q | Quit | Quit |",
      ].join("\n"),
    },
    {
      id: "commands-loader",
      title: "Commands",
      after: "usage",
      body: [
        "Deployed automatically on activation to both apps' command directories (`~/.config/opencode/command/` and `~/.claude/commands/`):",
        "",
        "| Command | Description |",
        "| --- | --- |",
        "| `/opencode-loader-config` | View/change loader config (`opencode-loader.json`): `list`, `get <key>`, `set <key> <value>`. 100% of the config is reachable here. |",
        "| `/plugins` | List the loader-managed plugins and their state (from `plugins.json`). |",
        "| `/accounts` | List signed-in accounts across all providers (from the core-auth store). |",
      ].join("\n"),
    },
    {
      id: "config-extra",
      title: "Configuration (extra)",
      after: "configuration",
      body: "The TUI also stores its own settings in `config/oc-config.json` and the plugin list in `config/plugins.json`.",
    },
  ],
});

if (maybeRunReadmeCli("opencode-loader")) process.exit(0);

if (await maybeRunCli(getAppConfigDir())) {
  process.exit(0);
}

const START_TIME = new Date().toISOString().replace(/:/g, "-").split(".")[0];

let PLUGIN_CONFIG: Record<string, unknown> | null = null;
function getPluginConfig(configDir: string): Record<string, unknown> {
  if (PLUGIN_CONFIG !== null) return PLUGIN_CONFIG;
  try {
    const preferred = join(configDir, "config", "opencode-loader.json");
    const fallback  = join(configDir, "opencode-loader.json");
    const p = existsSync(preferred) ? preferred : existsSync(fallback) ? fallback : null;
    PLUGIN_CONFIG = p ? JSON.parse(readFileSync(p, "utf-8")) : {};
  } catch { PLUGIN_CONFIG = {}; }
  return PLUGIN_CONFIG;
}

// Delegate to the shared core logger: loader lines get the [opencode-loader] prefix,
// per-plugin color, and the GLOBAL console toggle; core also does the file write
// (respecting opencode-loader.json `logging`). Signature kept for existing callers.
function writeLog(configDir: string, message: string, isError: boolean = false) {
  makeWriteLog("opencode-loader", configDir)(message, isError);
}

function getAppConfigDir() {
  const home = homedir();
  const directPath = join(home, ".opencode");
  const configPath = join(home, ".config", "opencode");
  return existsSync(directPath) ? directPath : configPath;
}

// Resolve plugin-updater the same way in both loaders: the bare specifier first,
// then known install locations (skipped if absent). A path must be a file:// URL
// for dynamic import (notably on Windows), hence pathToFileURL.
async function loadUpdater(): Promise<any> {
  try {
    return await import("plugin-updater");
  } catch {
    // opencode installs npm plugins into its package cache, off the deployed
    // plugin's resolution path; this candidate is simply absent under Claude.
    const candidates = [
      join(homedir(), ".cache", "opencode", "packages", "plugin-updater@latest", "node_modules", "plugin-updater", "dist", "index.js"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return await import(pathToFileURL(candidate).href);
    }
    throw new Error("plugin-updater not resolvable");
  }
}

async function runEarlyLaunchHooks(configDir: string) {
  if (process.env.PLUGIN_UPDATER_ACTIVATION === "1") {
    writeLog(configDir, "Updates driven by plugin-updater (activation context), skipping earlyLaunch");
    return;
  }
  try {
    const updater: any = await loadUpdater();
    const gitPlugins = updater.getPlugins(configDir);
    writeLog(configDir, "Running plugin-updater earlyLaunch for " + gitPlugins.length + " plugins");
    await updater.earlyLaunch(configDir, gitPlugins);
    writeLog(configDir, "plugin-updater earlyLaunch complete");
  } catch (e) {
    writeLog(configDir, "plugin-updater not available, skipping updates: " + e);
  }
}

function getBinDir() {
  return join(homedir(), ".local", "bin");
}

function installOcWrapper(configDir: string) {
  const binDir = getBinDir();
  if (!existsSync(binDir)) try { mkdirSync(binDir, { recursive: true }); } catch {}

  const pluginDir = dirname(fileURLToPath(import.meta.url));
  // resolved at every oc invocation, not at install time, so the wrapper
  // works as soon as any copy of the TUI exists and never goes stale
  const tuiCandidates = [
    // core-loader is the post-rename location; the bare "core" paths remain as
    // fallbacks so already-deployed (pre-rename) installs keep resolving the TUI.
    join(pluginDir, "..", "core-loader", "dist", "tui.js"),
    join(configDir, "repos", "opencode-loader", "core-loader", "dist", "tui.js"),
    join(homedir(), ".cache", "opencode", "packages", "opencode-loader@latest", "node_modules", "opencode-loader", "core-loader", "dist", "tui.js"),
    join(pluginDir, "..", "core", "dist", "tui.js"),
    join(configDir, "repos", "opencode-loader", "core", "dist", "tui.js"),
    join(homedir(), ".cache", "opencode", "packages", "opencode-loader@latest", "node_modules", "opencode-loader", "core", "dist", "tui.js"),
  ];
  const cliCandidates = tuiCandidates.map((p) => p.replace(/tui\.js$/, "cli.js"));
  // the loader's own custom Providers tab (auto-discovers all installed providers)
  const extPath = join(configDir, "repos", "opencode-loader", "dist", "tui-extension.js");
  writeLog(configDir, "Installing oc wrapper with runtime TUI resolution");

  if (process.platform === "win32") {
    const cmdPath = join(binDir, "oc.cmd");
    const cmdLines = ["@echo off", "setlocal", `set "HUB_TUI_EXTENSION=${extPath}"`, 'set "HUB_CONFIG_DIR=%USERPROFILE%\\.config\\opencode"'];
    cmdLines.push('set "_iscli="');
    for (const sub of ["plugins", "providers", "proxy", "doctor"]) cmdLines.push(`if "%1"=="${sub}" set "_iscli=1"`);
    for (const candidate of cliCandidates) cmdLines.push(`if defined _iscli if exist "${candidate}" ( node "${candidate}" %* & exit /b %errorlevel% )`);
    for (const candidate of tuiCandidates) {
      cmdLines.push(`if exist "${candidate}" ( bun run "${candidate}" %* & exit /b %errorlevel% )`);
    }
    cmdLines.push("opencode %*");
    writeFileSync(cmdPath, cmdLines.join("\r\n") + "\r\n", "utf-8");
    try { const fs = require("fs"); fs.unlinkSync(join(binDir, "oc")); } catch {}
  } else {
    const shPath = join(binDir, "oc");
    const lines = [
      "#!/usr/bin/env bash",
      'export PATH="$HOME/.bun/bin:$PATH"',
      `export HUB_TUI_EXTENSION="${extPath}"`,
      // tell core-auth (loaded via each provider's handler) which app home we're in, so
      // its model refresh writes opencode.json instead of falling back to ~/.claude
      'export HUB_CONFIG_DIR="$HOME/.config/opencode"',
      'TUI=""',
      "for candidate in \\",
      ...tuiCandidates.map((candidate, index) =>
        `  "${candidate}"${index < tuiCandidates.length - 1 ? " \\" : "; do"}`),
      '  if [ -f "$candidate" ]; then TUI="$candidate"; break; fi',
      "done",
      'case "$1" in',
      '  plugins|providers|proxy|doctor)',
      "    for c in \\",
      ...cliCandidates.map((candidate, index) =>
        `      "${candidate}"${index < cliCandidates.length - 1 ? " \\" : "; do"}`),
      '      if [ -f "$c" ] && command -v node >/dev/null 2>&1; then exec node "$c" "$@"; fi',
      "    done ;;",
      "esac",
      'if [ -z "$TUI" ] || ! command -v bun >/dev/null 2>&1; then exec opencode "$@"; fi',
      'export OC_OUTPUT="${TEMP:-${TMPDIR:-/tmp}}/oc-dir-$$.txt"',
      'bun run "$TUI" "$@"',
      "EXIT=$?",
      'if [ $EXIT -eq 42 ]; then',
      '  rm -f "$OC_OUTPUT"',
      '  exec opencode "$@"',
      "fi",
      'if [ $EXIT -eq 0 ] && [ -f "$OC_OUTPUT" ]; then',
      '  DIR=$(cat "$OC_OUTPUT")',
      '  rm -f "$OC_OUTPUT"',
      '  if [ -n "$DIR" ]; then cd "$DIR" && exec opencode; fi',
      "fi",
      'rm -f "$OC_OUTPUT"',
      "exit $EXIT",
    ];
    writeFileSync(shPath, lines.join("\n") + "\n", { mode: 0o755 });
    try { require("child_process").execSync(`chmod +x "${shPath}"`); } catch {}
    try { const fs = require("fs"); fs.unlinkSync(join(binDir, "oc.cmd")); } catch {}
  }

  writeLog(configDir, "oc wrapper installed successfully");
}

export async function cleanup(configDir?: string) {
  // opencode invokes every exported function as a plugin hook, passing a context
  // object — return an inert plugin instance then, and only clean up when
  // plugin-updater calls us with an explicit configDir string
  if (typeof configDir !== "string") return {};
  const resolvedConfigDir = configDir;
  const binDir = getBinDir();
  const filesToRemove = [join(binDir, "oc"), join(binDir, "oc.cmd")];
  for (const f of filesToRemove) {
    try {
      if (existsSync(f)) {
        const { unlinkSync } = await import("fs");
        unlinkSync(f);
        writeLog(resolvedConfigDir, "cleanup: removed " + f);
      }
    } catch (e) {
      // already gone (race / broken symlink) is the desired end state, not an error
      if (e && e.code === "ENOENT") continue;
      writeLog(resolvedConfigDir, "cleanup: failed to remove " + f + ": " + e, true);
    }
  }
}

export async function activate() {
  const configDir = getAppConfigDir();
  writeLog(configDir, "OpenCode Loader activating");

  try {
    await runEarlyLaunchHooks(configDir);
  } catch (e) {
    writeLog(configDir, "Failed during earlyLaunch hooks: " + e, true);
  }

  try {
    installOcWrapper(configDir);
  } catch (e) {
    writeLog(configDir, "Failed to install oc wrapper: " + e, true);
  }

  try {
    deployLoaderCommands(configDir);
  } catch (e) {
    writeLog(configDir, "Failed to deploy loader commands: " + e, true);
  }

  writeLog(configDir, "OpenCode Loader activation complete");
  return {};
}
