// Tag review: find the tags that say the same thing (look-alikes, synonyms) or that nothing else uses, and turn the
// user's choices into one rename map for `plugin.replaceTags`. Pure, no `obsidian` import (unit-tested); the dialogs
// are curator.ts.
//
// Look-alikes are found here, locally and for free: same word once case, accents and a plural s / x are ignored
// (`Facture`, `factures`, `facturé`), or a one-letter typo (`reciept`, `receipt`). Synonyms (`banque`, `bancaire`)
// need the meaning: Claude Code is asked, with the tag list only (no file, no tool).

import { dedupe, normalizeTag, sameTags } from "./format.ts";
import { type NamingRule, suggestFix } from "./naming.ts";
import { type ClaudeTask, type SuggestInput, ruleText } from "./suggest.ts";
import { tagList } from "./guide.ts";

/** Tags that probably mean the same thing, and the tag to keep. */
export interface TagCluster {
  /** The tags, most used first. */
  tags: string[];
  /** What they become: one of them (the most used), or a new tag from Claude Code. */
  into: string;
  /** Why they were grouped, for the user. */
  reason: string;
  /** Same word for sure (case, accents, plural): pre-checked. A guess (typo, synonym) waits for the user's tick. */
  sure: boolean;
}

/** Lower case, no accent: `Facturé` -> `facture`. */
export function foldTag(tag: string): string {
  return tag.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The folded word without a plural s / x (`factures`, `bureaux` -> `facture`, `bureau`); short words kept whole. */
function stem(tag: string): string {
  const f = foldTag(tag);
  return f.length > 3 && /[^s][sx]$/.test(f) ? f.slice(0, -1) : f;
}

/** Edit distance counting a swap of two neighbours as one edit (`reciept` / `receipt` = 1). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * A one-letter typo between two words long enough for it to mean something (5+ letters). Never between tags with
 * digits: `invoice1` and `invoice2`, `2024` and `2025` are different on purpose.
 */
function typo(a: string, b: string): boolean {
  const fa = foldTag(a);
  const fb = foldTag(b);
  if (fa.length < 5 || fb.length < 5 || Math.abs(fa.length - fb.length) > 1 || /\d/.test(fa + fb)) return false;
  return editDistance(fa, fb) <= 1;
}

/** Two different tags for the same word (case, accents, plural) or one typo apart: the look-alike rule of the review. */
export function lookAlike(a: string, b: string): boolean {
  return a !== b && (stem(a) === stem(b) || typo(a, b));
}

/** Most used first, then the shorter, then by name: the first one is the tag the others merge into. */
function byUse(counts: ReadonlyMap<string, number>): (a: string, b: string) => number {
  return (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.length - b.length || a.localeCompare(b);
}

/**
 * Groups of look-alike tags: the same word once case, accents and a plural are ignored (sure), or one typo apart
 * (a guess: `livre` / `libre` are two words). Each group merges into its most used tag. Biggest groups first.
 */
export function similarTags(counts: ReadonlyMap<string, number>): TagCluster[] {
  const tags = [...counts.keys()];
  // union-find over the tags: two tags linked by a rule land in the same group, even through a third one
  const parent = tags.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const stems = tags.map(stem);
  for (let i = 0; i < tags.length; i++) {
    for (let j = i + 1; j < tags.length; j++) {
      if (stems[i] === stems[j] || typo(tags[i], tags[j])) parent[find(i)] = find(j); // lookAlike, with the stems computed once
    }
  }
  const groups = new Map<number, string[]>();
  tags.forEach((t, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), t]));
  const out: TagCluster[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = group.sort(byUse(counts));
    const sure = new Set(sorted.map(stem)).size === 1;
    out.push({ tags: sorted, into: sorted[0], reason: sure ? "same word (case, accents or plural)" : "close spelling", sure });
  }
  const total = (c: TagCluster): number => c.tags.reduce((n, t) => n + (counts.get(t) ?? 0), 0);
  return out.sort((a, b) => Number(b.sure) - Number(a.sure) || total(b) - total(a) || a.into.localeCompare(b.into));
}

/** Tags carried by `max` items or fewer (default: one), by name: often a typo, or a tag never reused. */
export function rareTags(counts: ReadonlyMap<string, number>, max = 1): string[] {
  return [...counts].filter(([, n]) => n <= max).map(([t]) => t).sort((a, b) => a.localeCompare(b));
}

/** One change picked in the review: these tags become `into` (empty = removed). */
export interface MergeRow {
  from: readonly string[];
  into: readonly string[];
}

/**
 * The picked changes as one tag -> replacements map. A tag of `into` is not mapped (it stays). A chain is followed
 * (`a` -> `b` and `b` -> `c` maps `a` to `c`), since the vault is rewritten in one pass. Error when a tag gets two
 * different fates, or two tags merge into each other.
 */
export function mergeMapping(rows: readonly MergeRow[]): { mapping: Map<string, string[]> } | { error: string } {
  const direct = new Map<string, string[]>();
  for (const row of rows) {
    for (const t of row.from) {
      if (row.into.includes(t)) continue;
      const before = direct.get(t);
      if (before && !sameTags(before, row.into)) return { error: `"${t}" is in two changes (→ ${show(before)} and → ${show(row.into)}): keep one` };
      direct.set(t, [...row.into]);
    }
  }
  const expand = (t: string, seen: readonly string[]): string[] => {
    const repl = direct.get(t);
    if (!repl) return [t];
    if (seen.includes(t)) throw new Error(`${seen.map((s) => `"${s}"`).join(" and ")} merge into each other: keep one way`);
    return dedupe(repl.flatMap((r) => expand(r, [...seen, t])));
  };
  try {
    return { mapping: new Map([...direct.keys()].map((t) => [t, expand(t, [])])) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function show(tags: readonly string[]): string {
  return tags.length ? tags.join(" ") : "removed";
}

// ---------------------------------------------------------------- synonyms by Claude Code

/** The answer's shape, given to `claude --json-schema`. */
const SYNONYM_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: { tags: { type: "array", items: { type: "string" } }, into: { type: "string" }, reason: { type: "string" } },
        required: ["tags", "into"],
      },
    },
  },
  required: ["groups"],
};

/** Synonyms: Claude Code answers from the tag list in the prompt, with no tool (nothing to read, nothing to change). */
export const SYNONYM_TASK: ClaudeTask = {
  system: "You tidy the tag list of a personal note vault: you group tags that mean the same thing. Answer with the structured output only.",
  schema: SYNONYM_SCHEMA,
  tools: [],
};

/** Tags sent to Claude Code, most used first: a vault with more is cut (the rare ones are listed apart). */
const MAX_SYNONYM_TAGS = 1000;

/** The synonym prompt (stdin): the vault's tags with their counts, and the naming rule the merged tag must follow. */
export function synonymPrompt(counts: ReadonlyMap<string, number>, rule: Pick<SuggestInput, "tagRule" | "stopWords" | "lowercase">): string {
  return [
    "Below are the tags of a personal vault, most used first, with how many files carry each.",
    "",
    "Find the groups of tags that mean the same thing and should be one tag: synonyms (bank, banking), translations " +
      "(invoice, facture), a word and its abbreviation (doc, documentation), singular and plural, spelling variants.",
    "- Only group tags that are interchangeable for finding files. Different things that are only related " +
      "(invoice, payment) stay apart; so do a general tag and a more precise one (finance, tax).",
    "- For each group, `into` is the tag to keep: usually the most used one of the group. A new tag only when " +
      "none of the group's tags fits all of them.",
    ruleText(rule),
    "- `reason`: a few words on why (e.g. \"synonyms\", \"French and English\").",
    "- No group is fine: answer an empty list when every tag says something different.",
    "",
    "Tags:",
    tagList(counts, MAX_SYNONYM_TAGS),
    "",
    'Answer: {"groups": [{"tags": ["...", "..."], "into": "...", "reason": "..."}]}',
  ].join("\n");
}

/**
 * Claude Code's synonym groups made safe to show: tags spelled as in the vault (unknown ones dropped), `into` a valid
 * tag (put to the naming rule; one word, else the group's most used tag), a tag in one group only (the first), and
 * at least two tags to merge (an existing `into` counts). Never sure: each waits for the user's tick.
 */
export function cleanSynonyms(answer: unknown, counts: ReadonlyMap<string, number>, rule: NamingRule | null, lowercase = false): TagCluster[] {
  const raw = answer && typeof answer === "object" ? (answer as { groups?: unknown }).groups : undefined;
  if (!Array.isArray(raw)) throw new Error("Claude Code gave no group list");
  const spelling = new Map<string, string>();
  for (const t of counts.keys()) if (!spelling.has(t.toLowerCase())) spelling.set(t.toLowerCase(), t);
  const known = (t: unknown): string | undefined => (typeof t === "string" ? spelling.get(t.trim().replace(/^#/, "").toLowerCase()) : undefined);
  const used = new Set<string>();
  const out: TagCluster[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const { tags, into, reason } = g as { tags?: unknown; into?: unknown; reason?: unknown };
    if (!Array.isArray(tags)) continue;
    let keep = known(into);
    if (!keep && typeof into === "string") {
      const { tag } = normalizeTag(into.replace(/^#/, ""), !!rule || lowercase);
      const fix = tag && rule ? suggestFix(tag, rule) : tag ? [tag] : [];
      if (fix.length === 1) keep = known(fix[0]) ?? fix[0];
    }
    const members = dedupe([...tags.map(known), ...(keep && counts.has(keep) ? [keep] : [])].filter((t): t is string => !!t && !used.has(t)));
    if (members.length < 2 && !(members.length === 1 && keep && !counts.has(keep))) continue;
    const sorted = members.sort(byUse(counts));
    for (const t of sorted) used.add(t);
    out.push({ tags: sorted, into: keep ?? sorted[0], reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 80) : "synonyms", sure: false });
  }
  return out;
}
