import { test } from "node:test";
import assert from "node:assert/strict";
import { TAG_PALETTE, autoColor, autoColorIndex, colorKey } from "../src/colors.ts";

test("autoColor is stable and comes from the theme palette", () => {
  assert.equal(autoColor("projet"), autoColor("projet"));
  assert.ok(TAG_PALETTE.includes(autoColor("projet")));
  assert.match(autoColor("x"), /^var\(--color-[a-z]+\)$/);
});

test("autoColor ignores case and #, and nested tags share their root colour", () => {
  assert.equal(colorKey("#Proj/Alpha"), "proj");
  assert.equal(autoColor("Projet"), autoColor("projet"));
  assert.equal(autoColor("proj/alpha"), autoColor("proj/beta"));
  assert.equal(autoColor("proj/alpha"), autoColor("proj"));
});

test("autoColor spreads ordinary tags over the whole palette", () => {
  const tags = ["projet", "client", "réunion", "facture", "B27", "INC", "urgent", "archive", "perso", "idée", "brouillon",
    "draft", "final", "tax", "receipt", "IMAC", "legacy", "shared", "q3", "2026", "alpha", "beta", "gamma", "delta"];
  const used = new Set(tags.map((t) => autoColorIndex(t)));
  assert.ok(used.size >= 6, `only ${used.size} colours used for ${tags.length} tags`);
  // no colour takes more than a third of the tags
  const counts = new Map<number, number>();
  for (const t of tags) counts.set(autoColorIndex(t), (counts.get(autoColorIndex(t)) ?? 0) + 1);
  assert.ok(Math.max(...counts.values()) <= tags.length / 3, JSON.stringify([...counts]));
});
