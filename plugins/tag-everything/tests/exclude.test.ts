import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXCLUDED_EXTENSIONS,
  DEFAULT_EXCLUDED_FILES,
  DEFAULT_EXCLUDED_FOLDERS,
  type ExcludeRule,
  describeNameExclusion,
  excludeRuleMatches,
  exclusionOf,
  nameExclusion,
  parseNames,
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

const defaults = parseNames(DEFAULT_EXCLUDED_FOLDERS, DEFAULT_EXCLUDED_FILES, DEFAULT_EXCLUDED_EXTENSIONS);
const nameOf = (path: string, isFolder = false, names = defaults): string | null => {
  const why = nameExclusion(path, isFolder, names);
  return why?.by === "name" ? `${why.kind}:${why.pattern}` : null;
};

test("nameExclusion defaults: dot-folders, scratch and cache folders with what is in them", () => {
  assert.equal(nameOf(".vscode", true), "folder:.*");
  assert.equal(nameOf("code/.vscode/settings.json"), "folder:.*");
  assert.equal(nameOf("app/__pycache__/mod.cpython-312.pyc"), "folder:__pycache__", "the folder before the extension");
  assert.equal(nameOf("Projects/Tmp/notes.md"), "folder:tmp", "case ignored");
  assert.equal(nameOf("web/node_modules", true), "folder:node_modules");
  assert.equal(nameOf("Templates/a.md"), null, "a whole folder name, not a part of it");
  assert.equal(nameOf("tmp.md"), null, "a file named like an excluded folder is not a folder");
});

test("nameExclusion defaults: dot-files, lock files and temporary extensions", () => {
  assert.equal(nameOf("code/.gitignore"), "file:.*");
  assert.equal(nameOf("Docs/~$report.docx"), "file:~$*");
  assert.equal(nameOf("Photos/Thumbs.db"), "file:Thumbs.db");
  assert.equal(nameOf("a/draft.TMP"), "extension:tmp");
  assert.equal(nameOf("report[tax].bak"), "extension:bak", "a tag group before the extension does not matter");
  assert.equal(nameOf("a/backup.pdf"), null);
  assert.equal(nameOf("a/bak"), null, "a name without a dot has no extension");
  assert.equal(nameOf("Notes", true), null);
});

test("parseNames: wildcards, spaces in a folder name, extensions with a dot or a star, empty boxes", () => {
  const names = parseNames("Old Stuff, build*", "", ".log *.tar.gz  cache");
  assert.equal(nameOf("x/Old Stuff/a.md", false, names), "folder:Old Stuff");
  assert.equal(nameOf("build-2024/a.md", false, names), "folder:build*");
  assert.equal(nameOf("a/run.log", false, names), "extension:log");
  assert.equal(nameOf("a/site.tar.gz", false, names), "extension:tar.gz");
  assert.equal(nameOf("a/site.gz", false, names), null);
  assert.equal(nameOf("a.b/c.md", false, parseNames("a?b", "", "")), "folder:a?b", "? is one character, the dot is literal elsewhere");
  assert.equal(nameOf("axb/c.md", false, parseNames("a.b", "", "")), null);
  assert.equal(nameExclusion(".vscode", true, parseNames(" ", "", "")), null);
});

test("exclusionOf: a path by hand first, then a name, then a rule", () => {
  const rules = [rule({ extensions: "md" })];
  assert.deepEqual(exclusionOf("tmp/a.md", false, ["tmp"], rules, defaults), { by: "path", path: "tmp" });
  assert.equal(exclusionOf("tmp/a.md", false, [], rules, defaults)?.by, "name");
  assert.equal(exclusionOf("notes/a.md", false, [], rules, defaults)?.by, "rule");
  assert.equal(exclusionOf("tmp/a.md", false, [], []), null, "no names given: none");
  assert.equal(describeNameExclusion({ by: "name", kind: "folder", pattern: "tmp" }), 'the folder name "tmp"');
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
