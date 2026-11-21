import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTags } from "../src/ui.ts";

const ranked = ["project", "b27", "proj", "improve", "Prod", "draft"]; // most used first

test("matchTags: prefix matches first, then the others, each in the given order", () => {
  assert.deepEqual(matchTags(ranked, "pro"), ["project", "proj", "Prod", "improve"]);
});

test("matchTags: any case, trimmed; nothing for an empty query", () => {
  assert.deepEqual(matchTags(ranked, "  PROD "), ["Prod"]);
  assert.deepEqual(matchTags(ranked, ""), []);
  assert.deepEqual(matchTags(ranked, "   "), []);
});

test("matchTags: capped", () => {
  const many = Array.from({ length: 80 }, (_, i) => `t${i}`);
  assert.equal(matchTags(many, "t").length, 50);
  assert.equal(matchTags(many, "t", 3).length, 3);
});
