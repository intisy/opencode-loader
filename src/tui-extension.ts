// @ts-nocheck
// Loader-owned "Providers" tab (loaded via HUB_TUI_EXTENSION). Fully GENERIC and
// thin: it auto-discovers providers from each installed plugin's package.json
// claudeHub declaration, shows their model counts, and on Enter SUSPENDS the
// loader TUI and runs that provider's shared menu() export — the exact same
// core-auth menu (accounts + "Configure Auto models") that `oc auth login` opens.
// No config/editor logic is duplicated here.
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function configDir() { return process.env.HUB_CONFIG_DIR || join(homedir(), ".config", "opencode"); }
function reposDir() { return join(configDir(), "repos"); }
function readJSON(p, fallback) { try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { return fallback; } }

function modelsCache() { return readJSON(join(configDir(), "config", "core-auth-models.json"), {}); }
function opencodeConfigPath() { return join(configDir(), existsSync(join(configDir(), "opencode.jsonc")) ? "opencode.jsonc" : "opencode.json"); }
function modelCount(pid) {
  var c = readJSON(opencodeConfigPath(), {});
  return Object.keys((c.provider && c.provider[pid] && c.provider[pid].models) || {}).length;
}

// Discover every installed provider from its package.json (zero per-provider code),
// unioned with the model cache. Returns [{ id, handler }] (handler may be null).
function providers() {
  var out = []; var seen = {};
  var repos = [];
  try { repos = readdirSync(reposDir()); } catch (e) {}
  for (var i = 0; i < repos.length; i++) {
    var pkg = readJSON(join(reposDir(), repos[i], "package.json"), null);
    var declared = (pkg && pkg.claudeHub && pkg.claudeHub.authProviders) || (pkg && pkg.authProviders) || [];
    for (var j = 0; j < declared.length; j++) {
      var id = declared[j] && (declared[j].name || repos[i]);
      if (!id || seen[id]) continue;
      seen[id] = 1;
      out.push({ id: id, handler: declared[j].handler ? join(reposDir(), repos[i], declared[j].handler) : null });
    }
  }
  for (var k of Object.keys(modelsCache())) if (!seen[k]) { seen[k] = 1; out.push({ id: k, handler: null }); }
  return out;
}

// suspend the loader TUI and run the provider's shared menu() — the same core-auth
// menu `oc auth login` uses (accounts + Configure Auto models).
function openProviderMenu(p, tuiApi) {
  if (!p.handler || !existsSync(p.handler)) { try { tuiApi.flash("No menu for " + p.id); } catch (e) {} return; }
  if (!tuiApi.runBlocking) { try { tuiApi.flash("Loader too old — update to manage providers"); } catch (e) {} return; }
  tuiApi.runBlocking(async function () {
    try {
      var mod = await import(p.handler);
      if (typeof mod.menu === "function") await mod.menu();
      else process.stdout.write(p.id + " has no menu.\n");
    } catch (e) { process.stdout.write("Menu failed: " + (e && e.message || e) + "\n"); }
  });
}

var tab = { cur: 0 };

function render(state, h) {
  var ps = providers();
  h.pushBody("  " + h.BOLD + h.WHITE + "Providers" + h.RST + h.GRAY + " (" + ps.length + ")" + h.RST, false);
  h.pushBody("", false);
  if (!ps.length) h.pushBody("    " + h.DIM + "No providers installed." + h.RST, false);
  ps.forEach(function (p, i) {
    var sel = tab.cur === i;
    var c = modelCount(p.id);
    h.pushBody("  " + (sel ? h.YELLOW + "> " + h.RST : "  ") + (sel ? h.BG_SEL + h.BOLD + h.WHITE : h.GRAY) + p.id + h.RST + h.DIM + "  " + (c ? c + " models" : "no models yet") + h.RST, sel);
  });
  h.pushFoot("  " + h.GRAY + "-".repeat(h.barW) + h.RST);
  h.pushFoot("  " + h.DIM + "^v Move   Enter Configure (accounts + Auto)   Tab Switch   Q Quit" + h.RST);
}

function handleKey(key, state, tuiApi) {
  var ps = providers();
  if (!ps.length) return;
  if (key === "up" || key === "w") { tab.cur = (tab.cur - 1 + ps.length) % ps.length; return; }
  if (key === "down" || key === "s") { tab.cur = (tab.cur + 1) % ps.length; return; }
  if (key === "enter" || key === "space") { openProviderMenu(ps[tab.cur], tuiApi); return; }
}

export default function (tuiApi) {
  tuiApi.registerTab({ id: "providers", label: "Providers", render: render, handleKey: handleKey });
}
