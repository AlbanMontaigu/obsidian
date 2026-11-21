import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STOP_WORDS,
  auditTags,
  followsRule,
  makeRule,
  parseReplacement,
  parseStopWords,
  parseTypedTags,
  replacePlan,
  ruleMessage,
  ruleProblem,
  suggestFix,
} from "../src/naming.ts";
import { mapTagList } from "../src/format.ts";
import { formatFormula, parseFormula, replaceTagsInExpr } from "../src/formula.ts";
import { replaceTagsInGroups, type TagGroup } from "../src/groups.ts";
import { replaceTagsInTabs } from "../src/tabs.ts";

const rule = makeRule();
const map = (o: Record<string, string[]>) => new Map(Object.entries(o));

test("rule: lower-case plain words pass, accents and digits included", () => {
  for (const t of ["tax", "b27", "2026", "réunion", "q3", "élève"]) assert.ok(followsRule(t, rule), t);
});

test("rule: upper case, separators (/ included), signs and liaison words fail", () => {
  assert.equal(ruleProblem("Tax", rule), "lower-case only");
  assert.equal(ruleProblem("tax-receipt", rule), "one word per tag (no space, /, - or _)");
  assert.equal(ruleProblem("tax_receipt", rule), "one word per tag (no space, /, - or _)");
  assert.equal(ruleProblem("v1.2", rule), "one word per tag (no space, /, - or _)");
  assert.equal(ruleProblem("proj/alpha", rule), "one word per tag (no space, /, - or _)");
  assert.equal(ruleProblem("r&d", rule), "letters and digits only");
  assert.equal(ruleProblem("#tax", rule), "letters and digits only");
  assert.equal(ruleProblem("de", rule), '"de" is a liaison word');
  assert.equal(ruleProblem("the", rule), '"the" is a liaison word');
});

test("suggestFix: lower-case, split into words, liaison words dropped", () => {
  assert.deepEqual(suggestFix("Tax-Receipt", rule), ["tax", "receipt"]);
  assert.deepEqual(suggestFix("plan_de_charge", rule), ["plan", "charge"]);
  assert.deepEqual(suggestFix("B27", rule), ["b27"]);
  assert.deepEqual(suggestFix("l'équipe", rule), ["équipe"]);
  assert.deepEqual(suggestFix("Projet  Été", rule), ["projet", "été"]);
  assert.deepEqual(suggestFix("#Todo", rule), ["todo"]);
  assert.deepEqual(suggestFix("de", rule), []);
  assert.deepEqual(suggestFix("R&D", rule), ["rd"]);
  assert.deepEqual(suggestFix("A.B.C", rule), ["abc"]);
  assert.deepEqual(suggestFix("d'accord", rule), ["accord"]);
  assert.deepEqual(suggestFix("tax-tax", rule), ["tax"]);
  assert.deepEqual(suggestFix("tax", rule), ["tax"]);
});

test("suggestFix: / splits like -, a nested tag becomes one tag per word", () => {
  assert.deepEqual(suggestFix("Proj/Alpha-Beta", rule), ["proj", "alpha", "beta"]);
  assert.deepEqual(suggestFix("proj/de", rule), ["proj"]);
  assert.deepEqual(suggestFix("my-proj/alpha", rule), ["my", "proj", "alpha"]);
  assert.deepEqual(suggestFix("proj//alpha/", rule), ["proj", "alpha"]);
});

test("every suggested fix follows the rule", () => {
  for (const t of ["Tax-Receipt", "plan_de_charge", "Proj/Alpha-Beta", "l'équipe", "R&D", "A.B.C", "x--y"]) {
    for (const f of suggestFix(t, rule) ?? []) assert.ok(followsRule(f, rule), `${t} -> ${f}`);
  }
});

test("stop words: parsed from settings text, custom list replaces the default", () => {
  assert.deepEqual(parseStopWords("De, LA;\nthe  the"), ["de", "la", "the"]);
  const custom = makeRule("foo");
  assert.ok(followsRule("de", custom));
  assert.ok(!followsRule("foo", custom));
  assert.ok(parseStopWords(DEFAULT_STOP_WORDS).includes("de"));
  for (const keep of ["it", "us", "or2", "pas", "est", "y"]) assert.ok(followsRule(keep, rule), `${keep} must stay usable`);
});

test("ruleMessage: names the tag, the problem and the fix", () => {
  assert.equal(ruleMessage("Tax-Receipt", rule), '"Tax-Receipt": one word per tag (no space, /, - or _); use "tax receipt"');
  assert.equal(ruleMessage("de", rule), '"de": "de" is a liaison word; left out');
  assert.equal(ruleMessage("proj/alpha", rule), '"proj/alpha": one word per tag (no space, /, - or _); use "proj alpha"');
  assert.equal(ruleMessage("tax", rule), null);
});

test("parseTypedTags: without a rule it is parseTagInput", () => {
  assert.deepEqual(parseTypedTags("Tax-Receipt b", null), { tags: ["Tax-Receipt", "b"], errors: [], rest: "" });
});

test("parseTypedTags: lower-cases, refuses with the fix in the box, drops liaison words", () => {
  assert.deepEqual(parseTypedTags("Tax q3", rule), { tags: ["tax", "q3"], errors: [], rest: "" });
  const r = parseTypedTags("Tax-Receipt q3 de", rule);
  assert.deepEqual(r.tags, ["q3"]);
  assert.equal(r.rest, "tax receipt");
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /^"Tax-Receipt": one word/);
  // a word that can't be a tag at all stays as typed, with the old message
  const bad = parseTypedTags("a:b", rule);
  assert.equal(bad.rest, "a:b");
  assert.match(bad.errors[0], /cannot contain/);
  // `/` splits like `-`, for a note (nested allowed) as for a file name (where `/` is not even valid)
  for (const nested of [true, false]) {
    const n = parseTypedTags("Proj/Alpha proj/", rule, false, nested);
    assert.deepEqual([n.tags, n.rest], [[], "proj alpha"], `nested=${nested}`);
    assert.match(n.errors[0], /^"Proj\/Alpha": one word per tag \(no space, \/, - or _\); use "proj alpha"$/);
  }
});

test("auditTags: only the tags breaking the rule, most used first", () => {
  const issues = auditTags(new Map([["tax", 9], ["B27", 2], ["Tax-Receipt", 5], ["de", 2]]), rule);
  assert.deepEqual(issues.map((i) => i.tag), ["Tax-Receipt", "B27", "de"]);
  assert.deepEqual(issues[0].fix, ["tax", "receipt"]);
  assert.equal(issues[0].count, 5);
  assert.deepEqual(issues[2].fix, []);
  assert.deepEqual(auditTags(new Map([["ok", 1]]), rule), []);
});

test("mapTagList: replaced in place, once each", () => {
  assert.deepEqual(mapTagList(["a", "Tax-Receipt", "tax", "de"], map({ "Tax-Receipt": ["tax", "receipt"], de: [] })), ["a", "tax", "receipt"]);
});

test("replacePlan: a fix stays where the tag was", () => {
  const p = replacePlan({ nameTags: ["B27", "INC"], frontTags: ["Tax-Receipt", "q3"], sideTags: ["de"] }, map({ B27: ["b27"], INC: ["inc"], "Tax-Receipt": ["tax", "receipt"], de: [] }));
  assert.deepEqual(p.nameTags, ["b27", "inc"]);
  assert.deepEqual(p.frontTags, ["tax", "receipt", "q3"]);
  assert.deepEqual(p.sideTags, []);
  assert.ok(p.renamed && p.frontChanged && p.sideChanged);
});

test("replacePlan: a replacement the item already carries is not added twice", () => {
  // name B27 -> b27, but b27 is already in the frontmatter: the name loses B27, the frontmatter keeps b27
  const p = replacePlan({ nameTags: ["B27"], frontTags: ["b27"], sideTags: [] }, map({ B27: ["b27"] }));
  assert.deepEqual(p.nameTags, []);
  assert.deepEqual(p.frontTags, ["b27"]);
  assert.ok(p.renamed && !p.frontChanged);
  // the same replacement from two places lands in the first (name)
  const q = replacePlan({ nameTags: ["Tax"], frontTags: [], sideTags: ["TAX"] }, map({ Tax: ["tax"], TAX: ["tax"] }));
  assert.deepEqual([q.nameTags, q.sideTags], [["tax"], []]);
});

test("replacePlan: nothing mapped, nothing changes", () => {
  const p = replacePlan({ nameTags: ["a"], frontTags: ["b"], sideTags: ["c"] }, map({ x: ["y"] }));
  assert.ok(!p.renamed && !p.frontChanged && !p.sideChanged);
});

test("parseReplacement: empty drops the tag, each tag must follow the rule", () => {
  assert.deepEqual(parseReplacement("", rule), { tags: [] });
  assert.deepEqual(parseReplacement("tax, receipt tax", rule), { tags: ["tax", "receipt"] });
  assert.ok("error" in parseReplacement("Tax", rule));
});

test("replaceTagsInExpr: a tag becomes the AND of its fix, a dropped one is pruned", () => {
  const m = map({ "Tax-Receipt": ["tax", "receipt"], de: [] });
  assert.equal(formatFormula(replaceTagsInExpr(parseFormula('("Tax-Receipt" OR q3) AND NOT de'), m)!), "tax AND receipt OR q3");
  assert.equal(formatFormula(replaceTagsInExpr(parseFormula('NOT "Tax-Receipt" AND q3'), m)!), "NOT (tax AND receipt) AND q3");
  assert.equal(replaceTagsInExpr(parseFormula("de"), m), null);
});

test("replaceTagsInGroups / replaceTagsInTabs: follow the fix, others untouched", () => {
  const m = map({ "Tax-Receipt": ["tax", "receipt"], B27: ["b27"] });
  const plain: TagGroup = { id: "g1", name: "A", tags: ["B27", "tax"], collapsed: false };
  const withF: TagGroup = { id: "g2", name: "B", tags: ["Tax-Receipt", "x"], collapsed: false, formula: '"Tax-Receipt" OR x' };
  const other: TagGroup = { id: "g3", name: "C", tags: ["x"], collapsed: false };
  const broken: TagGroup = { id: "g4", name: "D", tags: ["B27"], collapsed: false, formula: "B27 AND (" };
  const [a, b, c, d] = replaceTagsInGroups([plain, withF, other, broken], m);
  assert.deepEqual(a.tags, ["b27", "tax"]);
  assert.equal(b.formula, "tax AND receipt OR x");
  assert.deepEqual(b.tags, ["tax", "receipt", "x"]);
  assert.equal(c, other);
  assert.equal(d, broken);
  const [t] = replaceTagsInTabs([{ id: "t1", name: "W", tags: ["B27", "b27", "y"], groups: ["g1"] }], m);
  assert.deepEqual(t.tags, ["b27", "y"]);
  assert.deepEqual(t.groups, ["g1"]);
});
