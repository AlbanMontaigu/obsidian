import { test } from "node:test";
import assert from "node:assert/strict";
import { destinationsFor, folderHabits, habitIndex } from "../src/putaway.ts";

const files = (o: Record<string, string>) => Object.entries(o).map(([path, tags]) => ({ path, tags: tags.split(" ").filter(Boolean) }));
const VAULT = files({
  "Bills/Power/a.pdf": "bill power 2024",
  "Bills/Power/b.pdf": "bill power 2025",
  "Bills/Power/c.pdf": "bill Power",
  "Bills/Phone/a.pdf": "bill phone",
  "Bills/Phone/b.pdf": "bill phone",
  "Bills/x.pdf": "bill",
  "Bills/y.pdf": "bill",
  "Tax/a.pdf": "tax 2025",
  "Tax/b.pdf": "tax 2024",
  "root.pdf": "bill power",
  "root2.pdf": "bill power",
});
const to = (path: string, tags: string, transit: string[] = []) =>
  destinationsFor(path, tags.split(" "), habitIndex(folderHabits(VAULT), transit)).map((h) => h.folder);

test("a folder's habits: the tags most of its own files carry, case ignored; the root has none", () => {
  const habits = folderHabits(VAULT);
  assert.deepEqual(
    habits.map((h) => `${h.folder}:${h.tags.join(" ")}:${h.size}`),
    ["Bills/Power:bill power:3", "Bills/Phone:bill phone:2", "Bills:bill:2", "Tax:tax:2"],
  );
});

test("one carrier is no habit, nor is a tag on too few of the folder's files", () => {
  assert.deepEqual(folderHabits(files({ "A/a.md": "x", "A/b.md": "y" })), []);
  assert.deepEqual(folderHabits(files({ "A/a.md": "x", "A/b.md": "x", "A/c.md": "", "A/d.md": "" })), []); // 50 %
  assert.deepEqual(folderHabits(files({ "A/a.md": "x", "A/b.md": "x", "A/c.md": "x", "A/d.md": "" }))[0]?.tags, ["x"]); // 75 %
});

test("the most specific folder whose habits the file carries comes first", () => {
  assert.deepEqual(to("Inbox/new.pdf", "bill power 2026"), ["Bills/Power", "Bills"]);
  assert.deepEqual(to("Inbox/new.pdf", "phone bill"), ["Bills/Phone", "Bills"]);
  assert.deepEqual(to("Inbox/new.pdf", "tax"), ["Tax"]);
});

test("a folder is never offered when the file lacks one of its habits", () => {
  assert.deepEqual(to("Inbox/new.pdf", "power"), []);
  assert.deepEqual(to("Inbox/new.pdf", "holiday"), []);
  assert.deepEqual(destinationsFor("Inbox/new.pdf", [], habitIndex(folderHabits(VAULT))), []);
});

test("only folders better than the one the file is in: a file in place stays", () => {
  assert.deepEqual(to("Bills/Power/d.pdf", "bill power"), []);
  assert.deepEqual(to("Bills/z.pdf", "bill power"), ["Bills/Power"]);
  assert.deepEqual(to("bills/power/d.pdf", "bill power"), []); // case ignored, as Windows does
});

test("transit folders (inbox, landing folder) are never a destination, nor a place to stay", () => {
  // more files than Bills/Power: the inbox would rank first, so the file would stay there
  const vault = [...VAULT, ...files({ "Inbox/a.pdf": "bill power", "Inbox/b.pdf": "bill power", "Inbox/c.pdf": "bill power", "Inbox/d.pdf": "bill power" })];
  const index = (transit: string[]) => habitIndex(folderHabits(vault), transit);
  assert.deepEqual(destinationsFor("Inbox/e.pdf", ["bill", "power"], index([])), []); // the inbox looks like a home
  assert.deepEqual(destinationsFor("Inbox/e.pdf", ["bill", "power"], index(["inbox"])).map((h) => h.folder), ["Bills/Power", "Bills"]);
});
