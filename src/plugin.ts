import { existsSync, writeFileSync, mkdirSync, readFileSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath, pathToFileURL } from "url";
// @ts-ignore — generated bundle, no .d.ts
import { maybeRunCli, deployLoaderCommands } from "./commands.js";
// @ts-ignore — generated bundle, no .d.ts
import { makeWriteLog, defineConfig } from "../core/dist/index.js";

// Slash-command invocations shell in as `node <this file> <action>`; handle them
// first and exit, so command/config runs never go through plugin activation.
// Register config defaults BEFORE the CLI guard so `config schema` sees them (no write).
defineConfig("opencode-loader", { logging: true });

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
  // the loader's own custom Providers tab (auto-discovers all installed providers)
  const extPath = join(configDir, "repos", "opencode-loader", "dist", "tui-extension.js");
  writeLog(configDir, "Installing oc wrapper with runtime TUI resolution");

  if (process.platform === "win32") {
    const cmdPath = join(binDir, "oc.cmd");
    const cmdLines = ["@echo off", "setlocal", `set "HUB_TUI_EXTENSION=${extPath}"`, 'set "HUB_CONFIG_DIR=%USERPROFILE%\\.config\\opencode"'];
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
      writeLog(resolvedConfigDir, "cleanup: failed to remove " + f + ": " + e, true);
    }
  }
}

// Condense the /config command's output into a single toast line. For set/get we echo
// the arguments (the action is what matters); for a bare list we summarize the count.
function summarizeConfig(partsText: string, args: string): string {
  const a = String(args || "").trim();
  const lines = String(partsText || "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (/\b(set|get)\b/.test(a)) {
    const last = lines[lines.length - 1];
    return last && /=/.test(last) ? last : (a ? "config " + a : "config updated");
  }
  if (lines.length === 1) return lines[0];
  if (lines.length > 1) return "config: " + lines.length + " lines — use `/config <target> set <key> <value>`";
  return a ? "config " + a : "config";
}

// opencode invokes the plugin's export with { client, $, ... } and uses the returned
// hooks. We register command.execute.before so the /config command shows its result as
// a bottom TUI toast instead of a chat message — and we ONLY suppress the model turn
// when the toast actually displayed (showToast returns false headless), so `opencode
// run` keeps the plain text fallback. Claude Code has no toast API, so this is opencode-only.
export async function activate(input?: any) {
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

  const client = input && input.client;
  if (!client || !client.tui || typeof client.tui.showToast !== "function") return {};
  return {
    "command.execute.before": async (cmdInput: any, output: any) => {
      if (!cmdInput || cmdInput.command !== "config") return;
      let shown = false;
      try {
        const partsText = ((output && output.parts) || []).map((p: any) => (p && p.text) || "").join("");
        const message = summarizeConfig(partsText, cmdInput.arguments);
        shown = (await client.tui.showToast({ body: { message, variant: "success" } })) === true;
      } catch (e) {
        writeLog(configDir, "config toast hook failed: " + e, true);
      }
      // Emptying output.parts only blanks the prompt — opencode still runs the model turn
      // (it "answers nothing"). The only way to actually SKIP the turn is to throw, which
      // aborts before the model is called. Throw ONLY when the toast displayed (TUI
      // present), so headless `opencode run` / Claude Code keep the plain text fallback.
      if (shown) throw new Error("config shown as toast");
    },
  };
}
