import { test } from "node:test";
import assert from "node:assert/strict";
import { Inheritance, folderNameTags, inheriting, setKeptName } from "../src/inherit.ts";
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

test("folder name tags: short numbers (1 to 3 digits) left out only when asked; a year always kept", () => {
  assert.deepEqual(folderNameTags("12", rule), ["12"]);
  assert.deepEqual(folderNameTags("12", rule, true), []);
  assert.deepEqual(folderNameTags("007", rule, true), []);
  assert.deepEqual(folderNameTags("Project 42", rule, true), ["project"]);
  assert.deepEqual(folderNameTags("2025", rule, true), ["2025"]);
  assert.deepEqual(folderNameTags("Budget 2025 v2", rule, true), ["budget", "2025", "v2"]);
  assert.deepEqual(folderNameTags("B27 Board", rule, true), ["b27", "board"]);
});

/** A tiny tree: folder paths → stored tags; `kept`: folders keeping their name to themselves. */
function tree(stored: Record<string, string[]>, excluded: string[] = [], kept: string[] = []) {
  return {
    ownOf: (p: string) => stored[p] ?? [],
    nameTagsOf: (name: string) => folderNameTags(name, rule),
    excluded: (p: string) => excluded.some((e) => p === e || p.startsWith(e + "/")),
    keepsName: (p: string) => kept.includes(p),
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

test("kept name: the folder still carries its name, what is inside doesn't; its stored tags and the folders above still pass", () => {
  const inh = new Inheritance({ inherit: true, folderNames: true }, tree({ "1. Projects": ["work"] }, [], ["1. Projects"]));
  assert.deepEqual(inh.tagsOf("1. Projects", true), ["projects"]);
  assert.deepEqual(inh.tagsOf("1. Projects/Acme", true), ["acme", "work"]);
  assert.deepEqual(inh.tagsOf("1. Projects/Acme/report.pdf", false), ["acme", "work"]);
  assert.deepEqual(inh.tagsOf("1. Projects/x.pdf", false), ["work"]);
  const nested = new Inheritance({ inherit: false, folderNames: true }, tree({}, [], ["Clients/Acme"]));
  assert.deepEqual(nested.tagsOf("Clients/Acme/x.pdf", false), ["clients"], "only that folder's name stops");
});

test("setKeptName: adds once, removes exactly", () => {
  let kept = setKeptName([], "A", true);
  kept = setKeptName(kept, "A/B", true);
  assert.deepEqual(setKeptName(kept, "A", true), ["A/B", "A"], "twice: once");
  assert.deepEqual(setKeptName(kept, "A", false), ["A/B"], "a folder inside is its own choice");
});

test("excluded: an excluded folder passes nothing and an excluded item gets nothing", () => {
  const inh = new Inheritance({ inherit: true, folderNames: true }, tree({ Work: ["b27"], "Work/Old": ["old"] }, ["Work/Old"]));
  assert.deepEqual(inh.tagsOf("Work/Old/x.pdf", false), []);
  assert.deepEqual(inh.tagsOf("Work/Old", true), []);
  assert.deepEqual(inh.tagsOf("Work/New/x.pdf", false), ["new", "work", "b27"]);
});
