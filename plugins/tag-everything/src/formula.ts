// Tag formulas of the panel's groups: `(BBB OR XXX) AND (YYY OR ZZZ)`. Pure, no `obsidian` import (unit-tested).
//
// Syntax: tags, AND / OR / NOT (also ET / OU / NON, & / | / !, case-insensitive) and parentheses. Two terms side
// by side mean AND. Precedence: NOT, then AND, then OR. A tag containing a parenthesis or spelled like an
// operator is written in double quotes ("or", "a(b)"); a leading # is ignored; !tag = NOT tag.

export type Expr =
  | { k: "tag"; tag: string }
  | { k: "and"; items: Expr[] }
  | { k: "or"; items: Expr[] }
  | { k: "not"; item: Expr };

type Op = "and" | "or" | "not";
type Token = { t: "(" | ")" } | { t: Op } | { t: "tag"; v: string };

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
      if (op) out.push({ t: op });
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
      } else if (t === "tag" || t === "(" || t === "not") {
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
  return /[\s()"]/.test(tag) || OPS[tag.toLowerCase()] || tag.startsWith("#") ? `"${tag}"` : tag;
}

/** Canonical text: AND / OR / NOT in capitals, parentheses only where needed. Parses back to the same tree. */
export function formatFormula(e: Expr): string {
  const fmt = (x: Expr, parent: Expr["k"] | null): string => {
    switch (x.k) {
      case "tag":
        return quoteTag(x.tag);
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
    else x.items.forEach(walk);
  };
  walk(e);
  return [...out];
}

export function evaluate(e: Expr, has: (tag: string) => boolean): boolean {
  switch (e.k) {
    case "tag":
      return has(e.tag);
    case "not":
      return !evaluate(e.item, has);
    case "and":
      return e.items.every((i) => evaluate(i, has));
    case "or":
      return e.items.some((i) => evaluate(i, has));
  }
}

/**
 * The formula without the tags `keep` rejects, as if they had never been written: a switched-off tag drops out of
 * its AND or OR, and `NOT tag` goes with it. Null when nothing is left.
 */
export function prune(e: Expr, keep: (tag: string) => boolean): Expr | null {
  switch (e.k) {
    case "tag":
      return keep(e.tag) ? e : null;
    case "not": {
      const item = prune(e.item, keep);
      return item ? { k: "not", item } : null;
    }
    case "and":
      return andOf(e.items.map((i) => prune(i, keep)));
    case "or":
      return orOf(e.items.map((i) => prune(i, keep)));
  }
}

/** `tag` ↔ `NOT tag` wherever the tag is written; the rest of the formula is unchanged. */
export function toggleNot(e: Expr, tag: string): Expr {
  switch (e.k) {
    case "tag":
      return e.tag === tag ? notExpr(e) : e;
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
