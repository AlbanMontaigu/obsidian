import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type ExcludeRule,
  excludeRuleMatches,
  exclusionOf,
  normalizeExcludeRules,
  normalizeExcludedPaths,
  renameExcluded,
  setExcluded,
} from "../src/exclude.ts";
import { saveRule } from "../src/inbox.ts";

const rule = (r: Partial<ExcludeRule>): ExcludeRule => ({ id: "x1", folder: "", words: "", extensions: "", ...r });

test("exclusionOf: a path excludes itself and everything under it, exactly", () => {
  const paths = ["Archive", "Docs/old.pdf"];
  assert.deepEqual(exclusionOf("Archive", true, paths, []), { by: "path", path: "Archive" });
  assert.deepEqual(exclusionOf("Archive/2020/a.pdf", false, paths, []), { by: "path", path: "Archive" });
  assert.deepEqual(exclusionOf("Docs/old.pdf", false, paths, []), { by: "path", path: "Docs/old.pdf" });
  assert.equal(exclusionOf("Archives/a.pdf", false, paths, []), null, "a folder is a whole path segment");
  assert.equal(exclusionOf("Docs/old.pdf.bak", false, paths, []), null);
  assert.equal(exclusionOf("Docs", true, paths, []), null, "the folder of an excluded file is not excluded");
});

test("exclusionOf: a path before the rules; else the first rule covering the item", () => {
  const rules = [rule({ extensions: "tmp" }), rule({ id: "x2", folder: "Build" })];
  assert.deepEqual(exclusionOf("Build/a.tmp", false, ["Build"], rules), { by: "path", path: "Build" });
  assert.equal((exclusionOf("Build/a.tmp", false, [], rules) as { rule: ExcludeRule }).rule.id, "x1");
  assert.equal((exclusionOf("build/out/a.js", false, [], rules) as { rule: ExcludeRule }).rule.id, "x2", "folder case ignored, any depth");
  assert.equal(exclusionOf("notes/a.md", false, [], rules), null);
});

test("excludeRuleMatches: a file as the auto-tag rules; a folder only by a folder-only rule, itself and below", () => {
  assert.ok(excludeRuleMatches(rule({ words: "draft" }), "x/Draft v2.docx", false));
  assert.ok(!excludeRuleMatches(rule({ words: "draft" }), "report[draft].pdf", false), "a tag is not a word of the name");
  assert.ok(excludeRuleMatches(rule({ folder: "Build/" }), "Build", true), "the folder itself");
  assert.ok(excludeRuleMatches(rule({ folder: "Build" }), "build/cache", true), "a folder inside, any case");
  assert.ok(!excludeRuleMatches(rule({ folder: "Build" }), "Builder", true));
  assert.ok(!excludeRuleMatches(rule({ folder: "Build", extensions: "js" }), "Build/js", true), "extensions are about files");
  assert.ok(!excludeRuleMatches(rule({ words: "tmp" }), "tmp", true), "words are about file names");
  assert.ok(!excludeRuleMatches(rule({}), "a.pdf", false), "no condition: nothing");
});

test("setExcluded: adds once, a folder replaces the paths under it; includes again exactly", () => {
  let paths = setExcluded([], "A/x.pdf", true);
  paths = setExcluded(paths, "B", true);
  paths = setExcluded(paths, "A", true);
  assert.deepEqual(paths, ["B", "A"]);
  assert.deepEqual(setExcluded(paths, "A", true), ["B", "A"], "twice: once");
  assert.deepEqual(setExcluded(paths, "A", false), ["B"]);
  assert.deepEqual(setExcluded(paths, "A/x.pdf", false), ["B", "A"], "a path covered by a folder stays covered");
});

test("renameExcluded: follows the item and a folder above it", () => {
  const paths = ["Old", "Docs/a.pdf", "Oldest"];
  assert.deepEqual(renameExcluded(paths, "Old", "New"), ["New", "Docs/a.pdf", "Oldest"]);
  assert.deepEqual(renameExcluded(paths, "Docs", "Papers"), ["Old", "Papers/a.pdf", "Oldest"]);
  assert.deepEqual(renameExcluded(paths, "Docs/a.pdf", "Docs/b.pdf"), ["Old", "Docs/b.pdf", "Oldest"]);
});

test("normalize: excluded paths cleaned; rules without condition dropped, ids x repaired", () => {
  assert.deepEqual(normalizeExcludedPaths(["/Archive/", "Archive", " ", 3, "a\\b"]), ["Archive", "a/b"]);
  assert.deepEqual(normalizeExcludedPaths("junk"), []);
  const rules = normalizeExcludeRules([{ id: "x2", folder: "/Build/" }, { id: "x2", extensions: "tmp" }, { folder: "", words: " " }, null, { id: "r1", words: "draft" }]);
  assert.deepEqual(rules, [
    { id: "x2", folder: "Build", words: "", extensions: "" },
    { id: "x3", folder: "", words: "", extensions: "tmp" },
    { id: "x4", folder: "", words: "draft", extensions: "" },
  ]);
  assert.deepEqual(saveRule(rules, { folder: "", words: "", extensions: "bak" }, "x").at(-1)?.id, "x5");
});
