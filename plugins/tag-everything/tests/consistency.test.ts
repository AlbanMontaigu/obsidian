import { test } from "node:test";
import assert from "node:assert/strict";
import { findInconsistencies } from "../src/consistency.ts";

const files = (o: Record<string, string>) => Object.entries(o).map(([path, tags]) => ({ path, tags: tags.split(" ").filter(Boolean) }));
const short = (o: Record<string, string>) => findInconsistencies(files(o)).map((f) => `${f.path}:${f.tag}${f.replaces.length ? `<${f.replaces.join()}` : ""}`);

test("a file without the tag nearly all its folder carries is a finding, with the counts", () => {
  const found = findInconsistencies(files({ "Bills/a.pdf": "invoice edf", "Bills/b.pdf": "invoice orange", "Bills/c.pdf": "invoice", "Bills/d.pdf": "edf" }));
  assert.deepEqual(found, [{ path: "Bills/d.pdf", folder: "Bills", tag: "invoice", carriers: 3, size: 4, ext: null, replaces: [] }]);
});

test("no habit: too few carriers, too small a share, or every file has it", () => {
  assert.deepEqual(short({ "A/a.md": "x", "A/b.md": "x", "A/c.md": "" }), []); // 2 carriers
  assert.deepEqual(short({ "A/a.md": "x", "A/b.md": "x", "A/c.md": "x", "A/d.md": "", "A/e.md": "" }), []); // 60 %
  assert.deepEqual(short({ "A/a.md": "x", "A/b.md": "x", "A/c.md": "x", "A/d.md": "x" }), []);
});

test("only the files directly in the folder: a subfolder is its own group", () => {
  assert.deepEqual(short({ "A/a.md": "x", "A/b.md": "x", "A/c.md": "x", "A/Sub/d.md": "", "A/Sub/e.md": "" }), []);
  assert.deepEqual(short({ "a.md": "x", "b.md": "x", "c.md": "x", "d.md": "y" }), ["d.md:x"]); // the vault root too
});

test("an untagged file of the folder is a finding too", () => {
  assert.deepEqual(short({ "A/a.md": "x", "A/b.md": "x", "A/c.md": "x", "A/d.md": "" }), ["A/d.md:x"]);
});

test("the files of one extension are a group of their own within the folder", () => {
  const found = findInconsistencies(files({ "A/1.pdf": "scan", "A/2.pdf": "scan", "A/3.pdf": "scan", "A/4.pdf": "", "A/n1.md": "meeting", "A/n2.md": "", "A/n3.md": "" }));
  assert.deepEqual(found.map((f) => [f.path, f.tag, f.ext, `${f.carriers}/${f.size}`]), [["A/4.pdf", "scan", "pdf", "3/4"]]);
});

test("a look-alike of the habit is offered as a replacement", () => {
  assert.deepEqual(short({ "A/a.md": "facture", "A/b.md": "facture", "A/c.md": "facture", "A/d.md": "factures edf" }), ["A/d.md:facture<factures"]);
  assert.deepEqual(short({ "A/a.md": "receipt", "A/b.md": "receipt", "A/c.md": "receipt", "A/d.md": "reciept" }), ["A/d.md:receipt<reciept"]);
});

test("a consistent variant (2+ files sharing another tag, none with the habit) is no finding; a lone exception is", () => {
  const year = { "A/1.md": "2024", "A/2.md": "2024", "A/3.md": "2024", "A/4.md": "2024", "A/5.md": "2024", "A/6.md": "2024" };
  assert.deepEqual(short({ ...year, "A/7.md": "2025", "A/8.md": "2025" }), []);
  assert.deepEqual(short({ ...year, "A/7.md": "2025" }), ["A/7.md:2024"]);
  // two files sharing a misspelling are still a typo to fix, not a variant
  assert.deepEqual(short({ ...year, "A/1.md": "facture", "A/2.md": "facture", "A/3.md": "facture", "A/4.md": "facture", "A/5.md": "facture", "A/6.md": "facture", "A/7.md": "factures", "A/8.md": "factures" }), [
    "A/7.md:facture<factures",
    "A/8.md:facture<factures",
  ]);
});

test("a finding of the whole folder is not repeated by its extension group", () => {
  assert.deepEqual(short({ "A/a.pdf": "x", "A/b.pdf": "x", "A/c.pdf": "x", "A/d.pdf": "", "A/e.md": "x", "A/f.md": "x" }), ["A/d.pdf:x"]);
});
