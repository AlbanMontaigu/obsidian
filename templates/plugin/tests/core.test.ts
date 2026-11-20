import { test } from "node:test";
import assert from "node:assert/strict";
import { greeting } from "../src/core.ts";

test("greeting falls back to world", () => {
  assert.equal(greeting("Ada"), "Hello, Ada!");
  assert.equal(greeting("  "), "Hello, world!");
});
