// esbuild settings shared by every plugin: src/main.ts -> dist/<name>/main.js (+ manifest.json, styles.css).
import esbuild from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const EXTERNAL = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
];

function copyAssets(plugin) {
  copyFileSync(join(plugin.dir, "manifest.json"), join(plugin.outDir, "manifest.json"));
  if (plugin.styles) copyFileSync(plugin.styles, join(plugin.outDir, "styles.css"));
}

/** `onBuilt` runs after every successful (re)build, e.g. to deploy in watch mode. */
export async function context(plugin, { production, onBuilt } = {}) {
  rmSync(plugin.outDir, { recursive: true, force: true });
  mkdirSync(plugin.outDir, { recursive: true });
  return esbuild.context({
    entryPoints: [plugin.entry],
    outfile: join(plugin.outDir, "main.js"),
    bundle: true,
    external: EXTERNAL,
    format: "cjs",
    target: "es2022",
    platform: "browser",
    logLevel: "warning",
    sourcemap: production ? false : "inline",
    minify: false,
    treeShaking: true,
    plugins: [
      {
        name: "obsidian-assets",
        setup(build) {
          build.onEnd(async (result) => {
            if (result.errors.length) return;
            copyAssets(plugin);
            console.log(`[${new Date().toLocaleTimeString()}] built ${plugin.name} ${plugin.manifest.version} -> dist/${plugin.name}`);
            await onBuilt?.();
          });
        },
      },
    ],
  });
}

export async function buildOnce(plugin, options = {}) {
  const ctx = await context(plugin, { production: true, ...options });
  try {
    const result = await ctx.rebuild();
    return result.errors.length === 0;
  } catch {
    return false; // esbuild already printed the errors
  } finally {
    await ctx.dispose();
  }
}
