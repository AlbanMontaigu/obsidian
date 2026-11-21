import { test } from "node:test";
import assert from "node:assert/strict";
import { compareItems, compareNames, filterTags, tagNode } from "../src/explore.ts";

const vault = new Map<string, string[]>([
  ["Taxes/2024[tax].pdf", ["tax"]],
  ["Taxes/2025[tax receipt].pdf", ["tax", "receipt"]],
  ["notes/plan.md", ["tax", "plan"]],
  ["Projects", ["client"]],
  ["photo.jpg", []],
]);
const tagsOf = (p: string): string[] => vault.get(p) ?? [];
const node = (trail: string[], paths: Iterable<string> = vault.keys()) => tagNode(paths, tagsOf, trail);

test("tagNode: the root holds every tag, counted per item, in name order, and no item", () => {
  const root = node([]);
  assert.deepEqual(root.tags, [["client", 1], ["plan", 1], ["receipt", 1], ["tax", 3]]);
  assert.deepEqual(root.items, []);
});

test("tagNode: a tag's branches are the tags found with it; its items carry no other tag", () => {
  const tax = node(["tax"]);
  assert.deepEqual(tax.tags, [["plan", 1], ["receipt", 1]]);
  assert.deepEqual(tax.items, ["Taxes/2024[tax].pdf"]);
  assert.deepEqual(tax.paths, ["Taxes/2024[tax].pdf", "Taxes/2025[tax receipt].pdf", "notes/plan.md"]);
  assert.deepEqual(node(["client"]).items, ["Projects"]);
});

test("tagNode: an item with several tags sits at the end of each path made of them", () => {
  assert.deepEqual(node(["tax", "receipt"]), { paths: ["Taxes/2025[tax receipt].pdf"], tags: [], items: ["Taxes/2025[tax receipt].pdf"] });
  assert.deepEqual(node(["receipt", "tax"]).items, ["Taxes/2025[tax receipt].pdf"]);
  assert.deepEqual(node(["receipt"]).items, []);
});

test("tagNode: from the parent's paths, the same node as from the whole vault", () => {
  assert.deepEqual(node(["tax", "plan"], node(["tax"]).paths), node(["tax", "plan"]));
  assert.deepEqual(node(["client", "tax"]), { paths: [], tags: [], items: [] });
});

test("compareNames: case-insensitive, numbers by value, stable on ties", () => {
  assert.deepEqual(["b", "file10", "A", "file2", "Éte", "ete"].sort(compareNames), ["A", "b", "ete", "Éte", "file2", "file10"]);
});

test("compareItems: folders first, then by name", () => {
  const items = [
    { name: "a.md", folder: false },
    { name: "Zeta", folder: true },
    { name: "beta", folder: true },
  ];
  assert.deepEqual(items.sort(compareItems).map((i) => i.name), ["beta", "Zeta", "a.md"]);
});

test("filterTags: the tags containing the query, case and accents ignored, order kept; empty = all", () => {
  const tags: [string, number][] = [["Été", 2], ["receipt", 1], ["tax", 3], ["Taxes", 1]];
  assert.deepEqual(filterTags(tags, " TAX "), [["tax", 3], ["Taxes", 1]]);
  assert.deepEqual(filterTags(tags, "ete"), [["Été", 2]]);
  assert.deepEqual(filterTags(tags, "eip"), [["receipt", 1]]);
  assert.deepEqual(filterTags(tags, "zzz"), []);
  assert.deepEqual(filterTags(tags, "  "), tags);
});
