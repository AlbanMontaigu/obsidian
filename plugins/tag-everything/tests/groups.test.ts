import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addGroup,
  addTagsToGroup,
  cleanName,
  deleteGroup,
  formulaError,
  groupExpr,
  moveGroup,
  nextId,
  normalizeGroups,
  removeTagFromGroup,
  renameGroup,
  setCollapsed,
  toggleTagNot,
  setFormula,
  type TagGroup,
} from "../src/groups.ts";
import { formatFormula, parseFormula } from "../src/formula.ts";

const g = (id: string, tags: string[] = [], name = id): TagGroup => ({ id, name, tags, collapsed: false });

test("cleanName: trims, collapses spaces, caps length", () => {
  assert.equal(cleanName("  Client   B27 \n"), "Client B27");
  assert.equal(cleanName("   "), "");
  assert.equal(cleanName("x".repeat(200)).length, 80);
});

test("nextId: above every numeric id, ignores others", () => {
  assert.equal(nextId([]), "g1");
  assert.equal(nextId([g("g1"), g("g7"), g("custom")]), "g8");
});

test("addGroup: appends with a fresh id and unique tags; refuses an empty name", () => {
  const { groups, id } = addGroup([g("g1")], " Work ", ["a", "b", "a"]);
  assert.equal(id, "g2");
  assert.deepEqual(groups[1], { id: "g2", name: "Work", tags: ["a", "b"], collapsed: false });
  assert.throws(() => addGroup([], "  "), /needs a name/);
});

test("a tag can belong to several groups; adding twice to one group is a no-op", () => {
  let groups = [g("g1"), g("g2")];
  groups = addTagsToGroup(groups, "g1", ["tax"]);
  groups = addTagsToGroup(groups, "g2", ["tax", "2026"]);
  groups = addTagsToGroup(groups, "g2", ["tax"]);
  assert.deepEqual(groups.map((x) => x.tags), [["tax"], ["tax", "2026"]]);
});

test("remove / rename / collapse / delete touch only their group, and never mutate the input", () => {
  const input = [g("g1", ["a", "b"]), g("g2", ["a"])];
  const frozen = JSON.stringify(input);
  assert.deepEqual(removeTagFromGroup(input, "g1", "a").map((x) => x.tags), [["b"], ["a"]]);
  assert.equal(renameGroup(input, "g2", "New")[1].name, "New");
  assert.throws(() => renameGroup(input, "g2", ""), /needs a name/);
  assert.deepEqual(setCollapsed(input, "g1", true).map((x) => x.collapsed), [true, false]);
  assert.deepEqual(deleteGroup(input, "g1").map((x) => x.id), ["g2"]);
  assert.deepEqual(deleteGroup(input, "nope").map((x) => x.id), ["g1", "g2"]);
  assert.equal(JSON.stringify(input), frozen);
});

test("moveGroup: before another group, to the end, unknown ids", () => {
  const groups = [g("g1"), g("g2"), g("g3")];
  assert.deepEqual(moveGroup(groups, "g3", "g1").map((x) => x.id), ["g3", "g1", "g2"]);
  assert.deepEqual(moveGroup(groups, "g1", null).map((x) => x.id), ["g2", "g3", "g1"]);
  assert.deepEqual(moveGroup(groups, "g2", "g2").map((x) => x.id), ["g1", "g2", "g3"]);
  assert.deepEqual(moveGroup(groups, "zz", "g1").map((x) => x.id), ["g1", "g2", "g3"]);
  assert.deepEqual(moveGroup(groups, "g1", "zz").map((x) => x.id), ["g2", "g3", "g1"]);
});

test("normalizeGroups: missing or malformed data never throws", () => {
  assert.deepEqual(normalizeGroups(undefined), []);
  assert.deepEqual(normalizeGroups("x"), []);
  assert.deepEqual(normalizeGroups({}), []);
  const out = normalizeGroups([
    null,
    42,
    { name: "  " }, // no name: dropped
    { id: "g1", name: "Ok", tags: ["a", " a ", 3, "", "b"], collapsed: true },
    { id: "g1", name: "Duplicate id" }, // re-numbered
    { name: "No id", tags: "nope" },
  ]);
  assert.deepEqual(out, [
    { id: "g1", name: "Ok", tags: ["a", "b"], collapsed: true },
    { id: "g2", name: "Duplicate id", tags: [], collapsed: false },
    { id: "g3", name: "No id", tags: [], collapsed: false },
  ]);
});

test("formula: setFormula sets the tags; drop appends AND; × prunes; null empties", () => {
  let groups = setFormula([g("g1", ["old"])], "g1", parseFormula("(a OR b) AND (c OR d)"));
  assert.deepEqual(groups[0].tags, ["a", "b", "c", "d"]);
  assert.equal(groups[0].formula, "(a OR b) AND (c OR d)");
  groups = addTagsToGroup(groups, "g1", ["e", "a"]);
  assert.equal(groups[0].formula, "(a OR b) AND (c OR d) AND e");
  groups = removeTagFromGroup(groups, "g1", "c");
  assert.equal(groups[0].formula, "(a OR b) AND d AND e");
  assert.deepEqual(groups[0].tags, ["a", "b", "d", "e"]);
  for (const t of ["a", "b", "d", "e"]) groups = removeTagFromGroup(groups, "g1", t);
  assert.deepEqual(groups[0], g("g1"), "last tag removed: empty group, no formula");
  groups = setFormula(setFormula([g("g1")], "g1", parseFormula("x OR y")), "g1", null);
  assert.deepEqual(groups[0], g("g1"), "no formula: an empty group");
  groups = setFormula(setFormula([g("g1")], "g1", parseFormula("x OR y")), "g1", parseFormula("x y"));
  assert.deepEqual(groups[0], g("g1", ["x", "y"]), "a plain AND: the tags, no formula");
  assert.equal(formatFormula(groupExpr(groups[0])!), "x AND y");
  assert.equal(setFormula([g("g1")], "g1", parseFormula("x AND x AND y"))[0].formula, "x AND x AND y", "a repeated tag keeps its formula");
  assert.deepEqual(setFormula([g("g1")], "g1", parseFormula("z"))[0], g("g1", ["z"]), "one tag: no formula");
  assert.equal(groupExpr(g("g2")), null);
  const broken: TagGroup = { ...g("g3", ["p", "q"]), formula: "(p OR" };
  assert.match(formulaError(broken)!, /missing after OR/);
  assert.equal(formatFormula(groupExpr(broken)!), "p AND q", "unparsable formula: falls back to the tags");
  assert.equal(normalizeGroups([broken])[0].formula, "(p OR", "kept as written, never lost");
});

test("toggleTagNot: NOT on / off in the group's search; a group without formula gets one", () => {
  const { groups, id } = addGroup([], "G", ["a", "b"]);
  const once = toggleTagNot(groups, id, "b");
  assert.equal(once[0].formula, "a AND NOT b");
  assert.deepEqual(once[0].tags, ["a", "b"]);
  assert.equal(toggleTagNot(once, id, "b")[0].formula, "a AND b");
  assert.deepEqual(toggleTagNot(groups, id, "zzz"), groups, "a tag not in the group changes nothing");
  const broken = [{ ...groups[0], formula: "(a" }];
  assert.deepEqual(toggleTagNot(broken, id, "a"), broken, "an unparsable formula is left alone");
});
