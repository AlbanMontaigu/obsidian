import { test } from "node:test";
import assert from "node:assert/strict";
import { Inheritance, folderNameTags, inheriting } from "../src/inherit.ts";
import { makeRule } from "../src/naming.ts";

const rule = makeRule();

test("folder name tags: plain words, lower-cased, ordering prefix and liaison words left out", () => {
  assert.deepEqual(folderNameTags("1. Projects", rule), ["projects"]);
  assert.deepEqual(folderNameTags("02 - Areas", rule), ["areas"]);
  assert.deepEqual(folderNameTags("3_Archives", rule), ["archives"]);
  assert.deepEqual(folderNameTags("B27 Board", rule), ["b27", "board"]);
  assert.deepEqual(folderNameTags("Plan de charge", rule), ["plan", "charge"]);
  assert.deepEqual(folderNameTags("2025", rule), ["2025"]);
  assert.deepEqual(folderNameTags("réunions", rule), ["réunions"]);
  assert.deepEqual(folderNameTags("de", rule), []);
});

/** A tiny tree: folder paths → stored tags. */
function tree(stored: Record<string, string[]>, excluded: string[] = []) {
  return {
    ownOf: (p: string) => stored[p] ?? [],
    nameTagsOf: (name: string) => folderNameTags(name, rule),
    excluded: (p: string) => excluded.some((e) => p === e || p.startsWith(e + "/")),
  };
}

test("inheriting: off unless one option is on", () => {
  assert.equal(inheriting({ inherit: false, folderNames: false }), false);
  assert.equal(inheriting({ inherit: true, folderNames: false }), true);
  assert.equal(inheriting({ inherit: false, folderNames: true }), true);
});

test("inherit: a file gets every folder's stored tags above it, nearest first, each once", () => {
  const inh = new Inheritance({ inherit: true, folderNames: false }, tree({ Work: ["work", "b27"], "Work/B27": ["b27", "board"] }));
  assert.deepEqual(inh.tagsOf("Work/B27/x.pdf", false), ["b27", "board", "work"]);
  assert.deepEqual(inh.tagsOf("Work/B27", true), ["work", "b27"]); // a folder inherits from above, not from itself
  assert.deepEqual(inh.tagsOf("Work", true), []);
  assert.deepEqual(inh.tagsOf("top.md", false), []);
});

test("inherit: the tags the item already stores are left out", () => {
  const inh = new Inheritance({ inherit: true, folderNames: false }, tree({ Work: ["work", "b27"] }));
  assert.deepEqual(inh.tagsOf("Work/x.pdf", false, new Set(["b27"])), ["work"]);
});

test("folder names: a folder carries its name's tags, its contents carry every folder name above them", () => {
  const inh = new Inheritance({ inherit: false, folderNames: true }, tree({ Work: ["stored"] }));
  assert.deepEqual(inh.tagsOf("1. Work/B27 Board", true), ["b27", "board", "work"]);
  assert.deepEqual(inh.tagsOf("1. Work/B27 Board/x.pdf", false), ["b27", "board", "work"]);
  assert.deepEqual(inh.tagsOf("Work/x.pdf", false), ["work"]); // stored folder tags only with `inherit`
});

test("both: names and stored tags pass down together", () => {
  const inh = new Inheritance({ inherit: true, folderNames: true }, tree({ Work: ["client"] }));
  assert.deepEqual(inh.tagsOf("Work/x.pdf", false), ["work", "client"]);
});

test("sourceOf: the nearest folder giving the tag", () => {
  const inh = new Inheritance({ inherit: true, folderNames: true }, tree({ Work: ["b27"], "Work/Sub": ["b27"] }));
  assert.equal(inh.sourceOf("Work/Sub/x.pdf", false, "b27"), "Work/Sub");
  assert.equal(inh.sourceOf("Work/Sub/x.pdf", false, "work"), "Work");
  assert.equal(inh.sourceOf("Work/Sub", true, "sub"), "Work/Sub");
  assert.equal(inh.sourceOf("Work/Sub/x.pdf", false, "nope"), null);
});

test("excluded: an excluded folder passes nothing and an excluded item gets nothing", () => {
  const inh = new Inheritance({ inherit: true, folderNames: true }, tree({ Work: ["b27"], "Work/Old": ["old"] }, ["Work/Old"]));
  assert.deepEqual(inh.tagsOf("Work/Old/x.pdf", false), []);
  assert.deepEqual(inh.tagsOf("Work/Old", true), []);
  assert.deepEqual(inh.tagsOf("Work/New/x.pdf", false), ["new", "work", "b27"]);
});
