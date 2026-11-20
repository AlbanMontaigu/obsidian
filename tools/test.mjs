// npm test [-- <name...>]   runs plugins/<name>/tests/**/*.test.ts with node --test (all plugins by default).
// Tests import pure modules only: the "obsidian" package has no runtime code outside the app.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fail, parseArgs, selectPlugins } from "./lib.mjs";

const plugins = selectPlugins(parseArgs(), { defaultAll: true });
const files = plugins.flatMap((p) =>
  p.testsDir
    ? readdirSync(p.testsDir, { recursive: true })
        .filter((f) => String(f).endsWith(".test.ts"))
        .map((f) => join(p.testsDir, String(f)))
    : [],
);
if (!files.length) {
  console.log(`No tests in ${plugins.map((p) => p.name).join(", ")}.`);
  process.exit(0);
}
const run = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (run.status !== 0) fail("Tests failed.");
