// Tag formulas of the panel's groups: `(BBB OR XXX) AND (YYY OR ZZZ)`. Pure, no `obsidian` import (unit-tested).
//
// Syntax: tags, AND / OR / NOT (also ET / OU / NON, & / | / !, case-insensitive) and parentheses. Two terms side
// by side mean AND. Precedence: NOT, then AND, then OR. A tag containing a parenthesis or spelled like an
// operator is written in double quotes ("or", "a(b)"); a leading # is ignored; !tag = NOT tag.
// Date terms (src/dates.ts): `created:30d` = created in the last 30 days, `modified:>1y` = modified more than a year
// ago; units d, w (7 days), m (30 days), y (365 days), default d; also `créé:` / `modifié:`. A folder meets none.

import { DATE_FIELDS, type DateField, type DateFilters, type DateRange } from "./dates.ts";

export type DateExpr = { k: "date"; field: DateField; range: DateRange };

export type Expr =
  | { k: "tag"; tag: string }
  | DateExpr
  | { k: "and"; items: Expr[] }
  | { k: "or"; items: Expr[] }
  | { k: "not"; item: Expr };

type Op = "and" | "or" | "not";
type Token = { t: "(" | ")" } | { t: Op } | { t: "tag"; v: string } | { t: "date"; e: DateExpr };

const DATE_WORDS: Record<string, DateField> = { created: "created", créé: "created", cree: "created", modified: "modified", modifié: "modified", modifie: "modified" };
const UNIT_DAYS: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };

const OPS: Record<string, Op> = {
  and: "and",
  et: "and",
  "&": "and",
  "&&": "and",
  or: "or",
  ou: "or",
  "|": "or",
  "||": "or",
  not: "not",
  non: "not",
  "!": "not",
};

export function tagExpr(tag: string): Expr {
  return { k: "tag", tag };
}

export function notExpr(e: Expr): Expr {
  return { k: "not", item: e };
}

export function dateExpr(field: DateField, range: DateRange): DateExpr {
  return { k: "date", field, range };
}

/** The date criteria as terms, created first. */
export function dateExprs(f: DateFilters): DateExpr[] {
  return DATE_FIELDS.flatMap((k) => (f[k] ? [dateExpr(k, f[k])] : []));
}

/** `created:30d`, `modified:>1y`: the canonical text of a date term (a whole number of years written in y). */
export function dateTermText(e: DateExpr): string {
  const { within, days } = e.range;
  return `${e.field}:${within ? "" : ">"}${days % 365 === 0 ? `${days / 365}y` : `${days}d`}`;
}

/** `created`, `modifié`...: a word that starts a date term before its colon. */
export function isDateWord(word: string): boolean {
  return !!DATE_WORDS[word.toLowerCase()];
}

/** A word that starts with a date field and a colon: a date term (throws when its value is not one); else null. */
function parseDateWord(word: string): DateExpr | null {
  const colon = word.indexOf(":");
  const field = colon > 0 ? DATE_WORDS[word.slice(0, colon).toLowerCase()] : undefined;
  if (!field) return null;
  const m = /^(>|<)?(\d+)([dwmy])?$/i.exec(word.slice(colon + 1));
  const name = word.slice(0, colon);
  if (!m || Number(m[2]) < 1) throw new Error(`Write a date as ${name}:30d (in the last 30 days) or ${name}:>1y (more than a year ago)`);
  return dateExpr(field, { within: m[1] !== ">", days: Number(m[2]) * UNIT_DAYS[(m[3] ?? "d").toLowerCase()] });
}

/** Does the formula hold a date term? */
export function hasDateTerms(e: Expr): boolean {
  switch (e.k) {
    case "date":
      return true;
    case "tag":
      return false;
    case "not":
      return hasDateTerms(e.item);
    default:
      return e.items.some(hasDateTerms);
  }
}

/** The date terms ANDed at the top of the formula (those the explorer's Dates menu edits). */
export function topDates(e: Expr | null): DateFilters {
  const out: DateFilters = {};
  for (const x of !e ? [] : e.k === "and" ? e.items : [e]) if (x.k === "date") out[x.field] = x.range;
  return out;
}

/** The formula with its top date terms replaced by `f` (src/dates.ts); null when nothing is left. */
export function withTopDates(e: Expr | null, f: DateFilters): Expr | null {
  const rest = !e ? [] : e.k === "and" ? e.items : [e];
  return andOf([...rest.filter((x) => x.k !== "date"), ...dateExprs(f)]);
}

/** A formula as the panel's search holds it: tags, NOT tags and dates ANDed at the top, and the rest (ORs...). */
export interface SplitSearch {
  tags: string[];
  not: string[];
  dates: DateFilters;
  /** What is not a plain tag, NOT tag or date at the top (one date per field), ANDed; null when nothing is left. */
  rest: Expr | null;
}

/**
 * Splits a formula into the panel's plain search (shown as chips) and the rest (shown as one formula chip):
 * `a AND NOT b AND (c OR d) AND created:30d` → tags a, not b, created 30 days, rest `c OR d`.
 */
export function splitSearch(e: Expr | null): SplitSearch {
  const out: SplitSearch = { tags: [], not: [], dates: {}, rest: null };
  const rest: Expr[] = [];
  for (const x of !e ? [] : e.k === "and" ? e.items : [e]) {
    if (x.k === "tag") {
      if (!out.tags.includes(x.tag)) out.tags.push(x.tag);
    } else if (x.k === "not" && x.item.k === "tag" && !out.tags.includes(x.item.tag)) {
      if (!out.not.includes(x.item.tag)) out.not.push(x.item.tag);
    } else if (x.k === "date" && !out.dates[x.field]) out.dates[x.field] = x.range;
    else rest.push(x);
  }
  out.rest = andOf(rest);
  return out;
}

/** AND of the parts, flattened; null when there is none, the part itself when there is one. */
export function andOf(parts: readonly (Expr | null)[]): Expr | null {
  return combine("and", parts);
}

export function orOf(parts: readonly (Expr | null)[]): Expr | null {
  return combine("or", parts);
}

function combine(k: "and" | "or", parts: readonly (Expr | null)[]): Expr | null {
  const items: Expr[] = [];
  for (const p of parts) {
    if (!p) continue;
    if (p.k === k) items.push(...p.items);
    else items.push(p);
  }
  if (!items.length) return null;
  return items.length === 1 ? items[0] : { k, items };
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "(" || c === ")") {
      out.push({ t: c });
      i++;
    } else if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) throw new Error('A quote " is not closed');
      const v = text.slice(i + 1, end).trim().replace(/^#/, "");
      if (!v) throw new Error('Empty tag ""');
      out.push({ t: "tag", v });
      i = end + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s()"]/.test(text[j])) j++;
      let word = text.slice(i, j);
      if (word.length > 1 && word.startsWith("!")) {
        out.push({ t: "not" }); // !tag
        word = word.slice(1);
      }
      const op = OPS[word.toLowerCase()];
      const date = op ? null : parseDateWord(word);
      if (op) out.push({ t: op });
      else if (date) out.push({ t: "date", e: date });
      else if (word.replace(/^#/, "")) out.push({ t: "tag", v: word.replace(/^#/, "") });
      i = j;
    }
  }
  return out;
}

const OP_NAMES: Record<Op, string> = { and: "AND", or: "OR", not: "NOT" };

/** Parses a formula. Throws an Error with a readable message on a syntax error or an empty formula. */
export function parseFormula(text: string): Expr {
  const toks = tokenize(text);
  let pos = 0;
  const peek = (): Token | undefined => toks[pos];

  const parseOr = (): Expr => {
    const items = [parseAnd()];
    while (peek()?.t === "or") {
      pos++;
      items.push(parseAnd("OR"));
    }
    return orOf(items)!;
  };
  const parseAnd = (after?: string): Expr => {
    const items = [parseUnary(after)];
    for (;;) {
      const t = peek()?.t;
      if (t === "and") {
        pos++;
        items.push(parseUnary("AND"));
      } else if (t === "tag" || t === "date" || t === "(" || t === "not") {
        items.push(parseUnary()); // side by side = AND
      } else break;
    }
    return andOf(items)!;
  };
  const parseUnary = (after?: string): Expr => {
    const tok = peek();
    if (tok?.t === "not") {
      pos++;
      return { k: "not", item: parseUnary("NOT") };
    }
    if (tok?.t === "tag") {
      pos++;
      return tagExpr(tok.v);
    }
    if (tok?.t === "date") {
      pos++;
      return tok.e;
    }
    if (tok?.t === "(") {
      pos++;
      if (peek()?.t === ")") throw new Error("Empty parentheses ()");
      const inner = parseOr();
      if (peek()?.t !== ")") throw new Error("A parenthesis ( is not closed");
      pos++;
      return inner;
    }
    if (!tok) throw new Error(after ? `A tag is missing after ${after}` : "The formula is empty");
    if (tok.t === ")") throw new Error("A parenthesis ) has no matching (");
    throw new Error(after ? `A tag is missing between ${after} and ${OP_NAMES[tok.t as Op]}` : `A tag is missing before ${OP_NAMES[tok.t as Op]}`);
  };

  const expr = parseOr();
  if (pos < toks.length) throw new Error("A parenthesis ) has no matching (");
  return expr;
}

/** Parses, or returns the error message. */
export function tryParseFormula(text: string): { expr: Expr } | { error: string } {
  try {
    return { expr: parseFormula(text) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function quoteTag(tag: string): string {
  const colon = tag.indexOf(":");
  const dateLike = colon > 0 && !!DATE_WORDS[tag.slice(0, colon).toLowerCase()];
  return /[\s()"]/.test(tag) || OPS[tag.toLowerCase()] || tag.startsWith("#") || dateLike ? `"${tag}"` : tag;
}

/** Canonical text: AND / OR / NOT in capitals, parentheses only where needed. Parses back to the same tree. */
export function formatFormula(e: Expr): string {
  const fmt = (x: Expr, parent: Expr["k"] | null): string => {
    switch (x.k) {
      case "tag":
        return quoteTag(x.tag);
      case "date":
        return dateTermText(x);
      case "not":
        return "NOT " + fmt(x.item, "not");
      case "and": {
        const s = x.items.map((i) => fmt(i, "and")).join(" AND ");
        return parent === "not" ? `(${s})` : s;
      }
      case "or": {
        const s = x.items.map((i) => fmt(i, "or")).join(" OR ");
        return parent === "and" || parent === "not" ? `(${s})` : s;
      }
    }
  };
  return fmt(e, null);
}

/** Every tag of the formula, once, in reading order. */
export function formulaTags(e: Expr): string[] {
  const out = new Set<string>();
  const walk = (x: Expr): void => {
    if (x.k === "tag") out.add(x.tag);
    else if (x.k === "not") walk(x.item);
    else if (x.k !== "date") x.items.forEach(walk);
  };
  walk(e);
  return [...out];
}

/** The tags every item matching the formula carries, in reading order: `tax AND (a OR tax)` -> tax; NOT gives none. */
export function requiredTags(e: Expr): string[] {
  switch (e.k) {
    case "tag":
      return [e.tag];
    case "not":
    case "date":
      return [];
    case "and":
      return [...new Set(e.items.flatMap(requiredTags))];
    case "or": {
      const [first, ...rest] = e.items.map(requiredTags);
      return first.filter((t) => rest.every((r) => r.includes(t)));
    }
  }
}

/**
 * Does an item match? `has` tells its tags, `dated` whether its dates meet a date term (default: never, as for a
 * folder; asked only for the date terms, so a caller can look the file up lazily).
 */
export function evaluate(e: Expr, has: (tag: string) => boolean, dated: (field: DateField, range: DateRange) => boolean = () => false): boolean {
  switch (e.k) {
    case "tag":
      return has(e.tag);
    case "date":
      return dated(e.field, e.range);
    case "not":
      return !evaluate(e.item, has, dated);
    case "and":
      return e.items.every((i) => evaluate(i, has, dated));
    case "or":
      return e.items.some((i) => evaluate(i, has, dated));
  }
}

/**
 * The formula without the tags `keep` rejects, as if they had never been written: a switched-off tag drops out of
 * its AND or OR, and `NOT tag` goes with it. Date terms stay, unless `keepDate` rejects them. Null when nothing is left.
 */
export function prune(e: Expr, keep: (tag: string) => boolean, keepDate: (d: DateExpr) => boolean = () => true): Expr | null {
  switch (e.k) {
    case "tag":
      return keep(e.tag) ? e : null;
    case "date":
      return keepDate(e) ? e : null;
    case "not": {
      const item = prune(e.item, keep, keepDate);
      return item ? { k: "not", item } : null;
    }
    case "and":
      return andOf(e.items.map((i) => prune(i, keep, keepDate)));
    case "or":
      return orOf(e.items.map((i) => prune(i, keep, keepDate)));
  }
}

/** `tag` ↔ `NOT tag` wherever the tag is written; the rest of the formula is unchanged. */
export function toggleNot(e: Expr, tag: string): Expr {
  switch (e.k) {
    case "tag":
      return e.tag === tag ? notExpr(e) : e;
    case "date":
      return e;
    case "not":
      return e.item.k === "tag" && e.item.tag === tag ? e.item : notExpr(toggleNot(e.item, tag));
    default:
      return { k: e.k, items: e.items.map((i) => toggleNot(i, tag)) };
  }
}

/** Tags written with another case (or without the exact spelling) mapped to the vault's own spelling. */
export function resolveTags(e: Expr, known: readonly string[]): Expr {
  const exact = new Set(known);
  const lower = new Map<string, string>();
  for (const t of known) if (!lower.has(t.toLowerCase())) lower.set(t.toLowerCase(), t);
  const map = (x: Expr): Expr => {
    switch (x.k) {
      case "tag":
        return exact.has(x.tag) ? x : tagExpr(lower.get(x.tag.toLowerCase()) ?? x.tag);
      case "date":
        return x;
      case "not":
        return { k: "not", item: map(x.item) };
      default:
        return { k: x.k, items: x.items.map(map) };
    }
  };
  return map(e);
}

/**
 * Each mapped tag replaced by the AND of its replacements (`Tax-Receipt` -> `tax AND receipt`, which finds the items
 * that carried it once they are fixed); a tag mapped to nothing is pruned like a switched-off tag. Null if nothing
 * is left.
 */
export function replaceTagsInExpr(e: Expr, mapping: ReadonlyMap<string, readonly string[]>): Expr | null {
  switch (e.k) {
    case "tag": {
      const repl = mapping.get(e.tag);
      return repl ? andOf(repl.map(tagExpr)) : e;
    }
    case "date":
      return e;
    case "not": {
      const item = replaceTagsInExpr(e.item, mapping);
      return item ? { k: "not", item } : null;
    }
    case "and":
      return andOf(e.items.map((i) => replaceTagsInExpr(i, mapping)));
    case "or":
      return orOf(e.items.map((i) => replaceTagsInExpr(i, mapping)));
  }
}
