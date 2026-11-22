// Shared helpers for the plugin tools. Plain Node >= 22, only dependency: esbuild.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGINS_DIR = join(ROOT, "plugins");
export const DIST_DIR = join(ROOT, "dist");
export const BACKUPS_DIR = join(ROOT, "backups");
export const TEMPLATE_DIR = join(ROOT, "templates", "plugin");

/** What Obsidian loads from `.obsidian/plugins/<id>/`. */
export const RELEASE_FILES = ["main.js", "manifest.json", "styles.css"];

export function fail(message) {
  console.error(message);
  process.exit(1);
}

/** `--vault X` / `--all` / `--watch` style flags; everything else is a positional. */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) positionals.push(a);
    else if (a.includes("=")) flags[a.slice(2, a.indexOf("="))] = a.slice(a.indexOf("=") + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") && VALUE_FLAGS.has(a.slice(2))) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return { flags, positionals };
}
const VALUE_FLAGS = new Set(["vault", "name", "description", "port", "timeout", "script", "only"]);

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

export function pluginNames() {
  if (!existsSync(PLUGINS_DIR)) return [];
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PLUGINS_DIR, e.name, "manifest.json")))
    .map((e) => e.name)
    .sort();
}

/** Loads plugins/<name>, checking the conventions every tool relies on. */
export function loadPlugin(name) {
  const dir = join(PLUGINS_DIR, name);
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) fail(`Unknown plugin "${name}". Known: ${pluginNames().join(", ") || "(none)"}`);
  const manifest = readJson(manifestPath);
  for (const key of ["id", "name", "version", "minAppVersion", "description", "author"]) {
    if (!manifest[key]) fail(`${name}/manifest.json: "${key}" is missing`);
  }
  if (manifest.id !== name) fail(`${name}/manifest.json: id is "${manifest.id}", must equal the folder name "${name}"`);
  if (/obsidian/i.test(manifest.id)) fail(`${name}: Obsidian rejects plugin ids containing "obsidian"`);
  const entry = join(dir, "src", "main.ts");
  if (!existsSync(entry)) fail(`${name}: src/main.ts is missing`);
  return {
    name,
    dir,
    manifest,
    entry,
    styles: existsSync(join(dir, "styles.css")) ? join(dir, "styles.css") : null,
    testsDir: existsSync(join(dir, "tests")) ? join(dir, "tests") : null,
    outDir: join(DIST_DIR, name),
  };
}

/** Plugins named on the command line, or all of them with --all / when `defaultAll`. */
export function selectPlugins({ flags, positionals }, { defaultAll = false } = {}) {
  const names = flags.all || (defaultAll && !positionals.length) ? pluginNames() : positionals;
  if (!names.length) fail(`Name a plugin (or --all). Known: ${pluginNames().join(", ") || "(none)"}`);
  return names.map(loadPlugin);
}

// ------------------------------------------------------------------ vaults

function obsidianConfig() {
  const cfg = join(process.env.APPDATA ?? "", "obsidian", "obsidian.json");
  return existsSync(cfg) ? readJson(cfg) : null;
}

/** Every vault Obsidian knows about, the open one first. */
export function knownVaults() {
  const vaults = Object.values(obsidianConfig()?.vaults ?? {});
  return vaults.sort((a, b) => Number(!!b.open) - Number(!!a.open)).map((v) => v.path);
}

/** --vault <path|folder name>  >  OBSIDIAN_VAULT  >  the vault Obsidian has open. */
export function resolveVault(flags = {}) {
  const wanted = typeof flags.vault === "string" ? flags.vault : process.env.OBSIDIAN_VAULT;
  let vault = wanted;
  if (wanted && !existsSync(join(wanted, ".obsidian"))) {
    vault = knownVaults().find((v) => v.replace(/[\\/]+$/, "").split(/[\\/]/).pop()?.toLowerCase() === wanted.toLowerCase());
  }
  vault ??= knownVaults()[0];
  if (!vault || !existsSync(join(vault, ".obsidian"))) {
    fail(
      `No Obsidian vault found${wanted ? ` for "${wanted}"` : ""}. Use --vault "C:\\path\\to\\vault" or set OBSIDIAN_VAULT.\n` +
        `Known vaults: ${knownVaults().join(" | ") || "(none)"}`,
    );
  }
  return vault;
}

export function vaultPluginDir(vault, id) {
  return join(vault, ".obsidian", "plugins", id);
}

export function enabledPlugins(vault) {
  const file = join(vault, ".obsidian", "community-plugins.json");
  try {
    return existsSync(file) ? readJson(file) : [];
  } catch {
    return [];
  }
}

export function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}
