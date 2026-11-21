// Tag naming rule: a tag is one lower-case plain word (letters and digits, accents allowed), never a liaison word.
// `Tax-Receipt` is two tags, `tax` and `receipt`; `plan_de_charge` is `plan` and `charge`; `/` is a separator too, so
// a nested tag (`proj/alpha`) breaks the rule and becomes `proj` and `alpha`. Pure, no `obsidian` import (unit-tested under node --test).
//
// Used three ways: the editor refuses a new tag that breaks the rule and offers its fix, `applyTags` refuses it too,
// and the "Check tag names" engine lists the vault's tags that break it, with a fix, and rewrites them where they are.

import { type TagMapping, type TagPlan, type TagState, dedupe, normalizeTag, parseTagInput, sameTags, splitTagInput } from "./format.ts";

/** French and English liaison words (articles, prepositions, conjunctions, determiners, elided forms). */
export const DEFAULT_STOP_WORDS =
  "a an the and or nor but of to in on at by for with from as into onto via per " +
  "le la les l un une des de du d et ou à au aux en dans par pour sur sous avec sans chez vers entre " +
  "ce cet cette ces sa son ses mon ma mes ton ta tes leur leurs notre nos votre vos qui que qu quoi dont où ne n s c j m t";

export interface NamingRule {
  stopWords: ReadonlySet<string>;
}

/** Splits a stop-word list typed in the settings (spaces, commas, semicolons, new lines). */
export function parseStopWords(text: string): string[] {
  return dedupe(text.toLowerCase().split(/[\s,;]+/).filter(Boolean));
}

export function makeRule(stopWords: string = DEFAULT_STOP_WORDS): NamingRule {
  return { stopWords: new Set(parseStopWords(stopWords)) };
}

const WORD = /^[\p{L}\p{N}\p{M}]+$/u;
const NOT_WORD = /[^\p{L}\p{N}\p{M}]+/u;

/**
 * The plain words of a piece of text, lower-cased, liaison words dropped, once each. Single letters only (an
 * acronym: `R&D`, `A.B.C`) make one word, so the `d` of `R&D` is not taken for an elided `d'`.
 */
function words(text: string, rule: NamingRule): string[] {
  const parts = text.toLowerCase().split(NOT_WORD).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => [...p].length === 1)) return [parts.join("")];
  return dedupe(parts.filter((w) => !rule.stopWords.has(w)));
}

/** Why `tag` breaks the rule (the first reason found), or null when it follows it. */
export function ruleProblem(tag: string, rule: NamingRule): string | null {
  if (!WORD.test(tag)) {
    return /[\s\-_./]/.test(tag) ? "one word per tag (no space, /, - or _)" : "letters and digits only";
  }
  if (tag !== tag.toLowerCase()) return "lower-case only";
  if (rule.stopWords.has(tag)) return `"${tag}" is a liaison word`;
  return null;
}

export function followsRule(tag: string, rule: NamingRule): boolean {
  return ruleProblem(tag, rule) === null;
}

/**
 * The tags that should replace `tag`: lower-cased, split into plain words, liaison words dropped.
 * `Tax-Receipt` -> ["tax", "receipt"]; `proj/Alpha` -> ["proj", "alpha"]; `de` -> [] (drop it).
 * A tag that already follows the rule gives itself.
 */
export function suggestFix(tag: string, rule: NamingRule): string[] {
  return followsRule(tag, rule) ? [tag] : words(tag, rule);
}

/** One line for the user: `"Tax-Receipt": one word per tag (no space, /, - or _); use "tax receipt"`. */
export function ruleMessage(tag: string, rule: NamingRule, shown = tag): string | null {
  const problem = ruleProblem(tag, rule);
  if (!problem) return null;
  const fix = suggestFix(tag, rule);
  return `"${shown}": ${problem}${fix.length ? `; use "${fix.join(" ")}"` : "; left out"}`;
}

/**
 * Text typed in the tag editor -> tags, errors, and what to leave in the box (`rest`). Without a rule it is
 * `parseTagInput`. With one, words are lower-cased, and a word breaking the rule is refused: its fix goes in the
 * box instead (`Tax-Receipt` or `proj/alpha` -> two words, ready to accept with Enter), a liaison word is left out.
 * A word that can't be a tag at all (`a:b`) stays as typed, as before.
 */
export function parseTypedTags(
  text: string,
  rule: NamingRule | null,
  lowercase = false,
  nested = false,
): { tags: string[]; errors: string[]; rest: string } {
  if (!rule) return parseTagInput(text, lowercase, nested);
  const tags: string[] = [];
  const errors: string[] = [];
  const rest: string[] = [];
  for (const raw of splitTagInput(text)) {
    // `/` is a word separator under the rule, like `-`: never the "no nested tag in a file name" error.
    const { tag, error } = normalizeTag(raw.replaceAll("/", "-"), true, nested);
    if (error) {
      errors.push(error);
      rest.push(raw);
      continue;
    }
    if (!tag) continue;
    const msg = ruleMessage(tag, rule, raw);
    if (!msg) {
      if (!tags.includes(tag)) tags.push(tag);
      continue;
    }
    errors.push(msg);
    for (const f of suggestFix(tag, rule)) if (!rest.includes(f)) rest.push(f);
  }
  return { tags, errors, rest: rest.join(" ") };
}

// ---------------------------------------------------------------- vault audit and fix

export interface TagIssue {
  tag: string;
  /** Items carrying it. */
  count: number;
  problem: string;
  /** Suggested replacement tags ([] = drop the tag). */
  fix: string[];
}

/** Every tag of the vault that breaks the rule, most used first. */
export function auditTags(counts: ReadonlyMap<string, number>, rule: NamingRule): TagIssue[] {
  const out: TagIssue[] = [];
  for (const [tag, count] of counts) {
    const problem = ruleProblem(tag, rule);
    if (problem) out.push({ tag, count, problem, fix: suggestFix(tag, rule) });
  }
  return out.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Rewrites an item's tags where they are: a name tag's replacements go in the name, a frontmatter tag's in the
 * frontmatter, a sidecar tag's in the sidecar, so a fix never moves a tag elsewhere. A replacement the item already
 * carries (unmapped, anywhere) is not added again; one coming from two places lands in the first (name, frontmatter,
 * sidecar).
 */
export function replacePlan(current: TagState, mapping: TagMapping): TagPlan {
  const front = current.frontTags ?? [];
  const placed = new Set([...current.nameTags, ...front, ...current.sideTags].filter((t) => !mapping.has(t)));
  const rewrite = (list: readonly string[]): string[] => {
    const out: string[] = [];
    for (const t of list) {
      const repl = mapping.get(t);
      if (!repl) {
        if (!out.includes(t)) out.push(t);
        continue;
      }
      for (const r of repl) {
        if (placed.has(r)) continue;
        placed.add(r);
        out.push(r);
      }
    }
    return out;
  };
  const nameTags = rewrite(current.nameTags);
  const frontTags = rewrite(front);
  const sideTags = rewrite(current.sideTags);
  return {
    nameTags,
    frontTags,
    sideTags,
    renamed: !sameTags(nameTags, current.nameTags),
    frontChanged: !sameTags(frontTags, front),
    sideChanged: !sameTags(sideTags, current.sideTags),
  };
}

/** Text typed as a replacement in the fix dialog -> tags, or the first error. Empty text = drop the tag. */
export function parseReplacement(text: string, rule: NamingRule): { tags: string[] } | { error: string } {
  const tags = dedupe(splitTagInput(text));
  for (const t of tags) {
    const msg = ruleMessage(t, rule);
    if (msg) return { error: msg };
  }
  return { tags };
}
