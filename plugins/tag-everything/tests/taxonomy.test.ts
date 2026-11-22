import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSynonyms, editDistance, mergeMapping, rareTags, similarTags, synonymPrompt } from "../src/taxonomy.ts";
import { makeRule } from "../src/naming.ts";

const counts = (o: Record<string, number>): Map<string, number> => new Map(Object.entries(o));

test("similarTags: same word once case, accents and plural are ignored; merged into the most used", () => {
  const c = similarTags(counts({ facture: 12, Factures: 3, facturé: 1, banque: 4, q1: 2, q2: 2, Doc: 1, doc: 3 }));
  assert.deepEqual(c.map((g) => [g.tags.join(), g.into, g.sure]), [
    ["facture,Factures,facturé", "facture", true],
    ["doc,Doc", "doc", true], // short words: only case, accents and plural link them
  ]);
});

test("similarTags: a one-letter typo or swap is a guess; short words and numbers are never typos", () => {
  const c = similarTags(counts({ receipt: 5, reciept: 1, recipe: 1, tax: 2, tag: 2, invoice1: 1, invoice2: 1, "2024": 1, "2025": 1 }));
  assert.equal(c.length, 1, JSON.stringify(c));
  assert.deepEqual(c[0].tags, ["receipt", "reciept"]);
  assert.equal(c[0].sure, false);
  assert.equal(editDistance("reciept", "receipt"), 1);
});

test("rareTags: tags on one item, by name", () => {
  assert.deepEqual(rareTags(counts({ b: 1, a: 1, c: 2 })), ["a", "b"]);
});

test("mergeMapping: into tags stay, chains are followed, conflicts and cycles refused", () => {
  const ok = mergeMapping([
    { from: ["factures", "facture"], into: ["facture"] },
    { from: ["bill"], into: ["factures"] },
    { from: ["oops"], into: [] },
  ]);
  assert.ok("mapping" in ok);
  assert.deepEqual([...ok.mapping], [["factures", ["facture"]], ["bill", ["facture"]], ["oops", []]]);
  const conflict = mergeMapping([{ from: ["a"], into: ["b"] }, { from: ["a"], into: ["c"] }]);
  assert.ok("error" in conflict && /"a" is in two changes/.test(conflict.error));
  const cycle = mergeMapping([{ from: ["a"], into: ["b"] }, { from: ["b"], into: ["a"] }]);
  assert.ok("error" in cycle && /merge into each other/.test(cycle.error));
});

test("cleanSynonyms: vault spelling, unknown tags dropped, into put to the rule, a tag in one group only", () => {
  const c = counts({ banque: 9, bancaire: 2, Invoice: 4, facture: 6, solo: 1 });
  const answer = {
    groups: [
      { tags: ["banque", "BANCAIRE", "ghost"], into: "banque", reason: "synonyms" },
      { tags: ["invoice", "facture"], into: "Facture-Client", reason: "translation" }, // two words: falls back
      { tags: ["bancaire", "solo"], into: "solo" }, // bancaire already grouped: solo alone, nothing to merge
      { tags: ["solo"], into: "unique" }, // a rename to a new tag
      "junk",
    ],
  };
  const out = cleanSynonyms(answer, c, makeRule());
  assert.deepEqual(out.map((g) => [g.tags.join(), g.into, g.sure]), [
    ["banque,bancaire", "banque", false],
    ["facture,Invoice", "facture", false],
    ["solo", "unique", false],
  ]);
  assert.throws(() => cleanSynonyms({ nope: 1 }, c, null), /no group list/);
});

test("synonymPrompt: lists the tags with their counts and the naming rule", () => {
  const p = synonymPrompt(counts({ banque: 9 }), { tagRule: true, stopWords: "de la", lowercase: false });
  assert.match(p, /`banque` 9/);
  assert.match(p, /ONE lower-case word.*de la/);
});
