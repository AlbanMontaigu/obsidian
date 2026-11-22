import { test } from "node:test";
import assert from "node:assert/strict";
import { type AutoTagRule, ageText, deleteRule, describeRule, inboxPaths, normalizeRules, ruleMatches, rulesTags, saveRule } from "../src/inbox.ts";

const rule = (r: Partial<AutoTagRule>): AutoTagRule => ({ id: "r1", folder: "", words: "", extensions: "", tags: ["x"], ...r });

test("ruleMatches: folder at any depth, a word of the name (case, accents), an extension; all set conditions", () => {
  const r = rule({ folder: "Banque/", words: "facture, Invoice", extensions: ".PDF docx" });
  assert.ok(ruleMatches(r, "banque/2025/Facturé_EDF.pdf"), "folder any case, accents ignored");
  assert.ok(ruleMatches(r, "Banque/my invoice.docx"));
  assert.ok(!ruleMatches(r, "Banque/facture.xlsx"), "wrong extension");
  assert.ok(!ruleMatches(r, "Banque/releve.pdf"), "no word");
  assert.ok(!ruleMatches(r, "BanqueX/facture.pdf"), "a folder is a whole path segment");
  assert.ok(!ruleMatches(r, "Other/facture.pdf"));
});

test("ruleMatches: the name is read without its tags; a rule without condition matches nothing", () => {
  assert.ok(!ruleMatches(rule({ words: "tax" }), "report[tax].pdf"), "a tag is not a word of the name");
  assert.ok(ruleMatches(rule({ words: "tax" }), "[tax].pdf"), "a name made only of tags is read as it is, never throws");
  assert.ok(!ruleMatches(rule({}), "anything.pdf"));
});

test("rulesTags: every matching rule's tags, once, without those the file has", () => {
  const rules = [rule({ extensions: "pdf", tags: ["scan", "Doc"] }), rule({ id: "r2", words: "edf", tags: ["energie", "doc"] })];
  assert.deepEqual(rulesTags(rules, "edf.pdf", ["doc"]), ["scan", "energie"]);
  assert.deepEqual(rulesTags(rules, "note.md", []), []);
});

test("normalizeRules: damaged entries, rules without tag or condition dropped; ids repaired", () => {
  const out = normalizeRules([
    { id: "r1", folder: "/A/", tags: ["t"] },
    { id: "r1", words: "w", tags: ["u", 3] },
    { folder: "", words: "", extensions: "", tags: ["v"] },
    { folder: "B", tags: [] },
    "junk",
  ]);
  assert.deepEqual(out, [
    { id: "r1", folder: "A", words: "", extensions: "", tags: ["t"] },
    { id: "r2", folder: "", words: "w", extensions: "", tags: ["u"] },
  ]);
  assert.deepEqual(normalizeRules(undefined), []);
});

test("saveRule / deleteRule / describeRule", () => {
  let rules = saveRule([] as AutoTagRule[], { folder: "Banque", words: "facture invoice", extensions: "pdf", tags: ["banque", "facture"] });
  rules = saveRule(rules, { ...rules[0], tags: ["finance"] });
  assert.equal(rules.length, 1);
  assert.equal(describeRule(rules[0]), "In Banque · name has facture or invoice · pdf → finance");
  rules = saveRule(rules, { folder: "", words: "", extensions: "jpg", tags: ["photo"] });
  assert.deepEqual(rules.map((r) => r.id), ["r1", "r2"]);
  assert.deepEqual(deleteRule(rules, "r1").map((r) => r.id), ["r2"]);
});

test("inboxPaths: untagged, arrived in the last days, not dismissed, newest first", () => {
  const day = 24 * 3600_000;
  const now = 100 * day;
  const files = [
    { path: "old.pdf", ctime: now - 40 * day, tagged: false },
    { path: "a.pdf", ctime: now - 2 * day, tagged: false },
    { path: "b.pdf", ctime: now - day, tagged: false },
    { path: "tagged.pdf", ctime: now, tagged: true },
    { path: "gone.pdf", ctime: now, tagged: false },
  ];
  assert.deepEqual(inboxPaths(files, now, 30, new Set(["gone.pdf"])), ["b.pdf", "a.pdf"]);
});

test("inboxPaths: focused on a folder, at any depth, case and accents ignored, whole segments", () => {
  const files = ["Scans/a.pdf", "scans/2025/b.pdf", "ScansOld/c.pdf", "d.pdf", "Other/Scans/e.pdf"].map((path) => ({ path, ctime: 1, tagged: false }));
  assert.deepEqual(inboxPaths(files, 1, 30, new Set(), "/Scáns/"), ["scans/2025/b.pdf", "Scans/a.pdf"]);
  assert.equal(inboxPaths(files, 1, 30, new Set(), "").length, 5, "empty = the whole vault");
});

test("inboxPaths: date criteria: created replaces the last days, modified is checked too", () => {
  const day = 24 * 3600_000;
  const now = 1000 * day;
  const files = [
    { path: "new.pdf", ctime: now - day, mtime: now - day, tagged: false },
    { path: "old.pdf", ctime: now - 400 * day, mtime: now - 400 * day, tagged: false },
    { path: "old-touched.pdf", ctime: now - 400 * day, mtime: now - 2 * day, tagged: false },
  ];
  assert.deepEqual(inboxPaths(files, now, 30, new Set(), "", { created: { within: false, days: 365 } }), ["old-touched.pdf", "old.pdf"]);
  assert.deepEqual(inboxPaths(files, now, 30, new Set(), "", { created: { within: false, days: 365 }, modified: { within: true, days: 7 } }), ["old-touched.pdf"]);
  assert.deepEqual(inboxPaths(files, now, 30, new Set(), "", { modified: { within: true, days: 7 } }), ["new.pdf"], "still within the last 30 days created");
  assert.deepEqual(inboxPaths([{ path: "a.pdf", ctime: now - 400 * day, tagged: false }], now, 30, new Set(), "", { modified: { within: false, days: 365 }, created: { within: false, days: 1 } }), ["a.pdf"], "mtime defaults to ctime");
});

test("ageText", () => {
  assert.equal(ageText(10_000), "just now");
  assert.equal(ageText(5 * 60_000), "5 min");
  assert.equal(ageText(3 * 3600_000), "3 h");
  assert.equal(ageText(50 * 3600_000), "2 d");
});
