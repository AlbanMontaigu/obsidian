// npm run deploy -- <name...> | --all [--vault <path|name>] [--no-build]
// Builds, then copies dist/<name> into <vault>/.obsidian/plugins/<id>. The previous copy goes to backups/ first;
// the plugin's data.json (its saved settings) is never touched.
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BACKUPS_DIR, RELEASE_FILES, enabledPlugins, fail, parseArgs, resolveVault, selectPlugins, stamp, vaultPluginDir } from "./lib.mjs";
import { buildOnce } from "./esbuild.mjs";

export function deploy(plugin, vault, { quiet = false } = {}) {
  const target = vaultPluginDir(vault, plugin.manifest.id);
  if (existsSync(join(target, "main.js"))) {
    const backup = join(BACKUPS_DIR, `${plugin.name}-${stamp()}`);
    cpSync(target, backup, { recursive: true, filter: (src) => !src.endsWith("data.json") });
  }
  mkdirSync(target, { recursive: true });
  for (const f of RELEASE_FILES) {
    const from = join(plugin.outDir, f);
    if (existsSync(from)) copyFileSync(from, join(target, f));
  }
  if (!quiet) {
    console.log(`deployed ${plugin.name} ${plugin.manifest.version} -> ${target}`);
    if (!enabledPlugins(vault).includes(plugin.manifest.id)) {
      console.log("  first time: Settings → Community plugins → enable it (turn off Restricted mode if asked).");
    } else {
      console.log("  reload it: disable + enable in Community plugins, or Ctrl+P → Reload app without saving.");
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs();
  const plugins = selectPlugins(args);
  const vault = resolveVault(args.flags);
  for (const plugin of plugins) {
    if (!args.flags["no-build"] && !(await buildOnce(plugin))) fail(`${plugin.name}: build failed, nothing deployed.`);
    if (!existsSync(join(plugin.outDir, "main.js"))) fail(`${plugin.name}: dist/${plugin.name}/main.js missing, run npm run build first.`);
    deploy(plugin, vault);
  }
}
