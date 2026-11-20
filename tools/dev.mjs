// npm run dev -- <name> [--vault <path|name>] [--no-deploy]
// Rebuilds on every save and, unless --no-deploy, copies the result into the vault.
// Install the "Hot Reload" community plugin in that vault to have Obsidian reload it automatically.
import { parseArgs, resolveVault, selectPlugins } from "./lib.mjs";
import { context } from "./esbuild.mjs";
import { deploy } from "./deploy.mjs";

const args = parseArgs();
const plugins = selectPlugins(args);
const vault = args.flags["no-deploy"] ? null : resolveVault(args.flags);

for (const plugin of plugins) {
  const ctx = await context(plugin, {
    production: false,
    onBuilt: () => {
      if (vault) deploy(plugin, vault, { quiet: true });
    },
  });
  await ctx.watch();
}
console.log(`watching ${plugins.map((p) => p.name).join(", ")}${vault ? ` -> ${vault}` : ""}  (Ctrl+C to stop)`);
