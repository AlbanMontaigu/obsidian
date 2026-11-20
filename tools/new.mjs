// npm run new -- <id> [--name "Display name"] [--description "..."]
// Copies templates/plugin to plugins/<id> and fills in the placeholders.
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGINS_DIR, TEMPLATE_DIR, fail, parseArgs } from "./lib.mjs";

const { flags, positionals } = parseArgs();
const id = positionals[0];
if (!id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fail('Usage: npm run new -- <id> --name "Display name"   (id: lower-case words joined by -)');
if (/obsidian/i.test(id)) fail('Obsidian rejects plugin ids containing "obsidian".');
const dir = join(PLUGINS_DIR, id);
if (existsSync(dir)) fail(`plugins/${id} already exists.`);

const name = typeof flags.name === "string" ? flags.name : id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
const values = {
  __ID__: id,
  __NAME__: name,
  __CLASS__: name.replace(/[^A-Za-z0-9]/g, "") + "Plugin",
  __DESCRIPTION__: typeof flags.description === "string" ? flags.description : `${name}.`,
};

cpSync(TEMPLATE_DIR, dir, { recursive: true });
for (const rel of readdirSync(dir, { recursive: true })) {
  const file = join(dir, String(rel));
  if (!/\.(ts|js|mjs|json|css|md)$/.test(file)) continue;
  let text = readFileSync(file, "utf8");
  for (const [k, v] of Object.entries(values)) text = text.split(k).join(v);
  writeFileSync(file, text);
}
console.log(`Created plugins/${id}. Next: npm run dev -- ${id}`);
