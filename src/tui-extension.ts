// @ts-nocheck
// Loader-owned "Providers" tab (HUB_TUI_EXTENSION). Generic + thin: discovers
// providers from each plugin's package.json claudeHub declaration, and on Enter
// renders that provider's MENU MODEL (its handler's menuModel() export = core-auth
// buildAccountMenu) natively, inside the loader chrome/style. The model + all its
// logic live in core-auth (shared with `oc auth login`); this only draws it.
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function configDir() { return process.env.HUB_CONFIG_DIR || join(homedir(), ".config", "opencode"); }
function reposDir() { return join(configDir(), "repos"); }
function readJSON(p, fallback) { try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { return fallback; } }
function modelsCache() { const d = join(configDir(), "config"); return readJSON(join(d, "models.json"), null) || readJSON(join(d, "core-auth-models.json"), {}); }
function opencodeConfigPath() { return join(configDir(), existsSync(join(configDir(), "opencode.jsonc")) ? "opencode.jsonc" : "opencode.json"); }
function modelCount(pid) { var c = readJSON(opencodeConfigPath(), {}); return Object.keys((c.provider && c.provider[pid] && c.provider[pid].models) || {}).length; }

function providers() {
  var out = [], seen = {}, repos = [];
  try { repos = readdirSync(reposDir()); } catch (e) {}
  for (var i = 0; i < repos.length; i++) {
    var pkg = readJSON(join(reposDir(), repos[i], "package.json"), null);
    var declared = (pkg && pkg.claudeHub && pkg.claudeHub.authProviders) || (pkg && pkg.authProviders) || [];
    for (var j = 0; j < declared.length; j++) {
      var id = declared[j] && (declared[j].name || repos[i]);
      if (!id || seen[id]) continue; seen[id] = 1;
      out.push({ id: id, handler: declared[j].handler ? join(reposDir(), repos[i], declared[j].handler) : null });
    }
  }
  for (var k of Object.keys(modelsCache())) if (!seen[k]) { seen[k] = 1; out.push({ id: k, handler: null }); }
  return out;
}

// tab state: provider list, or an in-tab menu (a stack of model builders)
var tab = { mode: "providers", cur: 0, stack: [], input: null, inputBuf: "" };

function curMenu() { return tab.stack.length ? tab.stack[tab.stack.length - 1]() : null; }
function selectableIdx(items, from, dir) {
  var n = items.length; if (!n) return 0;
  for (var s = 1; s <= n; s++) { var i = ((from + dir * s) % n + n) % n; if (items[i] && typeof items[i].run === "function") return i; }
  return from;
}
function exitMenu(tuiApi) { tab.mode = "providers"; tab.stack = []; tab.cur = 0; if (tuiApi && tuiApi.setTextInput) tuiApi.setTextInput(false); }
function applyAction(a, tuiApi) {
  if (!a) return;
  if (a.input) {
    tab.input = a.input; tab.inputBuf = "";   // collect a line of text in-tab
    var inp = a.input;
    if (inp.background) {
      // loopback auto-capture: if the browser completes the login while this paste
      // field is still showing, apply it and drop the field (no paste needed)
      inp.background.then(function (act) {
        if (tab.input === inp && act) { tab.input = null; applyAction(act, tuiApi); if (tuiApi && tuiApi.refresh) tuiApi.refresh(); }
      }).catch(function () {});
    }
    return;
  }
  if (a.push) { tab.stack.push(a.push); var m = curMenu(); tab.cur = m ? selectableIdx(m.items, -1, 1) : 0; }
  else if (a.pop) { if (tab.stack.length > 1) { tab.stack.pop(); tab.cur = 0; } else exitMenu(tuiApi); }
  else if (a.close) exitMenu(tuiApi);
  // refresh / void: stay (render rebuilds)
}

function openProvider(p, tuiApi) {
  if (!p.handler || !existsSync(p.handler)) { try { tuiApi.flash("No menu for " + p.id); } catch (e) {} return; }
  if (!tuiApi.runBlocking || !tuiApi.setTextInput) { try { tuiApi.flash("Loader too old — update to manage providers"); } catch (e) {} return; }
  tuiApi.runBlocking(async function () {
    try {
      var mod = await import(p.handler);
      if (typeof mod.menuModel === "function") { tab.stack = [mod.menuModel]; var m = curMenu(); tab.cur = m ? selectableIdx(m.items, -1, 1) : 0; tab.mode = "menu"; tuiApi.setTextInput(true); }
      else if (typeof mod.menu === "function") await mod.menu();   // fallback: provider has no model, use its own menu
      else process.stdout.write(p.id + " has no menu.\n");
    } catch (e) { process.stdout.write("Menu failed: " + (e && e.message || e) + "\n"); }
  });
}

function render(state, h) {
  if (tab.mode === "menu" && tab.input) {
    h.pushBody("  " + h.BOLD + h.WHITE + "" + (tab.input.title || "Input") + h.RST, false);
    if (tab.input.message) String(tab.input.message).split("\n").forEach(function (line) { h.pushBody("  " + h.DIM + line + h.RST, false); });
    h.pushBody("", false);
    if (tab.input.pending) {
      // complete() is in flight (e.g. a slow token exchange) — show progress in
      // place of the field instead of closing the menu and surfacing the result later
      h.pushBody("  " + h.ACCENT + (tab.input.pendingLabel || "Working…") + h.RST, false);
      h.pushFoot("  " + h.GRAY + "─".repeat(h.barW) + h.RST);
      h.pushFoot("  " + h.DIM + "Please wait…" + h.RST);
      return;
    }
    h.pushBody("  " + h.ACCENT + "❯ " + h.RST + h.WHITE + (tab.inputBuf || "") + h.RST + h.DIM + "_" + h.RST, false);
    h.pushFoot("  " + h.GRAY + "─".repeat(h.barW) + h.RST);
    h.pushFoot("  " + h.DIM + "Paste, then Enter   Esc Cancel" + h.RST);
    return;
  }
  if (tab.mode === "menu") {
    var menu = curMenu();
    if (!menu) { exitMenu(); }
    else {
      h.pushBody("  " + h.BOLD + h.WHITE + "" + (menu.title || "Menu") + h.RST, false);
      if (menu.subtitle) h.pushBody("  " + h.DIM + menu.subtitle + h.RST, false);
      h.pushBody("", false);
      menu.items.forEach(function (it, i) {
        if (it.separator) { h.pushBody("", false); return; }
        if (it.kind === "heading") { h.pushBody("  " + h.BOLD + h.WHITE + "" + it.label + h.RST, false); return; }
        var sel = i === tab.cur;
        // match the loader's row style: 3-space gutter / " > ", BG_SEL when selected
        var gutter = sel ? (h.ACCENT + " ❯ " + h.RST) : "   ";
        var body = sel ? (h.BG_SEL + h.BOLD + h.WHITE) : (it.color === "red" ? h.RED : h.GRAY);
        h.pushBody("  " + gutter + body + it.label + h.RST + (it.hint ? h.DIM + "  " + it.hint + h.RST : ""), sel);
      });
      h.pushFoot("  " + h.GRAY + "─".repeat(h.barW) + h.RST);
      h.pushFoot("  " + h.DIM + "^v Move   Enter Select   Esc Back" + h.RST);
      return;
    }
  }
  var ps = providers();
  h.pushBody("  " + h.BOLD + h.WHITE + "Providers" + h.RST + h.GRAY + " (" + ps.length + ")" + h.RST, false);
  h.pushBody("", false);
  if (!ps.length) h.pushBody("    " + h.DIM + "No providers installed." + h.RST, false);
  ps.forEach(function (p, i) {
    var sel = tab.cur === i; var c = modelCount(p.id);
    h.pushBody("  " + (sel ? h.ACCENT + "❯ " + h.RST : "  ") + (sel ? h.BG_SEL + h.BOLD + h.WHITE : h.GRAY) + p.id + h.RST + h.DIM + "  " + (c ? c + " models" : "no models yet") + h.RST, sel);
  });
  h.pushFoot("  " + h.GRAY + "─".repeat(h.barW) + h.RST);
  h.pushFoot("  " + h.DIM + "^v Move   Enter Configure (accounts + Auto)   Tab Switch   Q Quit" + h.RST);
}

function handleKey(key, state, tuiApi) {
  if (tab.mode === "menu" && tab.input) {
    if (tab.input.pending) return;   // complete() in flight — ignore keys until it settles
    if (key === "escape") { var inpE = tab.input; tab.input = null; if (inpE.onClose) { try { inpE.onClose(); } catch (e) {} } return; }   // cancel + release listener
    if (key === "enter") {
      // run complete() live (no suspend) and keep the field showing progress until it
      // resolves — closing instantly made the account appear ~15s later with no feedback
      var inp = tab.input, buf = tab.inputBuf || ""; inp.pending = true; tab.inputBuf = ""; if (tuiApi.refresh) tuiApi.refresh();
      Promise.resolve(inp.complete(buf)).then(function (a) { if (tab.input === inp) tab.input = null; if (inp.onClose) { try { inp.onClose(); } catch (e) {} } applyAction(a, tuiApi); if (tuiApi.refresh) tuiApi.refresh(); }).catch(function (e) { if (tab.input === inp) tab.input = null; try { tuiApi.flash(String(e && e.message || e)); } catch (x) {} if (tuiApi.refresh) tuiApi.refresh(); });
      return;
    }
    if (key === "backspace") { tab.inputBuf = (tab.inputBuf || "").slice(0, -1); return; }
    if (key === "up" || key === "down" || key === "left" || key === "right" || key === "tab") return;  // ignore nav keys
    if (typeof key === "string") { tab.inputBuf = (tab.inputBuf || "") + key; return; }    // printable / paste
    return;
  }
  if (tab.mode === "menu") {
    var menu = curMenu();
    if (!menu) { exitMenu(tuiApi); return; }
    if (key === "escape") { applyAction({ pop: true }, tuiApi); return; }
    if (key === "up" || key === "w") { tab.cur = selectableIdx(menu.items, tab.cur, -1); return; }
    if (key === "down" || key === "s") { tab.cur = selectableIdx(menu.items, tab.cur, 1); return; }
    if (key === "enter") {
      var item = menu.items[tab.cur];
      if (!item || typeof item.run !== "function") return;
      var r; try { r = item.run(); } catch (e) { return; }
      if (r && typeof r.then === "function") {
        if (item.suspend) {
          // suspend items (provider login(), proxy pickers, confirm) need a clean terminal
          tuiApi.runBlocking(async function () { try { applyAction(await r, tuiApi); } catch (e) { process.stdout.write(String(e) + "\n"); } });
        } else {
          // async non-suspend (e.g. building an in-tab login input) resolves live, in chrome
          r.then(function (a) { applyAction(a, tuiApi); if (tuiApi.refresh) tuiApi.refresh(); }).catch(function (e) { try { tuiApi.flash(String(e && e.message || e)); } catch (x) {} if (tuiApi.refresh) tuiApi.refresh(); });
        }
      } else applyAction(r, tuiApi);
      return;
    }
    return;
  }
  var ps = providers();
  if (!ps.length) return;
  if (key === "up" || key === "w") { tab.cur = (tab.cur - 1 + ps.length) % ps.length; return; }
  if (key === "down" || key === "s") { tab.cur = (tab.cur + 1) % ps.length; return; }
  if (key === "enter" || key === "space") { openProvider(ps[tab.cur], tuiApi); return; }
}

export default function (tuiApi) {
  tuiApi.registerTab({ id: "providers", label: "Providers", render: render, handleKey: handleKey });
}
