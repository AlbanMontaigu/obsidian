import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, formatFormula, formulaTags, parseFormula, prune, resolveTags, toggleNot, tryParseFormula } from "../src/formula.ts";

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
