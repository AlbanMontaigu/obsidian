import { test } from "node:test";
import assert from "node:assert/strict";
import { addSection, deleteSection, forgetGroup, moveToSection, normalizeSections, renameSection, sectionOf, setSectionCollapsed, type Section } from "../src/sections.ts";
import { normalizeSettings } from "../src/config.ts";

const s = (id: string, tags: string[] = [], groups: string[] = []): Section => ({ id, name: id, tags, groups });

test("normalizeSections: drops junk, repairs ids, keeps only known groups, folding read", () => {
  const sections = normalizeSections(
    [{ name: " Work ", tags: ["a", "a", 3, " b "], groups: ["g1", "gone"], collapsed: true }, { id: "t1", name: "Home", collapsed: "yes" }, "junk", { name: "  " }],
    ["g1"],
  );
  assert.deepEqual(sections, [
    { id: "t2", name: "Work", tags: ["a", "b"], groups: ["g1"], collapsed: true },
    { id: "t1", name: "Home", tags: [], groups: [] },
  ]);
  assert.deepEqual(normalizeSections({}, []), []);
  // duplicate ids: the second gets a fresh one
  assert.deepEqual(normalizeSections([{ id: "t1", name: "A" }, { id: "t1", name: "B" }], []).map((x) => x.id), ["t1", "t2"]);
});

test("normalizeSections: bookmark tabs of before 0.37 become sections, a group or tag in several stays in the first", () => {
  const sections = normalizeSections([{ id: "t1", name: "Work", tags: ["a", "b"], groups: ["g1"] }, { id: "t2", name: "Home", tags: ["b", "c"], groups: ["g1", "g2"] }], ["g1", "g2"]);
  assert.deepEqual(
    sections.map((x) => [x.tags, x.groups]),
    [
      [["a", "b"], ["g1"]],
      [["c"], ["g2"]],
    ],
  );
});

test("normalizeSettings: sections loaded from `tabs`, a group that is gone dropped", () => {
  const st = normalizeSettings({ groups: [{ id: "g1", name: "G" }], tabs: [{ id: "t1", name: "T", groups: ["g1", "g9"] }] });
  assert.deepEqual(st.tabs, [{ id: "t1", name: "T", tags: [], groups: ["g1"] }]);
  assert.deepEqual(normalizeSettings(null).tabs, []);
});

test("addSection / renameSection / deleteSection / setSectionCollapsed", () => {
  const { sections, id } = addSection([s("t1")], "  Projects ");
  assert.equal(id, "t2");
  assert.deepEqual(sections[1], { id: "t2", name: "Projects", tags: [], groups: [] });
  assert.throws(() => addSection([], " "), /needs a name/);
  assert.equal(renameSection(sections, "t2", "P")[1].name, "P");
  assert.throws(() => renameSection(sections, "t2", ""), /needs a name/);
  assert.deepEqual(deleteSection(sections, "t1").map((x) => x.id), ["t2"]);
  assert.equal(setSectionCollapsed(sections, "t2", true)[1].collapsed, true);
});

test("moveToSection: in one section only, added once at the end; null takes it out; the input is left alone", () => {
  const sections = [s("t1", ["a"], ["g1"]), s("t2", ["b"])];
  const moved = moveToSection(sections, "t2", "tags", "a");
  assert.deepEqual(moved.map((x) => x.tags), [[], ["b", "a"]]);
  assert.deepEqual(moveToSection(moved, "t2", "tags", "a"), moved);
  assert.deepEqual(moveToSection(sections, null, "groups", "g1").map((x) => x.groups), [[], []]);
  assert.deepEqual(moveToSection(sections, "t2", "groups", "g9")[1].groups, ["g9"]);
  assert.equal(moved[1] === sections[1], false);
  assert.deepEqual(sections[0].tags, ["a"]);
  assert.equal(sectionOf(moved, "tags", "a")?.id, "t2");
  assert.equal(sectionOf(moved, "groups", "g9"), undefined);
});

test("forgetGroup: removes the group from its section", () => {
  const sections = forgetGroup([s("t1", [], ["g1", "g2"]), s("t2", [], ["g3"])], "g1");
  assert.deepEqual(sections.map((x) => x.groups), [["g2"], ["g3"]]);
});
