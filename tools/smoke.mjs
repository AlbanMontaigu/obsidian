// npm run smoke -- <id> [--keep] [--no-build] [--port 9334] [--timeout 60] [--script <name>]
//
// Loads a plugin in a REAL Obsidian, isolated from your own: a throwaway profile (--user-data-dir) and a
// throwaway vault in %TEMP%, both deleted afterwards. Your vaults, settings and running Obsidian are never
// touched. Steps:
//   1. build dist/<id>; create the temp vault from plugins/<id>/tests/fixtures/vault (or a single note);
//   2. start Obsidian with --remote-debugging-port and drive it over the Chrome DevTools Protocol;
//   3. turn off Restricted mode, enable the plugin, fail on load errors;
//   4. run plugins/<id>/tests/smoke.js in the page, if present (see docs/testing.md); --script gallery runs
//      tests/gallery.js instead. In the script, `await snap("name")` saves dist/<id>-name.png at that point;
//   5. screenshot to dist/<id>-smoke.png (the app as smoke.js left it: open a modal / view last to see it)
//      and print every console error / warning / exception. Unexpected errors fail the run.
// Exit code 0 = PASS. --keep leaves the temp folder (path printed) for inspection.
import { execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIST_DIR, RELEASE_FILES, fail, parseArgs, selectPlugins } from "./lib.mjs";
import { buildOnce } from "./esbuild.mjs";

const OBSIDIAN_EXE = process.env.OBSIDIAN_EXE ?? join(process.env.LOCALAPPDATA ?? "", "Programs", "obsidian", "Obsidian.exe");
const VAULT_ID = "smoke0000000001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = parseArgs();
const [plugin] = selectPlugins(args);
const port = Number(args.flags.port ?? 9334);
const timeoutS = Number(args.flags.timeout ?? 60);
if (!existsSync(OBSIDIAN_EXE)) fail(`Obsidian not found at ${OBSIDIAN_EXE} (set OBSIDIAN_EXE).`);
if (!args.flags["no-build"] && !(await buildOnce(plugin))) fail("Build failed.");

// ---------------------------------------------------------------- throwaway profile + vault
const work = mkdtempSync(join(tmpdir(), `obsidian-smoke-${plugin.name}-`));
const userData = join(work, "profile");
const vault = join(work, "vault");
const fixture = join(plugin.dir, "tests", "fixtures", "vault");
if (existsSync(fixture)) cpSync(fixture, vault, { recursive: true });
else {
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, "Welcome.md"), "# Smoke test vault\n");
}
const dotObsidian = join(vault, ".obsidian");
const pluginDir = join(dotObsidian, "plugins", plugin.manifest.id);
mkdirSync(pluginDir, { recursive: true });
for (const f of RELEASE_FILES) if (existsSync(join(plugin.outDir, f))) cpSync(join(plugin.outDir, f), join(pluginDir, f));
writeFileSync(join(dotObsidian, "community-plugins.json"), JSON.stringify([plugin.manifest.id]));
const appJson = join(dotObsidian, "app.json");
if (!existsSync(appJson)) writeFileSync(appJson, JSON.stringify({ showUnsupportedFiles: true }));
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "obsidian.json"), JSON.stringify({ vaults: { [VAULT_ID]: { path: vault, ts: Date.now(), open: true } } }));

// ---------------------------------------------------------------- CDP
async function pageTargets() {
  try {
    return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page");
  } catch {
    return [];
  }
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === "Runtime.consoleAPICalled" && /error|warn/.test(m.params.type)) {
      logs.push(`console.${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 400));
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      logs.push("EXCEPTION: " + String(d.exception?.description ?? d.text).slice(0, 600));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  /** Evaluates an async expression in the page; returns { value } or { error }. */
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    const exc = r.result?.exceptionDetails;
    if (exc) return { error: String(exc.exception?.description ?? exc.text) };
    return { value: r.result?.result?.value };
  };
  return { ws, send, evaluate, logs };
}

async function waitFor(page, expression, seconds, what) {
  for (let i = 0; i < seconds * 2; i++) {
    const r = await page.evaluate(expression);
    if (r.value) return r.value;
    await sleep(500);
  }
  throw new Error(`timed out after ${seconds}s waiting for ${what}`);
}

function killOurs() {
  // Only processes started with our debugging port: never the user's own Obsidian.
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='Obsidian.exe'\\" | ? { $_.CommandLine -match 'remote-debugging-port=${port}' } | % { Stop-Process -Id $_.ProcessId -Force }"`,
      { stdio: "ignore" },
    );
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------- run
const id = JSON.stringify(plugin.manifest.id);
const shot = join(DIST_DIR, `${plugin.name}-smoke.png`);
const smokeScript = join(plugin.dir, "tests", `${args.flags.script ?? "smoke"}.js`);
let pass = false;
console.log(`smoke ${plugin.name}: throwaway Obsidian (profile + vault in ${work})`);
const child = spawn(OBSIDIAN_EXE, [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], { stdio: "ignore", detached: false });

try {
  let target;
  for (let i = 0; i < timeoutS && !target; i++) {
    await sleep(1000);
    target = (await pageTargets()).find((t) => t.url.startsWith("app://"));
  }
  if (!target) throw new Error("Obsidian did not open a window (is port " + port + " in use?)");
  const page = await connect(target);
  await page.send("Runtime.enable");

  await waitFor(page, `!!(window.app && app.workspace && app.workspace.layoutReady)`, timeoutS, "the vault to open");
  const enable = await page.evaluate(`(async () => {
    await app.plugins.setEnable(true);
    const ok = await app.plugins.enablePluginAndSave(${id});
    return { ok: !!ok, loaded: !!app.plugins.plugins[${id}], version: app.plugins.manifests[${id}]?.version, obsidian: navigator.userAgent.match(/obsidian\\/([\\d.]+)/)?.[1] };
  })()`);
  if (enable.error) throw new Error("enabling the plugin threw: " + enable.error);
  const info = enable.value;
  console.log(`  Obsidian ${info.obsidian ?? "?"}, plugin ${plugin.manifest.id} ${info.version ?? "?"}: ${info.loaded ? "loaded" : "NOT loaded"}`);
  if (!info.loaded) throw new Error("plugin did not load (see errors below)");
  // The "Do you trust the author of this vault?" dialog (`.modal.mod-trust-folder`) opens, sometimes seconds later,
  // because the vault ships a plugin. Plugins are already enabled through the API, so close it. While it is
  // pending no other modal opens, not even the plugin's own. Match its class, not its text: the UI follows the OS
  // language ("Faire confiance à l'auteur de ce coffre ?" in French). An observer also closes it if it shows up
  // after smoke.js has started.
  await page.evaluate(`(async () => {
    const closeTrust = () => {
      const m = document.querySelector(".modal.mod-trust-folder");
      if (m) (m.closest(".modal-container") ?? m).querySelector(".modal-close-button, .modal-header-button")?.click(); // 1.15: .modal-header-button
      return !!m;
    };
    new MutationObserver(closeTrust).observe(document.body, { childList: true });
    for (let i = 0; i < 40; i++) {
      if (closeTrust()) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  })()`);
  await sleep(1000);

  let smokeOk = true;
  let expected = [];
  if (existsSync(smokeScript)) {
    const body = readFileSync(smokeScript, "utf8");
    // snap(name) requests: CDP serves them while the script's evaluate is still pending.
    let running = true;
    const snaps = (async () => {
      while (running) {
        const raw = (await page.evaluate("window.__smokeSnap ?? null")).value;
        if (raw) {
          const want = JSON.parse(raw);
          await sleep(300); // let the last render and transitions settle
          let shooter = page;
          if (want.where === "window") {
            const all = await pageTargets();
            const other = all.filter((t) => t.id !== target.id).at(-1); // a pop-out window: about:blank
            shooter = other ? await connect(other) : page;
          }
          const img = await shooter.send("Page.captureScreenshot", { format: "png" });
          if (shooter !== page) shooter.ws.close();
          const file = `${plugin.name}-${want.name.replace(/[^\w-]+/g, "-")}.png`;
          mkdirSync(DIST_DIR, { recursive: true });
          if (img.result?.data) writeFileSync(join(DIST_DIR, file), Buffer.from(img.result.data, "base64"));
          console.log(`  snap: dist/${file}`);
          await page.evaluate("window.__smokeSnap = null");
        } else await sleep(150);
      }
    })();
    const r = await page.evaluate(`(async () => {
      const plugin = app.plugins.plugins[${id}];
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const results = [];
      const expected = [];
      const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail: detail === undefined ? undefined : String(detail) }); };
      const expectError = (re) => { expected.push([re.source, re.flags]); };
      // Screenshot now, as dist/<id>-<name>.png: the runner polls window.__smokeSnap and clears it once saved.
      // snap(name, "window"): the other Obsidian window instead (the settings window, 1.15+).
      const snap = async (name, where = "main") => { window.__smokeSnap = JSON.stringify({ name: String(name), where }); while (window.__smokeSnap) await sleep(100); };
      // Stand-in for obsidian's Menu (not reachable from page scripts): records what addItem() builds.
      // menu.titles() -> ["Edit tags", ...]; menu.click("Edit tags") runs that item's onClick.
      const fakeMenu = () => {
        const items = [];
        const chain = (rec) => new Proxy({}, { get: (_t, key) => (...a) => {
          if (key === "setTitle") rec.title = String(a[0]);
          if (key === "onClick") rec.onClick = a[0];
          if (key === "setSubmenu") return (rec.submenu = fakeMenu());
          return chain(rec);
        } });
        const menu = new Proxy({ items }, { get: (t, key) => {
          if (key === "items") return items;
          if (key === "titles") return () => items.map((i) => i.title);
          if (key === "sub") return (title) => items.find((i) => i.title === title)?.submenu;
          if (key === "click") return (title) => items.find((i) => i.title === title)?.onClick?.(new MouseEvent("click"));
          if (key === "addItem") return (cb) => { const rec = {}; items.push(rec); cb(chain(rec)); return menu; };
          return () => menu;
        } });
        return menu;
      };
      try { await (async () => { ${body}\n })(); }
      catch (e) { results.push({ name: "smoke.js threw", ok: false, detail: String(e && e.stack || e) }); }
      return { results, expected };
    })()`);
    running = false;
    await snaps;
    if (r.error) {
      smokeOk = false;
      console.log("  smoke.js could not run: " + r.error);
    } else {
      const { results } = r.value;
      expected = r.value.expected.map(([source, flags]) => new RegExp(source, flags));
      for (const c of results) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
      smokeOk = results.length > 0 && results.every((c) => c.ok);
      if (!results.length) console.log("  smoke.js made no check() call");
    }
  } else {
    console.log(`  no tests/smoke.js: only checked that the plugin loads`);
  }

  await sleep(800);
  const png = await page.send("Page.captureScreenshot", { format: "png" });
  mkdirSync(DIST_DIR, { recursive: true });
  if (png.result?.data) {
    writeFileSync(shot, Buffer.from(png.result.data, "base64"));
    console.log(`  screenshot: dist/${plugin.name}-smoke.png`);
  }

  const isExpected = (l) => expected.some((re) => re.test(l));
  const errors = page.logs.filter((l) => /EXCEPTION|console\.error/.test(l) && !isExpected(l));
  const shown = page.logs.filter((l) => !isExpected(l));
  if (shown.length) {
    console.log("  --- console errors / warnings ---");
    for (const l of shown) console.log("  " + l);
  }
  if (errors.length) console.log(`  ${errors.length} unexpected console error(s) / exception(s): counted as a failure`);
  pass = smokeOk && errors.length === 0;
  page.ws.close();
} catch (err) {
  console.error("  " + err.message);
} finally {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  killOurs();
  if (args.flags.keep) console.log(`  kept: ${work}`);
  else {
    // Electron helper processes release the profile a few seconds after the window closes.
    let removed = false;
    for (let i = 0; i < 10 && !removed; i++) {
      await sleep(1000);
      try {
        rmSync(work, { recursive: true, force: true });
        removed = true;
      } catch {
        killOurs();
      }
    }
    if (!removed) console.log(`  could not delete ${work} yet (still locked); safe to delete by hand`);
  }
  console.log(pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
}
