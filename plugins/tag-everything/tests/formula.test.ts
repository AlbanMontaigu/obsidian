import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, formatFormula, formulaTags, parseFormula, prune, requiredTags, resolveTags, toggleNot, tryParseFormula } from "../src/formula.ts";

const fmt = (s: string): string => formatFormula(parseFormula(s));
const matches = (formula: string, tags: string[]): boolean => evaluate(parseFormula(formula), (t) => tags.includes(t));

test("parse + format: canonical text, parentheses only where needed", () => {
  assert.equal(fmt("(BBB ou XXX) et (YYY ou ZZZ)"), "(BBB OR XXX) AND (YYY OR ZZZ)");
  assert.equal(fmt("a and b or c"), "a AND b OR c", "AND binds tighter than OR");
  assert.equal(fmt("a and (b or c)"), "a AND (b OR c)");
  assert.equal(fmt("((a))"), "a");
  assert.equal(fmt("a b c"), "a AND b AND c", "side by side = AND");
  assert.equal(fmt("a & b | !c"), "a AND b OR NOT c");
  assert.equal(fmt("non (a ou b)"), "NOT (a OR b)");
  assert.equal(fmt("#a OR #b"), "a OR b", "leading # ignored");
  assert.equal(fmt("proj/alpha OR B27_v2"), "proj/alpha OR B27_v2");
  assert.equal(fmt('"or" et "a(b)"'), '"or" AND "a(b)"', "quoted tags");
  assert.equal(fmt("a AND (b AND c)"), "a AND b AND c", "flattened");
});

test("format round-trips", () => {
  for (const s of ["(a OR b) AND (c OR NOT d)", 'NOT (a AND b) OR "et"', "a", "a OR b OR c AND d"]) {
    assert.equal(fmt(fmt(s)), fmt(s), s);
  }
});

test("syntax errors are readable", () => {
  const err = (s: string): string => {
    const r = tryParseFormula(s);
    return "error" in r ? r.error : "";
  };
  assert.match(err(""), /empty/);
  assert.match(err("   "), /empty/);
  assert.match(err("(a OR b"), /not closed/);
  assert.match(err("a OR b)"), /no matching/);
  assert.match(err("a AND"), /missing after AND/);
  assert.match(err("OR a"), /missing before OR/);
  assert.match(err("a OR AND b"), /between OR and AND/);
  assert.match(err("a ()"), /Empty parentheses/);
  assert.match(err('a "b'), /not closed/);
});

test("evaluate", () => {
  const f = "(BBB OR XXX) AND (YYY OR ZZZ)";
  assert.equal(matches(f, ["BBB", "ZZZ"]), true);
  assert.equal(matches(f, ["XXX", "YYY", "other"]), true);
  assert.equal(matches(f, ["BBB", "XXX"]), false);
  assert.equal(matches(f, []), false);
  assert.equal(matches("a AND NOT b", ["a"]), true);
  assert.equal(matches("a AND NOT b", ["a", "b"]), false);
});

test("formulaTags: each tag once, in reading order", () => {
  assert.deepEqual(formulaTags(parseFormula("(b OR a) AND NOT (a OR c)")), ["b", "a", "c"]);
});

test("prune: a switched-off tag drops out of its AND / OR, NOT goes with it", () => {
  const f = parseFormula("(BBB OR XXX) AND (YYY OR ZZZ) AND NOT old");
  const without = (...off: string[]): string | null => {
    const p = prune(f, (t) => !off.includes(t));
    return p && formatFormula(p);
  };
  assert.equal(without("XXX"), "BBB AND (YYY OR ZZZ) AND NOT old");
  assert.equal(without("YYY", "ZZZ"), "(BBB OR XXX) AND NOT old");
  assert.equal(without("old"), "(BBB OR XXX) AND (YYY OR ZZZ)");
  assert.equal(without("BBB", "XXX", "YYY", "ZZZ", "old"), null);
});

test("resolveTags: the vault's spelling wins, unknown tags kept", () => {
  const e = resolveTags(parseFormula("b27 OR Shared OR nope"), ["B27", "shared"]);
  assert.equal(formatFormula(e), "B27 OR shared OR nope");
});

test("toggleNot: tag <-> NOT tag wherever it is written, the rest untouched", () => {
  const flip = (s: string, tag: string): string => formatFormula(toggleNot(parseFormula(s), tag));
  assert.equal(flip("(a OR b) AND c", "b"), "(a OR NOT b) AND c");
  assert.equal(flip("(a OR NOT b) AND c", "b"), "(a OR b) AND c");
  assert.equal(flip("NOT (a OR b)", "a"), "NOT (NOT a OR b)", "only a tag directly under NOT is un-negated");
  assert.equal(flip("a AND c", "zzz"), "a AND c");
});

test("requiredTags: the tags every match carries (AND: all, OR: common, NOT: none)", () => {
  const req = (s: string): string[] => requiredTags(parseFormula(s));
  assert.deepEqual(req("tax receipt"), ["tax", "receipt"]);
  assert.deepEqual(req("tax AND (a OR tax AND b)"), ["tax"]);
  assert.deepEqual(req("(tax AND a) OR (b AND tax)"), ["tax"]);
  assert.deepEqual(req("a OR b"), []);
  assert.deepEqual(req("tax AND NOT b"), ["tax"]);
  assert.deepEqual(req("tax AND tax"), ["tax"]);
});

test("date terms: parsed with units, created / modified (also créé / modifié), > = older", async () => {
  const { dateExpr } = await import("../src/formula.ts");
  assert.deepEqual(parseFormula("created:30d"), dateExpr("created", { within: true, days: 30 }));
  assert.deepEqual(parseFormula("modified:>1y"), dateExpr("modified", { within: false, days: 365 }));
  assert.deepEqual(parseFormula("Créé:2w"), dateExpr("created", { within: true, days: 14 }));
  assert.deepEqual(parseFormula("modifie:3m"), dateExpr("modified", { within: true, days: 90 }));
  assert.deepEqual(parseFormula("created:7"), dateExpr("created", { within: true, days: 7 }));
  assert.equal(formatFormula(parseFormula("tax created:30d")), "tax AND created:30d");
  assert.equal(formatFormula(parseFormula("NOT modified:>730d OR a")), "NOT modified:>2y OR a");
  assert.match((tryParseFormula("created:soon") as { error: string }).error, /created:30d/);
  assert.match((tryParseFormula("created:0d") as { error: string }).error, /created:30d/);
  // a tag spelled like a date term is quoted, and stays a tag
  assert.deepEqual(parseFormula('"created:30d"'), { k: "tag", tag: "created:30d" });
  assert.equal(formatFormula({ k: "tag", tag: "created:30d" }), '"created:30d"');
  assert.deepEqual(parseFormula("note:x"), { k: "tag", tag: "note:x" }, "another prefix is a tag");
});

test("date terms: evaluated with dated, never a tag; prune keeps them unless told", async () => {
  const { dateExpr, topDates, withTopDates, hasDateTerms } = await import("../src/formula.ts");
  const e = parseFormula("tax AND created:30d");
  assert.equal(evaluate(e, () => true, (f, r) => f === "created" && r.days === 30), true);
  assert.equal(evaluate(e, () => true, () => false), false);
  assert.equal(evaluate(e, () => true), false, "no dates known: no match");
  assert.deepEqual(formulaTags(e), ["tax"]);
  assert.deepEqual(requiredTags(e), ["tax"]);
  assert.equal(formatFormula(prune(e, () => false)!), "created:30d");
  assert.equal(formatFormula(prune(e, () => true, () => false)!), "tax");
  assert.equal(formatFormula(toggleNot(e, "tax")), "NOT tax AND created:30d");
  assert.equal(formatFormula(resolveTags(parseFormula("TAX modified:1d"), ["tax"])), "tax AND modified:1d");
  assert.equal(hasDateTerms(e), true);
  assert.equal(hasDateTerms(parseFormula("a OR b")), false);
  assert.deepEqual(topDates(e), { created: { within: true, days: 30 } });
  assert.equal(formatFormula(withTopDates(e, { modified: { within: false, days: 365 } })!), "tax AND modified:>1y");
  assert.equal(withTopDates(dateExpr("created", { within: true, days: 1 }), {}), null);
});

test("splitSearch: plain tags, NOT tags and dates at the top become the panel's chips, the rest one formula", async () => {
  const { splitSearch } = await import("../src/formula.ts");
  const s = splitSearch(parseFormula("a AND NOT b AND (c OR d) AND created:30d AND a"));
  assert.deepEqual([s.tags, s.not, s.dates], [["a"], ["b"], { created: { within: true, days: 30 } }]);
  assert.equal(formatFormula(s.rest!), "c OR d");
  assert.equal(splitSearch(parseFormula("a b")).rest, null);
  assert.equal(formatFormula(splitSearch(parseFormula("a OR b")).rest!), "a OR b");
  assert.equal(formatFormula(splitSearch(parseFormula("NOT (a OR b)")).rest!), "NOT (a OR b)");
  assert.deepEqual(splitSearch(null), { tags: [], not: [], dates: {}, rest: null });
  // a tag both wanted and excluded keeps the contradiction in the formula, not silently dropped
  const both = splitSearch(parseFormula("a AND NOT a"));
  assert.deepEqual([both.tags, both.not, formatFormula(both.rest!)], [["a"], [], "NOT a"]);
});
