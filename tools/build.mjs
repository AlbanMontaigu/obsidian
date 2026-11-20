// npm run build -- <name...> | --all      type-check (all plugins at once) then bundle into dist/<name>
// --no-check skips tsc.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, fail, parseArgs, selectPlugins } from "./lib.mjs";
import { buildOnce } from "./esbuild.mjs";

const args = parseArgs();
const plugins = selectPlugins(args, { defaultAll: true });

if (!args.flags["no-check"]) {
  const tsc = spawnSync(process.execPath, [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", ROOT], { stdio: "inherit" });
  if (tsc.status !== 0) fail("Type check failed (npm run typecheck for details, --no-check to bundle anyway).");
}

let failed = 0;
for (const plugin of plugins) if (!(await buildOnce(plugin))) failed++;
if (failed) fail(`${failed} plugin(s) failed to build.`);
