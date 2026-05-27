import { tool } from "@opencode-ai/plugin";
import { existsSync, writeFileSync, mkdirSync, unlinkSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

// ---------------------------------------------------------------------------
// Find core/tui.js — works for both npm and plugin-updater installs
// ---------------------------------------------------------------------------

  function findTuiScript() {
    // 1. Same directory as this plugin file (npm install case)
    var sameDirPath = join(__dirname, "core/tui.js");
    if (existsSync(sameDirPath)) return sameDirPath;
  
    // 2. Find config dir, then check repos/intisy/opencode-hub/ (updater case)
    var configDir = findConfigDir(__dirname);
  if (configDir) {
    var repoPath = join(configDir, "repos", "intisy", "opencode-hub", "core/tui.js");
    if (existsSync(repoPath)) return repoPath;
  }

  return null;
}

function findConfigDir(start) {
  var dir = start;
  for (var i = 0; i < 8; i++) {
    if (existsSync(join(dir, "opencode.json"))) return dir;
    if (existsSync(join(dir, "config", "plugins.json"))) return dir;
    var parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Install / remove the `oc` shell command
// ---------------------------------------------------------------------------

function getBinDir() {
  if (process.platform === "win32") {
    return join(homedir(), ".local", "bin");
  }
  return join(homedir(), ".local", "bin");
}

function installOcCommand() {
  var tuiPath = findTuiScript();
  if (!tuiPath) return;

  var binDir = getBinDir();
  if (!existsSync(binDir)) try { mkdirSync(binDir, { recursive: true }); } catch {}

  // Always keep binDir/core/tui.js in sync with the source (so `oc` always runs latest)
  var binTuiPath = join(binDir, "core/tui.js");
  try {
    var srcContent = readFileSync(tuiPath, "utf-8");
    
    // Inject auth login interception specific to opencode
    srcContent = srcContent.replace(
      'process.on("SIGTERM", function() { cleanup(); process.exit(1); });',
      'process.on("SIGTERM", function() { cleanup(); process.exit(1); });\n\n// --- INJECTED AUTH LOGIN INTERCEPTION ---\nif (process.argv[2] === "auth" && process.argv[3] === "login") {\n  var _code = require("child_process").spawnSync(process.argv[0], [require("path").join(__dirname, "..", "oc-auth.js")], { stdio: "inherit" }).status;\n  if (_code !== 42) process.exit(0);\n}\n// ----------------------------------------\n'
    );

    var dstContent = existsSync(binTuiPath) ? readFileSync(binTuiPath, "utf-8") : null;
    if (srcContent !== dstContent) {
      writeFileSync(binTuiPath, srcContent, "utf-8");
    }
  } catch {}
  // Point shell launchers at the stable binDir copy
  tuiPath = binTuiPath;

  var tuiPathEscaped = tuiPath.replace(/\\/g, "\\\\");

  if (process.platform === "win32") {
    // oc.cmd for Windows
    var cmdPath = join(binDir, "oc.cmd");
    var cmdContent = '@echo off\r\n'
      + 'set "tmp=%TEMP%\\oc-output-%RANDOM%.tmp"\r\n'
      + 'set "OC_OUTPUT=%tmp%"\r\n'
      + 'bun "' + tuiPath + '" %*\r\n'
      + 'set /p dir=<"%tmp%" 2>nul\r\n'
      + 'del "%tmp%" 2>nul\r\n'
      + 'if defined dir (\r\n'
      + '  cd /d "%dir%" && opencode\r\n'
      + ')\r\n';
    try { writeFileSync(cmdPath, cmdContent, "utf-8"); } catch {}
  } else {
    // oc for Unix
    var shPath = join(binDir, "oc");
    var shContent = '#!/bin/sh\n'
      + 'tmp=$(mktemp)\n'
      + 'OC_OUTPUT="$tmp" bun "' + tuiPathEscaped + '" "$@"\n'
      + 'dir=$(cat "$tmp" 2>/dev/null)\n'
      + 'rm -f "$tmp"\n'
      + 'if [ -n "$dir" ]; then\n'
      + '  cd "$dir" && opencode\n'
      + 'fi\n';
    try {
      writeFileSync(shPath, shContent, { mode: 0o755 });
    } catch {}
  }
}

function removeOcCommand() {
  var binDir = getBinDir();
  var files = ["oc", "oc.cmd"];
  var removed = [];
  for (var f of files) {
    var p = join(binDir, f);
    if (existsSync(p)) {
      try { unlinkSync(p); removed.push(f); } catch {}
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Install on load (with guard against dual execution)
// ---------------------------------------------------------------------------

if (!globalThis.__ocLauncherInstalled) {
  globalThis.__ocLauncherInstalled = true;
  installOcCommand();
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export default async function OpenCodeLauncher(ctx) {
  return {
    tool: {
      oc_remove: tool({
        description:
          "Remove the oc launcher command. Deletes oc, oc.cmd from ~/.local/bin. The launcher will be reinstalled on next opencode start if the plugin is still active.",
        args: {
          _placeholder: tool.schema.boolean().describe("Placeholder. Always pass true."),
        },
        async execute() {
          var removed = removeOcCommand();
          if (removed.length === 0) return "No oc commands found to remove.";
          return "Removed: " + removed.join(", ") + " from " + getBinDir();
        },
      }),
    },
  };
}
