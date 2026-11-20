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
  splitTagInput,
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

test("planTags: filename mode moves every tag into the name", () => {
  const plan = planTags({ nameTags: ["a"], sideTags: ["s"] }, ["a", "s", "n"], "filename");
  assert.deepEqual(plan, { nameTags: ["a", "s", "n"], sideTags: [], renamed: true, sideChanged: true });
});

test("planTags: sidecar mode only renames to remove a name tag", () => {
  assert.deepEqual(planTags({ nameTags: ["a"], sideTags: [] }, ["a", "n"], "sidecar"), {
    nameTags: ["a"],
    sideTags: ["n"],
    renamed: false,
    sideChanged: true,
  });
  assert.deepEqual(planTags({ nameTags: ["a", "b"], sideTags: ["s"] }, ["b", "s"], "sidecar"), {
    nameTags: ["b"],
    sideTags: ["s"],
    renamed: true,
    sideChanged: false,
  });
});

test("mergeEdit keeps order, drops removed, appends added once", () => {
  assert.deepEqual(mergeEdit(["a", "b", "c"], ["d", "a"], ["b"]), ["a", "c", "d"]);
});
