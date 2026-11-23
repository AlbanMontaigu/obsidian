// Query blocks: a `tag-everything` code block in a note lists, live, the items matching a tag formula. This module
// reads the block's text and picks the items. Pure, no `obsidian` import (unit-tested); the rendering is
// query-block.ts.
//
//   ```tag-everything
//   invoice AND 2025 AND NOT paid
//   sort: modified
//   limit: 20
//   archived: show
//   ```

import { type Expr, evaluate, formulaTags, isDateWord, resolveTags, tryParseFormula } from "./formula.ts";
import type { DateField, DateRange } from "./dates.ts";
import { compareItems } from "./explore.ts";

/** The code block language: what follows the three backticks. */
export const QUERY_LANGUAGE = "tag-everything";
export const DEFAULT_QUERY_LIMIT = 50;
export const MAX_QUERY_LIMIT = 500;

export type QuerySort = "name" | "modified" | "created";
const SORTS: readonly QuerySort[] = ["name", "modified", "created"];

export interface Query {
  /** The formula as written (the block's lines that are not options, joined: side by side means AND). */
  formula: string;
  /** Null when the formula is empty or does not parse (`error` says why). */
  expr: Expr | null;
  error: string | null;
  sort: QuerySort;
  limit: number;
  /**
   * `archived: show` (true) / `hide` (false): the block always lists, or never lists, archived items (src/archive.ts);
   * null: it follows the archive switch, shown in its header.
   */
  archived: boolean | null;
  /** Options that were not understood, each with what is expected; the rest of the block still works. */
  warnings: string[];
}

/**
 * Reads a query block: option lines (`sort: name | modified | created`, `limit: 1-500`, `archived: show | hide`),
 * comment lines (`//`), and the formula (every other line). An option line is `word:`, which no tag can start with
 * (`:` is not allowed in a tag), so it never takes a formula line.
 */
export function parseQuery(source: string): Query {
  const q: Query = { formula: "", expr: null, error: null, sort: "name", limit: DEFAULT_QUERY_LIMIT, archived: null, warnings: [] };
  const formula: string[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const opt = /^([a-z]+)\s*:\s*(.*)$/i.exec(line);
    if (!opt || isDateWord(opt[1])) {
      // a date term (`modified:7d`) is part of the formula, not an option
      formula.push(line);
      continue;
    }
    const [, key, value] = opt;
    const v = value.trim().toLowerCase();
    if (key.toLowerCase() === "sort") {
      if ((SORTS as readonly string[]).includes(v)) q.sort = v as QuerySort;
      else q.warnings.push(`sort: "${value.trim()}" is not one of ${SORTS.join(", ")}`);
    } else if (key.toLowerCase() === "limit") {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 1 && n <= MAX_QUERY_LIMIT) q.limit = n;
      else q.warnings.push(`limit: "${value.trim()}" is not a whole number from 1 to ${MAX_QUERY_LIMIT}`);
    } else if (key.toLowerCase() === "archived") {
      if (v === "show" || v === "hide") q.archived = v === "show";
      else q.warnings.push(`archived: "${value.trim()}" is not show or hide`);
    } else {
      q.warnings.push(`"${key}:" is not an option (sort, limit, archived)`);
    }
  }
  q.formula = formula.join(" ");
  if (!q.formula) {
    q.error = "Write a tag formula in the block, e.g. invoice AND NOT paid";
    return q;
  }
  const r = tryParseFormula(q.formula);
  if ("error" in r) q.error = r.error;
  else q.expr = r.expr;
  return q;
}

/**
 * The paths matching `expr`, its tags first spelled as in the vault (`known`). Unlike the panel's searches, a tag no
 * item carries is kept: a saved query means what it says, so `a AND gone` finds nothing (and `NOT gone` everything);
 * `unknown` names those tags so the block can say so. `dated` answers the date terms (`created:30d`).
 */
export function matchQuery(
  expr: Expr,
  paths: Iterable<string>,
  has: (path: string, tag: string) => boolean,
  known: readonly string[],
  dated: (path: string, field: DateField, range: DateRange) => boolean = () => false,
): { expr: Expr; paths: string[]; unknown: string[] } {
  const resolved = resolveTags(expr, known);
  const knownSet = new Set(known);
  const out: string[] = [];
  for (const p of paths) if (evaluate(resolved, (t) => has(p, t), (f, r) => dated(p, f, r))) out.push(p);
  return { expr: resolved, paths: out, unknown: formulaTags(resolved).filter((t) => !knownSet.has(t)) };
}

export interface QueryItem {
  name: string;
  folder: boolean;
  /** Last modified and created times (ms); 0 for a folder. */
  mtime: number;
  ctime: number;
}

/** Order of the block's rows: by name as in the file explorer, or newest first (`modified`, `created`). */
export function compareQueryItems(sort: QuerySort): (a: QueryItem, b: QueryItem) => number {
  if (sort === "name") return compareItems;
  const time = (i: QueryItem): number => (sort === "modified" ? i.mtime : i.ctime);
  return (a, b) => time(b) - time(a) || compareItems(a, b);
}
