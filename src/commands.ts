// @ts-nocheck
// Cross-app slash-commands for opencode-loader. Unlike the bundled plugins, the
// loader is a tsc-compiled package loaded via opencode (not a single file at
// plugin/<name>.js), so its command shells point at the loader's real runtime
// entry (where `../core/dist` resolves) rather than the {{BUNDLE}} convention.
import { join } from "path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { runConfigCli } from "../core/dist/index.js";

const PLUGIN = "opencode-loader";
// opencode reads slash-commands from <configDir>/command/. The loader is
// app-specific, so it deploys ONLY here (not cross-app like the dual plugins),
// otherwise its /plugins + /accounts would collide with claude-code-loader's.
const COMMAND_DIR = "command";

// The loader's runtime entry: prefer the plugin-updater repo build, fall back to
// opencode's package cache. Relative imports (../core/dist) resolve from here.
function loaderEntry(configDir) {
  const candidates = [
    join(configDir, "repos", "opencode-loader", "dist", "plugin.js"),
    join(homedir(), ".cache", "opencode", "packages", "opencode-loader@latest", "node_modules", "opencode-loader", "dist", "plugin.js"),
  ];
  return candidates.find((c) => existsSync(c)) || candidates[0];
}

function commandDefs(entry) {
  const node = `node "${entry}"`;
  return [
    {
      name: "opencode-loader-config",
      description: "View/change opencode-loader configuration",
      argumentHint: "list | get <key> | set <key> <value>",
      shell: `${node} config $ARGUMENTS`,
      body: "Above is the opencode-loader config result. Report it; if the user changed a setting, confirm the new value.",
    },
    {
      name: "plugins",
      description: "List the loader-managed plugins (from plugins.json)",
      shell: `${node} plugins`,
      body: "Above are the installed plugins and their state. Report them.",
    },
    {
      name: "accounts",
      description: "List signed-in accounts across all providers",
      shell: `${node} accounts`,
      body: "Above are the signed-in accounts across every provider. Report them; if none, tell the user to log in (oc auth login).",
    },
  ];
}

// render one command to its markdown file (mirrors core's command renderer, but
// writes to a single app dir since the loader is app-specific).
function render(def) {
  const fm = ["---", `description: ${def.description}`];
  if (def.argumentHint) fm.push(`argument-hint: ${def.argumentHint}`);
  fm.push("---", "");
  const lines = [fm.join("\n")];
  if (def.shell) lines.push("!`" + def.shell + "`", "");
  lines.push(def.body || "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function deployLoaderCommands(configDir) {
  try {
    const dir = join(configDir, COMMAND_DIR);
    mkdirSync(dir, { recursive: true });
    for (const def of commandDefs(loaderEntry(configDir))) {
      writeFileSync(join(dir, `${def.name}.md`), render(def));
    }
  } catch {
    /* best-effort */
  }
}

function listPlugins(configDir) {
  for (const p of [join(configDir, "config", "plugins.json"), join(configDir, "plugins.json")]) {
    if (!existsSync(p)) continue;
    try {
      const arr = JSON.parse(readFileSync(p, "utf8"));
      if (!Array.isArray(arr) || !arr.length) return console.log("No plugins configured.");
      for (const e of arr) console.log(`- ${e.name}${e.enabled === false ? " (disabled)" : ""}${e.sync ? " [sync]" : ""}`);
      return;
    } catch { /* try next */ }
  }
  console.log("No plugins.json found.");
}

function listAccounts(configDir) {
  for (const p of [join(configDir, "config", "core-auth-accounts.json"), join(configDir, "core-auth-accounts.json")]) {
    if (!existsSync(p)) continue;
    try {
      const store = JSON.parse(readFileSync(p, "utf8"));
      const lines = [];
      for (const provider of Object.keys(store)) {
        const accts = Array.isArray(store[provider]) ? store[provider] : (store[provider]?.accounts || []);
        for (const a of accts) lines.push(`- [${provider}] ${a.email || a.id}${a.enabled === false ? " (disabled)" : ""}`);
      }
      return console.log(lines.length ? lines.join("\n") : "No accounts signed in.");
    } catch { /* try next */ }
  }
  console.log("No accounts store found.");
}

// If invoked as `node <loader-entry> <action>`, run the action and return true.
export async function maybeRunCli(configDir) {
  const argv = process.argv.slice(2);
  if (argv[0] === "config") {
    runConfigCli(PLUGIN, argv.slice(1));
    return true;
  }
  if (argv[0] === "plugins") {
    listPlugins(configDir);
    return true;
  }
  if (argv[0] === "accounts") {
    listAccounts(configDir);
    return true;
  }
  return false;
}
