// npm run undeploy -- <name> [--vault <path|name>]
// Moves <vault>/.obsidian/plugins/<id> (settings included) to backups/. Disable the plugin in Obsidian first.
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { BACKUPS_DIR, enabledPlugins, parseArgs, resolveVault, selectPlugins, stamp, vaultPluginDir } from "./lib.mjs";

const args = parseArgs();
const vault = resolveVault(args.flags);
for (const plugin of selectPlugins(args)) {
  const target = vaultPluginDir(vault, plugin.manifest.id);
  if (!existsSync(target)) {
    console.log(`${plugin.name}: not installed in ${vault}`);
    continue;
  }
  if (enabledPlugins(vault).includes(plugin.manifest.id)) console.warn(`${plugin.name}: still enabled in Obsidian; disable it there too.`);
  const backup = join(BACKUPS_DIR, `${plugin.name}-${stamp()}-removed`);
  cpSync(target, backup, { recursive: true });
  rmSync(target, { recursive: true, force: true });
  console.log(`${plugin.name}: removed from ${vault} (copy in ${backup})`);
}
