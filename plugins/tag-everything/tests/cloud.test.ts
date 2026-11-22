import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudWeight, cloudWeights, inCountRange, narrowingTags, parseBound, rangeText } from "../src/cloud.ts";

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

test("narrowingTags: on some items but not all, not in the search, most used first", () => {
  const counts = new Map([["pdf", 4], ["client", 1], ["tax", 2], ["q3", 2], ["done", 0], ["work", 3]]);
  assert.deepEqual(narrowingTags(counts, 4, ["work"]), [["q3", 2], ["tax", 2], ["client", 1]]);
  assert.deepEqual(narrowingTags(counts, 1, []), [], "one item: nothing narrows it");
});

test("inCountRange: bounds included, 0 = no upper limit, off shows everything", () => {
  const r = { on: true, min: 10, max: 100 };
  assert.deepEqual([9, 10, 50, 100, 101].map((n) => inCountRange(n, r)), [false, true, true, true, false]);
  assert.equal(inCountRange(5000, { on: true, min: 10, max: 0 }), true, "no upper limit");
  assert.equal(inCountRange(3, { on: true, min: 10, max: 0 }), false);
  assert.equal(inCountRange(1, { ...r, on: false }), true, "off");
  assert.equal(inCountRange(50, { on: true, min: 100, max: 10 }), true, "a max under the min is read the other way round");
});

test("rangeText: min–max, min+ without an upper limit", () => {
  assert.equal(rangeText({ on: true, min: 10, max: 100 }), "10–100");
  assert.equal(rangeText({ on: false, min: 2, max: 0 }), "2+");
  assert.equal(rangeText({ on: true, min: 100, max: 10 }), "10–100");
});

test("parseBound: whole numbers, min at least 1, an empty or 0 max = no limit, the rest unreadable", () => {
  assert.equal(parseBound(" 10 ", "min"), 10);
  assert.equal(parseBound("100", "max"), 100);
  assert.equal(parseBound("", "max"), 0);
  assert.equal(parseBound("0", "max"), 0);
  assert.equal(parseBound("", "min"), null);
  assert.equal(parseBound("0", "min"), null);
  for (const bad of ["-3", "2.5", "1e3", "ten", "12345678"]) assert.equal(parseBound(bad, "max"), null, bad);
});
