import { test } from "node:test";
import assert from "node:assert/strict";
import { addTab, deleteTab, forgetGroup, normalizeTabs, renameTab, setBookmark, type BookmarkTab } from "../src/tabs.ts";
import { normalizeSettings } from "../src/config.ts";

const t = (id: string, tags: string[] = [], groups: string[] = []): BookmarkTab => ({ id, name: id, tags, groups });

test("normalizeTabs: drops junk, repairs ids, keeps only known groups", () => {
  const tabs = normalizeTabs(
    [{ name: " Work ", tags: ["a", "a", 3, " b "], groups: ["g1", "gone"] }, { id: "t1", name: "Home" }, "junk", { name: "  " }],
    ["g1"],
  );
  assert.deepEqual(tabs, [
    { id: "t2", name: "Work", tags: ["a", "b"], groups: ["g1"] },
    { id: "t1", name: "Home", tags: [], groups: [] },
  ]);
  assert.deepEqual(normalizeTabs({}, []), []);
  // duplicate ids: the second gets a fresh one
  assert.deepEqual(normalizeTabs([{ id: "t1", name: "A" }, { id: "t1", name: "B" }], []).map((x) => x.id), ["t1", "t2"]);
});

test("normalizeSettings: tabs loaded, bookmarks of a group that is gone dropped", () => {
  const s = normalizeSettings({ groups: [{ id: "g1", name: "G" }], tabs: [{ id: "t1", name: "T", groups: ["g1", "g9"] }] });
  assert.deepEqual(s.tabs, [{ id: "t1", name: "T", tags: [], groups: ["g1"] }]);
  assert.deepEqual(normalizeSettings(null).tabs, []);
});

test("addTab / renameTab / deleteTab", () => {
  const { tabs, id } = addTab([t("t1")], "  Projects ");
  assert.equal(id, "t2");
  assert.deepEqual(tabs[1], { id: "t2", name: "Projects", tags: [], groups: [] });
  assert.throws(() => addTab([], " "), /needs a name/);
  assert.equal(renameTab(tabs, "t2", "P")[1].name, "P");
  assert.throws(() => renameTab(tabs, "t2", ""), /needs a name/);
  assert.deepEqual(deleteTab(tabs, "t1").map((x) => x.id), ["t2"]);
});

test("setBookmark: adds once at the end, removes, leaves other tabs and the input alone", () => {
  const tabs = [t("t1", ["a"]), t("t2", ["a"])];
  const added = setBookmark(tabs, "t1", "tags", "b", true);
  assert.deepEqual(added[0].tags, ["a", "b"]);
  assert.deepEqual(setBookmark(added, "t1", "tags", "b", true)[0].tags, ["a", "b"]);
  assert.deepEqual(setBookmark(added, "t1", "tags", "a", false)[0].tags, ["b"]);
  assert.deepEqual(setBookmark(tabs, "t2", "groups", "g1", true)[1].groups, ["g1"]);
  assert.equal(added[1], tabs[1]);
  assert.deepEqual(tabs[0].tags, ["a"]);
});

test("forgetGroup: removes the group from every tab", () => {
  const tabs = forgetGroup([t("t1", [], ["g1", "g2"]), t("t2", [], ["g1"])], "g1");
  assert.deepEqual(tabs.map((x) => x.groups), [["g2"], []]);
});
