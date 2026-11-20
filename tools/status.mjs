// npm run status [-- --vault <path|name>]   source / built / installed versions and whether the vault copy is current.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_FILES, enabledPlugins, loadPlugin, parseArgs, pluginNames, readJson, resolveVault, vaultPluginDir } from "./lib.mjs";

const { flags } = parseArgs();
const vault = resolveVault(flags);
const enabled = enabledPlugins(vault);

function versionAt(dir) {
  try {
    return readJson(join(dir, "manifest.json")).version;
  } catch {
    return "-";
  }
}

function sameFiles(a, b) {
  return RELEASE_FILES.every((f) => {
    const x = join(a, f);
    const y = join(b, f);
    if (!existsSync(x) && !existsSync(y)) return true;
    return existsSync(x) && existsSync(y) && readFileSync(x).equals(readFileSync(y));
  });
}

const rows = pluginNames().map((name) => {
  const p = loadPlugin(name);
  const installed = vaultPluginDir(vault, p.manifest.id);
  const built = existsSync(join(p.outDir, "main.js"));
  const isInstalled = existsSync(join(installed, "main.js"));
  return {
    plugin: name,
    source: p.manifest.version,
    built: built ? versionAt(p.outDir) : "-",
    installed: isInstalled ? versionAt(installed) : "-",
    current: built && isInstalled ? (sameFiles(p.outDir, installed) ? "yes" : "NO") : "-",
    enabled: enabled.includes(p.manifest.id) ? "yes" : "no",
  };
});

console.log(`vault: ${vault}`);
if (rows.length) console.table(rows);
else console.log("No plugins yet: npm run new -- <id> --name \"Display name\"");
