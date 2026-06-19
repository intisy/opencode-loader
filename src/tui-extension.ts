// @ts-nocheck
// Loader-owned "Providers" tab (loaded via HUB_TUI_EXTENSION). Fully GENERIC:
// it knows nothing about any specific provider. It auto-discovers providers from
// each installed plugin's package.json claudeHub declaration, lists their models
// from opencode.json, and edits the "Auto" meta-model purely from the generic
// metadata core-auth writes (core-auth-models.json: { models:{id:{name,group}},
// ranking:[id] } + core-auth.json auto config). No provider names, prefixes, or
// model-quality knowledge live here.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function configDir() { return process.env.HUB_CONFIG_DIR || join(homedir(), ".config", "opencode"); }
function cfgFolder() { return join(configDir(), "config"); }
function reposDir() { return join(configDir(), "repos"); }
function readJSON(p, fallback) { try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { return fallback; } }
function writeJSON(p, obj) { try { if (!existsSync(cfgFolder())) mkdirSync(cfgFolder(), { recursive: true }); writeFileSync(p, JSON.stringify(obj, null, 2), "utf8"); } catch (e) {} }

function modelsCache() { return readJSON(join(cfgFolder(), "core-auth-models.json"), {}); }
function coreConfig() { return readJSON(join(cfgFolder(), "core-auth.json"), {}); }
function saveCoreConfig(cfg) { writeJSON(join(cfgFolder(), "core-auth.json"), cfg); }
function opencodeConfigPath() { return join(configDir(), existsSync(join(configDir(), "opencode.jsonc")) ? "opencode.jsonc" : "opencode.json"); }
function opencodeModels(pid) {
  var c = readJSON(opencodeConfigPath(), {});
  var m = (c.provider && c.provider[pid] && c.provider[pid].models) || {};
  return Object.keys(m).map(function (id) { return { id: id, name: (m[id] && m[id].name) || id }; });
}

// Discover providers from every installed plugin's package.json (zero per-provider
// code), unioned with whatever the model cache already knows.
function providerIds() {
  var ids = [];
  var repos = [];
  try { repos = readdirSync(reposDir()); } catch (e) {}
  for (var i = 0; i < repos.length; i++) {
    var pkg = readJSON(join(reposDir(), repos[i], "package.json"), null);
    var declared = (pkg && pkg.claudeHub && pkg.claudeHub.authProviders) || (pkg && pkg.authProviders) || [];
    for (var j = 0; j < declared.length; j++) { var id = declared[j] && (declared[j].name || repos[i]); if (id && ids.indexOf(id) < 0) ids.push(id); }
  }
  var cache = modelsCache();
  for (var k of Object.keys(cache)) if (ids.indexOf(k) < 0) ids.push(k);
  return ids;
}

function catalogModels(pid) { var e = modelsCache()[pid]; return (e && e.models) || {}; }
function ranking(pid) { var e = modelsCache()[pid]; return (e && e.ranking) || []; }
function hasAuto(pid) { return ranking(pid).length > 0; }
function modelCount(pid) { return opencodeModels(pid).length; }
function nameOf(pid, id) { var m = catalogModels(pid)[id]; return (m && m.name) || id; }
function groupOf(pid, id) { var m = catalogModels(pid)[id]; return (m && m.group) || ""; }

// Available sort sources: always Manual, plus whatever the provider advertised
// in the cache (recommended/leaderboard/custom). Orders are precomputed by core.
function autoSources(pid) { var e = modelsCache()[pid]; var extra = (e && Array.isArray(e.sorts)) ? e.sorts : []; return [{ id: "manual", label: "Manual" }].concat(extra); }

function autoConfig(pid) {
  var stored = ((coreConfig().auto || {})[pid]) || {};
  var e = modelsCache()[pid] || {};
  var cat = e.ranking || [];
  var sortOrders = e.sortOrders || {};
  function reconcile(ids) { var out = (Array.isArray(ids) ? ids : []).filter(function (id) { return cat.indexOf(id) >= 0; }); cat.forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); }); return out; }
  var sources = autoSources(pid);
  var valid = sources.map(function (s) { return s.id; });
  var source = (stored.source && valid.indexOf(stored.source) >= 0) ? stored.source : "manual";
  var order = source === "manual" ? reconcile(stored.order && stored.order.length ? stored.order : cat) : reconcile(sortOrders[source] || cat);
  var excluded = (Array.isArray(stored.excluded) ? stored.excluded : []).filter(function (id) { return cat.indexOf(id) >= 0; });
  return { order: order, excluded: excluded, source: source, sources: sources };
}
function setAuto(pid, patch) {
  var cfg = coreConfig(); cfg.auto = cfg.auto || {}; var prev = cfg.auto[pid] || {};
  cfg.auto[pid] = {
    order: patch.order !== undefined ? patch.order : (prev.order || []),
    excluded: patch.excluded !== undefined ? patch.excluded : (prev.excluded || []),
    source: patch.source !== undefined ? patch.source : (prev.source || "manual"),
    leaderboardOrder: patch.leaderboardOrder !== undefined ? patch.leaderboardOrder : (prev.leaderboardOrder || []),
  };
  saveCoreConfig(cfg);
}

// non-ranked models that opted into a display group (e.g. a separate pool)
function groupedExtras(pid) {
  var rank = ranking(pid); var models = catalogModels(pid);
  var order = []; var byGroup = {};
  Object.keys(models).forEach(function (id) {
    if (rank.indexOf(id) >= 0) return;
    var g = models[id] && models[id].group;
    if (!g) return;   // ungrouped non-ranked (e.g. the Auto pseudo-model) stays hidden
    if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
    byGroup[g].push(id);
  });
  return { order: order, byGroup: byGroup };
}

var tab = { mode: "providers", pcur: 0, cur: 0, pid: null };

function render(state, h) {
  if (tab.mode === "auto" && tab.pid) {
    var ac = autoConfig(tab.pid);
    h.pushBody("", false);
    h.pushBody("  " + h.BOLD + h.WHITE + tab.pid + h.RST + h.GRAY + " — Auto" + h.RST, false);
    h.pushBody("", false);
    var srcSel = tab.cur === 0;
    var cur = ac.sources.filter(function (s) { return s.id === ac.source; })[0] || { label: ac.source };
    h.pushBody("  " + (srcSel ? h.YELLOW + "> " : "  ") + (srcSel ? h.BG_SEL + h.BOLD + h.WHITE : h.CYAN) + "Sort: " + cur.label + h.RST + (srcSel && ac.sources.length > 1 ? h.DIM + "   (Enter/r to change)" + h.RST : ""), srcSel);
    h.pushBody("  " + h.DIM + (ac.source === "manual" ? "Tries top-to-bottom, skipping rate-limited models. u/d reorders." : "Order is automatic (" + cur.label + "). Toggle include/exclude per model.") + h.RST, false);
    h.pushBody("", false);
    ac.order.forEach(function (id, i) {
      var sel = tab.cur === i + 1;
      var inc = ac.excluded.indexOf(id) < 0;
      var box = (inc ? h.GREEN + "[x]" : h.DIM + "[ ]") + h.RST;
      var nm = nameOf(tab.pid, id);
      var label = sel ? (h.BG_SEL + h.BOLD + h.WHITE + nm + h.RST) : ((inc ? h.GRAY : h.DIM) + (i + 1) + ". " + nm + h.RST);
      h.pushBody("  " + (sel ? h.YELLOW + "> " + h.RST : "  ") + box + " " + label, sel);
    });
    var ex = groupedExtras(tab.pid);
    ex.order.forEach(function (g) {
      h.pushBody("", false);
      h.pushBody("  " + h.DIM + g + h.RST, false);   // group label is provider-supplied, shown verbatim
      ex.byGroup[g].forEach(function (id) { h.pushBody("    " + h.DIM + "· " + nameOf(tab.pid, id) + h.RST, false); });
    });
    h.pushFoot("  " + h.GRAY + "-".repeat(h.barW) + h.RST);
    h.pushFoot("  " + h.DIM + "^v Move   Enter/r Source   Space Toggle   u/d Reorder   Esc Back" + h.RST);
    return;
  }
  if (tab.mode === "browse" && tab.pid) {
    var ms = opencodeModels(tab.pid);
    h.pushBody("", false);
    h.pushBody("  " + h.BOLD + h.WHITE + tab.pid + h.RST + h.GRAY + " — Models (" + ms.length + ")" + h.RST, false);
    h.pushBody("  " + h.DIM + "This provider has no Auto ranking; models are listed for reference." + h.RST, false);
    h.pushBody("", false);
    if (!ms.length) h.pushBody("    " + h.DIM + "No models — sign in with oc auth login." + h.RST, false);
    ms.forEach(function (m, i) {
      var sel = tab.cur === i;
      h.pushBody("  " + (sel ? h.YELLOW + "> " + h.RST : "  ") + (sel ? h.BG_SEL + h.BOLD + h.WHITE : h.GRAY) + m.name + h.RST + h.DIM + "  " + m.id + h.RST, sel);
    });
    h.pushFoot("  " + h.GRAY + "-".repeat(h.barW) + h.RST);
    h.pushFoot("  " + h.DIM + "^v Move   Esc Back" + h.RST);
    return;
  }
  var pids = providerIds();
  h.pushBody("", false);
  h.pushBody("  " + h.BOLD + h.WHITE + "Providers" + h.RST + h.GRAY + " (" + pids.length + ")" + h.RST, false);
  h.pushBody("", false);
  if (!pids.length) h.pushBody("    " + h.DIM + "No providers installed." + h.RST, false);
  pids.forEach(function (pid, i) {
    var sel = tab.pcur === i;
    var count = modelCount(pid);
    h.pushBody("  " + (sel ? h.YELLOW + "> " + h.RST : "  ") + (sel ? h.BG_SEL + h.BOLD + h.WHITE : h.GRAY) + pid + h.RST + h.DIM + "  " + (count ? count + " models" : "no models yet") + h.RST, sel);
  });
  h.pushFoot("  " + h.GRAY + "-".repeat(h.barW) + h.RST);
  h.pushFoot("  " + h.DIM + "^v Move   Enter Configure   Tab Switch   Q Quit" + h.RST);
}

function handleKey(key, state, tuiApi) {
  if (tab.mode === "auto" && tab.pid) {
    var ac = autoConfig(tab.pid);
    var rows = ac.order.length + 1;
    if (key === "escape" || key === "q") { tab.mode = "providers"; tab.cur = 0; return; }
    if (key === "up" || key === "w") { tab.cur = (tab.cur - 1 + rows) % rows; return; }
    if (key === "down" || key === "s") { tab.cur = (tab.cur + 1) % rows; return; }
    if (tab.cur === 0) {
      if ((key === "r" || key === "enter" || key === "space") && ac.sources.length > 1) {
        var i = 0; for (var s = 0; s < ac.sources.length; s++) if (ac.sources[s].id === ac.source) i = s;
        var next = ac.sources[(i + 1) % ac.sources.length];
        setAuto(tab.pid, { source: next.id });   // orders are precomputed by core
        if (tuiApi && tuiApi.flash) tuiApi.flash("Sort: " + next.label);
      }
      return;
    }
    var idx = tab.cur - 1; var id = ac.order[idx];
    if (!id) return;
    if (key === "space" || key === "enter") {
      var exc = ac.excluded.slice(); var at = exc.indexOf(id);
      if (at >= 0) exc.splice(at, 1); else exc.push(id);
      setAuto(tab.pid, { excluded: exc }); return;
    }
    if ((key === "u" || key === "[") && ac.source === "manual" && idx > 0) { var up = ac.order.slice(); var t = up[idx - 1]; up[idx - 1] = up[idx]; up[idx] = t; setAuto(tab.pid, { order: up }); tab.cur--; return; }
    if ((key === "d" || key === "]") && ac.source === "manual" && idx < ac.order.length - 1) { var dn = ac.order.slice(); var t2 = dn[idx + 1]; dn[idx + 1] = dn[idx]; dn[idx] = t2; setAuto(tab.pid, { order: dn }); tab.cur++; return; }
    return;
  }
  if (tab.mode === "browse" && tab.pid) {
    var n = Math.max(1, opencodeModels(tab.pid).length);
    if (key === "escape" || key === "q") { tab.mode = "providers"; tab.cur = 0; return; }
    if (key === "up" || key === "w") { tab.cur = (tab.cur - 1 + n) % n; return; }
    if (key === "down" || key === "s") { tab.cur = (tab.cur + 1) % n; return; }
    return;
  }
  var pids = providerIds();
  if (!pids.length) return;
  if (key === "up" || key === "w") { tab.pcur = (tab.pcur - 1 + pids.length) % pids.length; return; }
  if (key === "down" || key === "s") { tab.pcur = (tab.pcur + 1) % pids.length; return; }
  if (key === "enter" || key === "space") { var pid = pids[tab.pcur]; tab.pid = pid; tab.mode = hasAuto(pid) ? "auto" : "browse"; tab.cur = 0; return; }
}

export default function (tuiApi) {
  tuiApi.registerTab({ id: "providers", label: "Providers", render: render, handleKey: handleKey });
}
