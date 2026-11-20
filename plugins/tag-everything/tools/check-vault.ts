// Read-only check against a real vault: node tools/check-vault.ts "<vault>"
// For every file name holding brackets, rewriting its own tags must give back the same name.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseNameTags, setNameTags } from "../src/format.ts";

const root = process.argv[2];
if (!root) throw new Error("usage: node tools/check-vault.ts <vault>");
let files = 0;
let folders = 0;
let tagged = 0;
const problems: string[] = [];

function walk(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      folders++;
      walk(join(dir, e.name));
      continue;
    }
    files++;
    const tags = parseNameTags(e.name);
    if (!tags.length) continue;
    tagged++;
    try {
      const again = setNameTags(e.name, tags);
      if (again !== e.name) problems.push(`round-trip changed: ${e.name} -> ${again}`);
    } catch (err) {
      problems.push(`${e.name}: ${(err as Error).message}`);
    }
  }
}

walk(root);
console.log(`files=${files} folders=${folders} with-name-tags=${tagged} problems=${problems.length}`);
for (const p of problems.slice(0, 20)) console.log("  " + p);
