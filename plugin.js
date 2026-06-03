import { tool } from "@opencode-ai/plugin";
import { existsSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ---------------------------------------------------------------------------
// Run Plugin Updater
// ---------------------------------------------------------------------------
async function runUpdater() {
  const updaterPath = join(homedir(), ".config", "github", "plugin-updater", "index.js");
  if (existsSync(updaterPath)) {
    try {
      const updaterModule = await import("file://" + updaterPath.replace(/\\/g, "/"));
      const updater = updaterModule.default || updaterModule;
      
      // Update core-hub
      updater.updatePlugin("core-hub", "https://github.com/intisy/core-hub.git");
      updater.deployToExecutionDir("core-hub", join(homedir(), ".local", "bin"));

      // Update plugins from plugins.json
      const configDir = join(homedir(), ".config", "opencode");
      const pluginsJsonPath = join(configDir, "config", "plugins.json");
      if (existsSync(pluginsJsonPath)) {
        try {
          const plugins = JSON.parse(readFileSync(pluginsJsonPath, "utf-8"));
          for (const plugin of plugins) {
            if (plugin.url && plugin.enabled !== false && plugin.type !== "npm") {
              const branch = plugin.branch || null;
              const commit = plugin.commit || null;
              updater.updatePlugin(plugin.name, plugin.url, branch, commit);
              updater.deployToExecutionDir(plugin.name, join(configDir, "plugin"));
            }
          }
        } catch (e) {
          console.error("[OpenCode Hub] Failed to parse plugins.json", e);
        }
      }
    } catch (e) {
      console.error("[OpenCode Hub] Failed to run plugin-updater", e);
    }
  }
}

// ---------------------------------------------------------------------------
// Install / remove the `oc` shell command
// ---------------------------------------------------------------------------
function getBinDir() {
  return join(homedir(), ".local", "bin");
}

async function installOcCommand() {
  await runUpdater();

  const binDir = getBinDir();
  if (!existsSync(binDir)) try { mkdirSync(binDir, { recursive: true }); } catch {}
  
  const binTuiPath = join(binDir, "core-hub", "tui.js");
  if (!existsSync(binTuiPath)) return; // Wait for updater to succeed next time

  const tuiPathEscaped = binTuiPath.replace(/\\/g, "\\\\");

  if (process.platform === "win32") {
    const cmdPath = join(binDir, "oc.cmd");
    const cmdContent = `@echo off\nnode "${tuiPathEscaped}" %*`;
    writeFileSync(cmdPath, cmdContent, "utf-8");
  } else {
    const shPath = join(binDir, "oc");
    const shContent = `#!/bin/sh\nnode "${tuiPathEscaped}" "$@"`;
    writeFileSync(shPath, shContent, "utf-8");
    try { import("child_process").then(cp => cp.execSync(`chmod +x "${shPath}"`)); } catch {}
  }

  // Add path notice if needed
  if (process.env.PATH && !process.env.PATH.includes(binDir)) {
    console.log(`[OpenCode Hub] Note: Add ${binDir} to your PATH to use the 'oc' command.`);
  }
}

function uninstallOcCommand() {
  const binDir = getBinDir();
  if (process.platform === "win32") {
    try { import("fs").then(fs => fs.unlinkSync(join(binDir, "oc.cmd"))); } catch {}
  } else {
    try { import("fs").then(fs => fs.unlinkSync(join(binDir, "oc"))); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Extension Hook
// ---------------------------------------------------------------------------
export async function activate() {
  try {
    await installOcCommand();
  } catch (err) {
    console.error("[OpenCode Hub] error during activation:", err);
  }
}

export function deactivate() {
  try {
    uninstallOcCommand();
  } catch (err) {
    console.error("[OpenCode Hub] error during deactivation:", err);
  }
}
