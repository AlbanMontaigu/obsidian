import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudWeight, cloudWeights } from "../src/cloud.ts";

test("cloudWeight: bounds", () => {
  assert.equal(cloudWeight(1, 1, 100), 0);
  assert.equal(cloudWeight(100, 1, 100), 1);
  assert.equal(cloudWeight(500, 1, 100), 1, "never above the max");
  assert.equal(cloudWeight(0, 1, 100), 0, "never below the min");
});

test("cloudWeight: all counts equal -> every tag at the base size", () => {
  assert.equal(cloudWeight(7, 7, 7), 0);
  assert.equal(cloudWeight(1, 1, 1), 0);
});

test("cloudWeight: log scale, so mid-used tags are visibly bigger than the rarest", () => {
  // 10 uses out of 1..100 is halfway on a log scale (0.5), not 0.09 as on a linear one.
  assert.equal(cloudWeight(10, 1, 100), 0.5);
  assert.ok(cloudWeight(3, 1, 100) > 0);
});

test("cloudWeight: rounded to a few levels", () => {
  const seen = new Set<number>();
  for (let n = 1; n <= 1000; n++) seen.add(cloudWeight(n, 1, 1000));
  assert.deepEqual([...seen].sort(), [0, 0.25, 0.5, 0.75, 1]);
});

test("cloudWeight: monotonic", () => {
  let prev = -1;
  for (let n = 1; n <= 300; n++) {
    const w = cloudWeight(n, 1, 300);
    assert.ok(w >= prev, `weight went down at ${n}`);
    prev = w;
  }
});

test("cloudWeights: relative to the tags shown", () => {
  const w = cloudWeights(new Map([["a", 40], ["b", 2], ["c", 9]]));
  assert.equal(w.get("a"), 1);
  assert.equal(w.get("b"), 0);
  assert.ok(w.get("c")! > 0 && w.get("c")! < 1);
  assert.equal(cloudWeights(new Map()).size, 0);
  assert.equal(cloudWeights(new Map([["solo", 3]])).get("solo"), 0);
});
