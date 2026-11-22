import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_QUERY_LIMIT, compareQueryItems, matchQuery, parseQuery } from "../src/query.ts";
import { formatFormula } from "../src/formula.ts";

test("parseQuery: formula lines joined (side by side = AND), options and comments apart", () => {
  const q = parseQuery("// my invoices\ninvoice OR facture\nNOT paid\nsort: Modified\nlimit: 20\n");
  assert.equal(q.formula, "invoice OR facture NOT paid");
  assert.equal(formatFormula(q.expr!), "invoice OR facture AND NOT paid");
  assert.equal(q.sort, "modified");
  assert.equal(q.limit, 20);
  assert.deepEqual(q.warnings, []);
  assert.equal(q.error, null);
});

test("parseQuery: bad options are named and fall back to the defaults; the formula still works", () => {
  const q = parseQuery("tax\nsort: size\nlimit: 0\ncolour: red");
  assert.equal(q.sort, "name");
  assert.equal(q.limit, DEFAULT_QUERY_LIMIT);
  assert.equal(q.warnings.length, 3);
  assert.match(q.warnings[0], /sort.*size/);
  assert.match(q.warnings[2], /"colour:" is not an option/);
  assert.ok(q.expr);
});

test("parseQuery: empty block and syntax error explain themselves", () => {
  assert.match(parseQuery("  \n// only a comment\nsort: name").error!, /Write a tag formula/);
  const bad = parseQuery("tax AND");
  assert.equal(bad.expr, null);
  assert.ok(bad.error);
});

test("matchQuery: vault spelling, a tag no item carries is kept (finds nothing, NOT finds all) and named", () => {
  const tags: Record<string, string[]> = { a: ["Tax", "pdf"], b: ["tax", "paid"], c: ["other"] };
  const has = (p: string, t: string): boolean => tags[p].includes(t);
  const known = ["Tax", "pdf", "tax", "paid", "other"];
  const run = (f: string): ReturnType<typeof matchQuery> => matchQuery(parseQuery(f).expr!, Object.keys(tags), has, known);
  assert.deepEqual(run("TAX AND pdf").paths, ["a"]);
  assert.deepEqual(run("other AND gone").paths, []);
  assert.deepEqual(run("other AND gone").unknown, ["gone"]);
  assert.deepEqual(run("NOT gone").paths, ["a", "b", "c"]);
  assert.deepEqual(run("tax AND NOT paid").paths, []);
});

test("compareQueryItems: by name (folders first, numbers by value) or newest first", () => {
  const items = [
    { name: "file10", folder: false, mtime: 3, ctime: 1 },
    { name: "file2", folder: false, mtime: 1, ctime: 3 },
    { name: "Dir", folder: true, mtime: 0, ctime: 0 },
  ];
  const names = (sort: "name" | "modified" | "created"): string => [...items].sort(compareQueryItems(sort)).map((i) => i.name).join();
  assert.equal(names("name"), "Dir,file2,file10");
  assert.equal(names("modified"), "file10,file2,Dir");
  assert.equal(names("created"), "file2,file10,Dir");
});
