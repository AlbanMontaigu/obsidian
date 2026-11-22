import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fileSidecarPath,
  folderMetaPath,
  mergeEdit,
  normalizeTag,
  parseNameTags,
  parseSidecar,
  planTags,
  serializeSidecar,
  setNameTags,
  sidecarTags,
  splitExtension,
  extensionTag,
  splitTagInput,
  parseTagInput,
  assertWritable,
  frontmatterTags,
  setFrontmatterTags,
  withSidecarTags,
} from "../src/format.ts";

test("parseNameTags reads the first bracket group", () => {
  assert.deepEqual(parseNameTags("report[tax-2024 receipt].pdf"), ["tax-2024", "receipt"]);
  assert.deepEqual(parseNameTags("B27_Board_v10 - Final[B27 INC].docx"), ["B27", "INC"]);
  assert.deepEqual(parseNameTags("2024-07-18-0900 - [IMAC] SteerCo.md"), ["IMAC"]);
  assert.deepEqual(parseNameTags("plain.md"), []);
  assert.deepEqual(parseNameTags("odd]name[x.md"), []);
  assert.deepEqual(parseNameTags("dup[a  a b].md"), ["a", "b"]);
  assert.deepEqual(parseNameTags("empty[].md"), []);
});

test("splitExtension handles dotfiles, no extension and double extensions", () => {
  assert.deepEqual(splitExtension("a.pdf"), ["a", ".pdf"]);
  assert.deepEqual(splitExtension("backup.tar.gz"), ["backup", ".tar.gz"]);
  assert.deepEqual(splitExtension(".gitignore"), [".gitignore", ""]);
  assert.deepEqual(splitExtension("README"), ["README", ""]);
});

test("extensionTag: the last extension, lower-cased; none when not a plain one", () => {
  assert.equal(extensionTag("Scan[tax receipt].PDF"), "pdf");
  assert.equal(extensionTag("report.md"), "md");
  assert.equal(extensionTag("backup.tar.gz"), "gz");
  assert.equal(extensionTag("photo.jpeg2000"), "jpeg2000");
  for (const name of ["README", ".gitignore", "Mr. Smith", "a.", "x.code-workspace", "a.verylongextension"]) assert.equal(extensionTag(name), null, name);
});

test("setNameTags adds a group before the extension", () => {
  assert.equal(setNameTags("report.pdf", ["tax", "receipt"]), "report[tax receipt].pdf");
  assert.equal(setNameTags("report .pdf", ["tax"]), "report[tax].pdf");
  assert.equal(setNameTags("backup.tar.gz", ["x"]), "backup[x].tar.gz");
  assert.equal(setNameTags("README", ["x"]), "README[x]");
  assert.equal(setNameTags("plain.md", []), "plain.md");
});

test("setNameTags rewrites an existing group in place", () => {
  assert.equal(setNameTags("report[tax].pdf", ["tax", "receipt"]), "report[tax receipt].pdf");
  assert.equal(setNameTags("2024 - [IMAC] SteerCo.md", ["IMAC", "steerco"]), "2024 - [IMAC steerco] SteerCo.md");
});

test("setNameTags removes the group and tidies spaces", () => {
  assert.equal(setNameTags("report[tax].pdf", []), "report.pdf");
  assert.equal(setNameTags("report [tax].pdf", []), "report.pdf");
  assert.equal(setNameTags("2024 - [IMAC] SteerCo.md", []), "2024 - SteerCo.md");
  assert.equal(setNameTags("[a] notes.md", []), "notes.md");
});

test("setNameTags refuses names it cannot write safely", () => {
  assert.throws(() => setNameTags("[a].md", []), /without a name/);
  assert.throws(() => setNameTags("x".repeat(250) + ".md", ["long-tag"]), /limit/);
  assert.throws(() => setNameTags("odd]name.md", ["x"]), /read as tags/);
});

test("normalizeTag and splitTagInput", () => {
  assert.deepEqual(normalizeTag("  Tax "), { tag: "Tax" });
  assert.deepEqual(normalizeTag("Tax", true), { tag: "tax" });
  assert.deepEqual(normalizeTag("   "), {});
  assert.match(normalizeTag("a[b").error ?? "", /cannot contain/);
  assert.match(normalizeTag("a/b").error ?? "", /cannot contain/);
  assert.deepEqual(splitTagInput("a, b  c,"), ["a", "b", "c"]);
});

test("sidecar paths follow the .ts layout", () => {
  assert.equal(fileSidecarPath("a/b/c.pdf"), "a/b/.ts/c.pdf.json");
  assert.equal(fileSidecarPath("c.pdf"), ".ts/c.pdf.json");
  assert.equal(folderMetaPath("a/b"), "a/b/.ts/tsm.json");
  assert.equal(folderMetaPath("/"), ".ts/tsm.json");
});

test("sidecar JSON keeps unknown fields and existing tag colours", () => {
  const original = '{"id":"abc","description":"d","tags":[{"title":"red","color":"#f00","type":"sidecar"}],"perspective":"grid"}';
  const meta = parseSidecar(original);
  const next = withSidecarTags(meta, ["red", "new"], 42);
  assert.equal(next.id, "abc");
  assert.equal(next.description, "d");
  assert.equal(next.perspective, "grid");
  assert.equal(next.lastUpdated, 42);
  assert.deepEqual(sidecarTags(next), [
    { title: "red", color: "#f00", type: "sidecar" },
    { title: "new", type: "sidecar" },
  ]);
  assert.ok(!serializeSidecar(next, original).includes("\n"), "one-line file stays one-line");
  assert.ok(serializeSidecar(next).includes("\n"), "new file is pretty-printed");
});

test("parseSidecar tolerates BOM and empty files, rejects junk", () => {
  assert.deepEqual(parseSidecar("﻿{\"id\":\"x\"}"), { id: "x" });
  assert.deepEqual(parseSidecar(""), {});
  assert.throws(() => parseSidecar("[1]"));
  assert.throws(() => parseSidecar("{oops"));
  assert.ok(typeof withSidecarTags({}, ["a"]).id === "string");
});

test("withSidecarTags: a tag stored with spaces around its title keeps its colour (it is read trimmed)", () => {
  const next = withSidecarTags({ tags: [{ title: " red ", color: "#f00", type: "sidecar" }] }, ["red"], 1);
  assert.deepEqual(sidecarTags(next), [{ title: "red", color: "#f00", type: "sidecar" }]);
});

test("planTags: filename mode moves every tag into the name", () => {
  const plan = planTags({ nameTags: ["a"], sideTags: ["s"] }, ["a", "s", "n"], "filename");
  assert.deepEqual(plan, { nameTags: ["a", "s", "n"], sideTags: [], frontTags: [], renamed: true, sideChanged: true, frontChanged: false });
});

test("planTags: sidecar mode only renames to remove a name tag", () => {
  assert.deepEqual(planTags({ nameTags: ["a"], sideTags: [] }, ["a", "n"], "sidecar"), {
    nameTags: ["a"],
    sideTags: ["n"],
    frontTags: [],
    renamed: false,
    sideChanged: true,
    frontChanged: false,
  });
  assert.deepEqual(planTags({ nameTags: ["a", "b"], sideTags: ["s"] }, ["b", "s"], "sidecar"), {
    nameTags: ["b"],
    sideTags: ["s"],
    frontTags: [],
    renamed: true,
    sideChanged: false,
    frontChanged: false,
  });
});

test("planTags: frontmatter mode never renames to add, keeps name tags, takes in sidecar tags", () => {
  // add: no rename, new tag in the frontmatter; sidecar tag moves into the frontmatter
  assert.deepEqual(planTags({ nameTags: ["n"], sideTags: ["s"], frontTags: ["f"] }, ["n", "f", "s", "new"], "frontmatter"), {
    nameTags: ["n"],
    sideTags: [],
    frontTags: ["f", "s", "new"],
    renamed: false,
    sideChanged: true,
    frontChanged: true,
  });
  // removing a name tag still renames; removing a frontmatter tag edits the frontmatter only
  assert.deepEqual(planTags({ nameTags: ["n", "m"], sideTags: [], frontTags: ["f", "g"] }, ["m", "g"], "frontmatter"), {
    nameTags: ["m"],
    sideTags: [],
    frontTags: ["g"],
    renamed: true,
    sideChanged: false,
    frontChanged: true,
  });
  // nothing to do
  const same = planTags({ nameTags: ["n"], sideTags: [], frontTags: ["f"] }, ["n", "f"], "frontmatter");
  assert.ok(!same.renamed && !same.sideChanged && !same.frontChanged);
});

test("planTags: other modes leave a note's kept frontmatter tags where they are", () => {
  const byName = planTags({ nameTags: [], sideTags: [], frontTags: ["f", "g"] }, ["f", "x"], "filename");
  assert.deepEqual([byName.nameTags, byName.frontTags], [["x"], ["f"]]);
  const bySide = planTags({ nameTags: ["n"], sideTags: [], frontTags: ["f"] }, ["n", "f", "x"], "sidecar");
  assert.deepEqual([bySide.nameTags, bySide.frontTags, bySide.sideTags, bySide.renamed], [["n"], ["f"], ["x"], false]);
});

test("frontmatterTags reads every shape Obsidian accepts", () => {
  assert.deepEqual(frontmatterTags({ tags: ["a", "#b", " c ", "", null, 2026] }), ["a", "b", "c", "2026"]);
  assert.deepEqual(frontmatterTags({ tags: "a, #b c" }), ["a", "b", "c"]);
  assert.deepEqual(frontmatterTags({ tag: "old", Tags: ["a"], title: "x" }), ["old", "a"]);
  assert.deepEqual(frontmatterTags({ tags: ["a", "a", "#a"] }), ["a"]);
  assert.deepEqual(frontmatterTags({ tags: null }), []);
  assert.deepEqual(frontmatterTags({ tags: { nested: 1 } }), []);
  assert.deepEqual(frontmatterTags(null), []);
  assert.deepEqual(frontmatterTags(["a"]), []);
  assert.deepEqual(frontmatterTags({ tagsx: ["a"], mytags: ["b"] }), []);
});

test("setFrontmatterTags writes one list, keeps other properties and original spellings", () => {
  const fm: Record<string, unknown> = { title: "Plan", tags: ["alpha", "#beta"], aliases: ["p"] };
  setFrontmatterTags(fm, ["alpha", "beta", "new"]);
  assert.deepEqual(fm, { title: "Plan", tags: ["alpha", "#beta", "new"], aliases: ["p"] });

  const legacy: Record<string, unknown> = { tag: "old", tags: "a b" };
  setFrontmatterTags(legacy, ["old", "a", "b"]);
  assert.deepEqual(legacy, { tags: ["old", "a", "b"] });

  const empty: Record<string, unknown> = { title: "x", tags: ["a"] };
  setFrontmatterTags(empty, []);
  assert.deepEqual(empty, { title: "x" });

  const fresh: Record<string, unknown> = {};
  setFrontmatterTags(fresh, ["x", "proj/alpha"]);
  assert.deepEqual(fresh, { tags: ["x", "proj/alpha"] });

  // round-trip: what is written reads back the same
  assert.deepEqual(frontmatterTags(fm), ["alpha", "beta", "new"]);
});

test("normalizeTag nested mode and assertWritable", () => {
  assert.deepEqual(normalizeTag("proj/alpha", false, true), { tag: "proj/alpha" });
  assert.match(normalizeTag("proj/", false, true).error ?? "", /empty part/);
  assert.match(normalizeTag("a#b", false, true).error ?? "", /cannot contain/);
  assert.match(normalizeTag("a,b", false, true).error ?? "", /cannot contain/);
  assert.doesNotThrow(() => assertWritable(["proj/alpha"], "frontmatter"));
  assert.throws(() => assertWritable(["proj/alpha"], "filename"), /cannot contain/);
  assert.throws(() => assertWritable(["tax receipt"], "sidecar"), /spaces/);
  assert.throws(() => assertWritable([" x"], "filename"), /invalid tag/);
});

test("mergeEdit keeps order, drops removed, appends added once", () => {
  assert.deepEqual(mergeEdit(["a", "b", "c"], ["d", "a"], ["b"]), ["a", "c", "d"]);
});

test("parseTagInput keeps invalid words for fixing", () => {
  assert.deepEqual(parseTagInput("a, b a"), { tags: ["a", "b"], errors: [], rest: "" });
  const r = parseTagInput("ok a:b x c?d", false, false);
  assert.deepEqual(r.tags, ["ok", "x"]);
  assert.equal(r.rest, "a:b c?d");
  assert.equal(r.errors.length, 2);
  assert.deepEqual(parseTagInput("Tax", true).tags, ["tax"]);
  assert.deepEqual(parseTagInput("proj/alpha", false, true), { tags: ["proj/alpha"], errors: [], rest: "" });
  assert.equal(parseTagInput("", false).rest, "");
});

test("a nested tag in a file name gets a specific message", () => {
  assert.match(normalizeTag("proj/alpha").error ?? "", /nested tags only go in a note's frontmatter/);
  assert.doesNotMatch(normalizeTag("a:b").error ?? "", /nested/);
  assert.doesNotMatch(normalizeTag("a#b/c").error ?? "", /nested/);
});
