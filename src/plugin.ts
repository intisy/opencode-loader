import { existsSync, writeFileSync, mkdirSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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

function writeLog(configDir: string, message: string, isError: boolean = false) {
  const loggingEnabled = getPluginConfig(configDir).logging !== false;
  try {
    if (loggingEnabled) {
      const date = new Date();
      const dateStr = date.toISOString().split("T")[0];
      const logsDir = join(configDir, "logs", dateStr);
      if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
      const logFile = join(logsDir, `opencode-loader-${START_TIME}.log`);
      const prefix = isError ? "[ERROR]" : "[INFO]";
      const logMsg = "[" + date.toISOString() + "] " + prefix + " " + message + "\n";
      appendFileSync(logFile, logMsg);
    }
  } catch (e) {}
}

function getAppConfigDir() {
  const home = homedir();
  const directPath = join(home, ".opencode");
  const configPath = join(home, ".config", "opencode");
  return existsSync(directPath) ? directPath : configPath;
}

async function runEarlyLaunchHooks(configDir: string) {
  const pluginsJsonPath = join(configDir, "config", "plugins.json");
  if (!existsSync(pluginsJsonPath)) {
    writeLog(configDir, "No plugins.json found at " + pluginsJsonPath);
    return;
  }

  let plugins: any[] = [];
  try {
    plugins = JSON.parse(readFileSync(pluginsJsonPath, "utf-8"));
  } catch (e) {
    writeLog(configDir, "Failed to parse plugins.json: " + e, true);
    return;
  }

  writeLog(configDir, "Found " + plugins.length + " plugins in plugins.json");

  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;

    let mod: any = null;
    const namesToTry = [plugin.name];

    for (const pName of namesToTry) {
      try {
        mod = await import(pName);
        writeLog(configDir, "Loaded " + pName + " via NPM resolution");
        break;
      } catch (e1) {
        const singleFile = join(configDir, "plugin", `${pName}.js`);
        if (existsSync(singleFile)) {
          try {
            mod = await import("file://" + singleFile.replace(/\\/g, "/"));
            writeLog(configDir, "Loaded " + pName + " from single-file plugin");
            break;
          } catch (e) {}
        }
        const dirFile = join(configDir, "plugin", pName, "index.js");
        if (existsSync(dirFile)) {
          try {
            mod = await import("file://" + dirFile.replace(/\\/g, "/"));
            writeLog(configDir, "Loaded " + pName + " from directory plugin");
            break;
          } catch (e) {}
        }
      }
    }

    if (mod) {
      try {
        const p = mod.default || mod;
        if (typeof p.earlyLaunch === "function") {
          writeLog(configDir, "Running earlyLaunch for " + plugin.name);
          await p.earlyLaunch(configDir, plugins);
          writeLog(configDir, "Finished earlyLaunch for " + plugin.name);
        }
      } catch (e) {
        writeLog(configDir, "Failed earlyLaunch for " + plugin.name + ": " + e, true);
      }
    } else {
      writeLog(configDir, "Could not load plugin: " + plugin.name, true);
    }
  }
}

function getBinDir() {
  return join(homedir(), ".local", "bin");
}

function installOcWrapper(configDir: string) {
  const binDir = getBinDir();
  if (!existsSync(binDir)) try { mkdirSync(binDir, { recursive: true }); } catch {}

  const binTuiPath = join(configDir, "repos", "opencode-loader", "core", "dist", "tui.js");
  const hasTui = existsSync(binTuiPath);

  if (hasTui) {
    writeLog(configDir, "Installing oc wrapper with TUI at " + binTuiPath);
  } else {
    writeLog(configDir, "tui.js not found, installing simple passthrough oc wrapper");
  }

  if (process.platform === "win32") {
    const cmdPath = join(binDir, "oc.cmd");
    if (hasTui) {
      const tuiEscaped = binTuiPath.replace(/\\/g, "\\\\");
      writeFileSync(cmdPath, `@echo off\r\nbun run "${tuiEscaped}" %*\r\n`, "utf-8");
    } else {
      writeFileSync(cmdPath, `@echo off\r\nopencode %*\r\n`, "utf-8");
    }
    try { const fs = require("fs"); fs.unlinkSync(join(binDir, "oc")); } catch {}
  } else {
    const shPath = join(binDir, "oc");
    const lines = hasTui
      ? [
          "#!/usr/bin/env bash",
          'export PATH="$HOME/.bun/bin:$PATH"',
          'export OC_OUTPUT="${TEMP:-${TMPDIR:-/tmp}}/oc-dir-$$.txt"',
          `bun run "${binTuiPath}" "$@"`,
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
        ]
      : [
          "#!/usr/bin/env sh",
          'exec opencode "$@"',
        ];
    writeFileSync(shPath, lines.join("\n") + "\n", { mode: 0o755 });
    try { require("child_process").execSync(`chmod +x "${shPath}"`); } catch {}
    try { const fs = require("fs"); fs.unlinkSync(join(binDir, "oc.cmd")); } catch {}
  }

  writeLog(configDir, "oc wrapper installed successfully");
}

export async function activate() {
  const configDir = getAppConfigDir();
  writeLog(configDir, "OpenCode Launcher activating");

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

  writeLog(configDir, "OpenCode Launcher activation complete");
  return {};
}
