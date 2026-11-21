import { test } from "node:test";
import assert from "node:assert/strict";
import { type GuideInput, claudeGuide, guidePath, hasGuide, tagList } from "../src/guide.ts";

const base: GuideInput = {
  folder: "Clients/B27",
  storage: "filename",
  noteTagsInFrontmatter: true,
  tagRule: true,
  lowercase: false,
  stopWords: "de, la  the",
  folderTags: new Map([["b27", 4], ["inc", 1]]),
  vaultTags: new Map([["tax", 2], ["b27", 9], ["alpha", 2]]),
  date: "2026-11-21",
};

test("guidePath and hasGuide: root, folder, any case", () => {
  assert.equal(guidePath(""), "CLAUDE.md");
  assert.equal(guidePath("/"), "CLAUDE.md");
  assert.equal(guidePath("Clients/B27"), "Clients/B27/CLAUDE.md");
  assert.equal(hasGuide(["a.md", "claude.md"]), true);
  assert.equal(hasGuide(["a.md", "CLAUDE.md.bak", "CLAUDE"]), false);
});

test("tagList: most used first, ties by name, capped with the rest counted", () => {
  assert.equal(tagList(new Map()), "none yet.");
  assert.equal(tagList(base.vaultTags), "`b27` 9 · `alpha` 2 · `tax` 2");
  assert.equal(tagList(base.vaultTags, 2), "`b27` 9 · `alpha` 2 …and 1 more (list them as above).");
});

test("claudeGuide: folder and vault tags, date, settings as they are", () => {
  const g = claudeGuide(base);
  assert.match(g, /^# Tags in this vault\n/);
  assert.match(g, /Written on 2026-11-21/);
  assert.match(g, /## Tags used in `Clients\/B27`[^\n]*\n\n`b27` 4 · `inc` 1\n/);
  assert.match(g, /## Most used tags in the vault[^\n]*\n\n`b27` 9 · `alpha` 2 · `tax` 2\n/);
  assert.match(g, /\| Markdown note \| the frontmatter `tags` property \|/);
  assert.match(g, /\| Any other file \| the file name, in a `\[\.\.\.\]` group \|/);
  assert.match(g, /Liaison words:\n  de la the\./);
  assert.match(g, /Rename `report\.pdf` → `report\[tax receipt\]\.pdf`/);
  assert.match(g, /does \*\*not\*\* update links/);
});

test("claudeGuide: vault root has no folder section", () => {
  const g = claudeGuide({ ...base, folder: "" });
  assert.doesNotMatch(g, /## Tags used in/);
  assert.match(g, /## Most used tags in the vault/);
});

test("claudeGuide: sidecar storage, notes like other files, rule off", () => {
  const g = claudeGuide({ ...base, storage: "sidecar", noteTagsInFrontmatter: false, tagRule: false, lowercase: true });
  assert.match(g, /\| Markdown note \| a sidecar `<folder>\/\.ts\/<file name>\.json` \|/);
  assert.match(g, /\| Any other file \| a sidecar/);
  assert.match(g, /Markdown note\*\*: like any other file/);
  assert.match(g, /Write the tags in its sidecar/);
  assert.doesNotMatch(g, /Rename `report\.pdf`/);
  assert.doesNotMatch(g, /Naming rule/);
  assert.match(g, /No naming rule is enforced, but new tags are lower-case/);
});
