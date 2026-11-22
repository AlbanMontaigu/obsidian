import { test } from "node:test";
import assert from "node:assert/strict";
import { arrivalState, cleanSource, describeBringIn, isInside, normalizeBringIn, sourceName } from "../src/bring-in.ts";

const NOW = 1_000_000_000;
const folder = { extensions: "", since: NOW - 60_000 };
const entry = (name: string, o: Partial<{ isFile: boolean; size: number; mtime: number; birthtime: number }> = {}) => ({
  name,
  isFile: true,
  size: 10,
  mtime: NOW - 10_000,
  birthtime: NOW - 10_000,
  ...o,
});

test("a new, settled file is brought in", () => {
  assert.equal(arrivalState(entry("scan.pdf"), folder, NOW), "bring");
});

test("a file written less than 2 s ago, or still empty, waits", () => {
  assert.equal(arrivalState(entry("scan.pdf", { mtime: NOW - 500 }), folder, NOW), "wait");
  assert.equal(arrivalState(entry("scan.pdf", { size: 0 }), folder, NOW), "wait");
});

test("files there before the folder was added stay; a file copied in (born now, old mtime) comes", () => {
  assert.equal(arrivalState(entry("old.pdf", { mtime: NOW - 120_000, birthtime: NOW - 120_000 }), folder, NOW), "skip");
  assert.equal(arrivalState(entry("copied.pdf", { mtime: NOW - 9e9, birthtime: NOW - 5_000 }), folder, NOW), "bring");
});

test("downloads in progress, hidden and lock files, folders: never", () => {
  for (const name of ["a.pdf.crdownload", "a.part", "a.tmp", "a.opdownload", ".hidden", "~$report.docx"]) {
    assert.equal(arrivalState(entry(name), folder, NOW), "skip", name);
  }
  assert.equal(arrivalState(entry("Sub", { isFile: false }), folder, NOW), "skip");
});

test("an extension list keeps only those, case and dot ignored", () => {
  const pdf = { ...folder, extensions: ".PDF, jpg" };
  assert.equal(arrivalState(entry("a.pdf"), pdf, NOW), "bring");
  assert.equal(arrivalState(entry("b.JPG"), pdf, NOW), "bring");
  assert.equal(arrivalState(entry("setup.exe"), pdf, NOW), "skip");
  assert.equal(arrivalState(entry("README"), pdf, NOW), "skip");
});

const r = String.raw;

test("normalize: damaged entries dropped, a missing since is now (never everything already there)", () => {
  const out = normalizeBringIn([{ source: ` "${r`C:\Users\me\Downloads`}\\" `, target: "/Inbox/", extensions: "pdf" }, { source: "" }, null, "x", { id: "b7", source: r`D:\Scans`, since: 5 }], NOW);
  assert.deepEqual(out, [
    { id: "b1", source: r`C:\Users\me\Downloads`, target: "Inbox", extensions: "pdf", since: NOW },
    { id: "b7", source: r`D:\Scans`, target: "", extensions: "", since: 5 },
  ]);
  assert.deepEqual(normalizeBringIn(undefined), []);
});

test("paths: inside, cleaned, named, described", () => {
  assert.ok(isInside("c:/users/me/vault/Inbox", r`C:\Users\me\Vault`));
  assert.ok(isInside(r`C:\Users\me\Vault` + "\\", r`C:\Users\me\Vault`));
  assert.ok(!isInside(r`C:\Users\me\Vault2`, r`C:\Users\me\Vault`));
  assert.ok(!isInside(r`C:\Users\me\Downloads`, r`C:\Users\me\Vault`));
  assert.equal(cleanSource(r`C:\Downloads` + "\\\\"), r`C:\Downloads`);
  assert.equal(sourceName(r`C:\Users\me\Downloads`), "Downloads");
  assert.equal(describeBringIn({ source: r`C:\Downloads`, target: "", extensions: "pdf jpg" }), r`C:\Downloads → vault root (pdf jpg)`);
});
