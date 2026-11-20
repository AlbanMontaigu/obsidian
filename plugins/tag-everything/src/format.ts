/**
 * Tag storage format. Pure functions, no Obsidian import, so `node --test` can run them.
 * The full spec, and how it was verified, is in ../docs/format.md. In short:
 *  - file tags live in the file NAME, in the first "[" ... first "]" group, space-delimited, placed right
 *    before the extension with no separator: `report[tax-2024 receipt].pdf`;
 *  - folder names are never parsed for tags: folder tags live in `<folder>/.ts/tsm.json` -> `tags`;
 *  - any file may also carry sidecar tags in `<dir>/.ts/<file name>.json` -> `tags: [{ title, type, color? }]`,
 *    always merged with the name tags;
 *  - a Markdown note may also carry tags in its frontmatter `tags` property (Obsidian's own), always merged too;
 *    new note tags go there by default.
 */

export type StorageMode = "filename" | "sidecar";
/** Where an edit puts new tags: the storage setting, or a note's frontmatter. */
export type TagTarget = StorageMode | "frontmatter";

export interface SidecarTag {
  title: string;
  type?: string;
  color?: string;
  textcolor?: string;
  [key: string]: unknown;
}

export type SidecarMeta = Record<string, unknown>;

export const TAG_BEGIN = "[";
export const TAG_END = "]";
export const TAG_DELIMITER = " ";
export const META_DIR = ".ts";
export const FOLDER_META_FILE = "tsm.json";
export const RESERVED_META_FILES: ReadonlySet<string> = new Set(["tsm.json", "tsi.json", "tsl.json"]);
export const MAX_NAME_LENGTH = 255;

const MULTI_EXTENSIONS = [".tar.gz", ".tar.xz", ".tar.bz2", ".tar.zst", ".tar.lz", ".tar.lzma", ".tar.lz4", ".tar.lzo", ".cpio.gz"];
const FORBIDDEN_IN_TAG = /[[\]#^|\\/:*?"<>]/;
/** Frontmatter tags may be nested (`project/alpha`), as in Obsidian; the rest stays forbidden. */
const FORBIDDEN_IN_NESTED_TAG = /[[\]#^|\\:*?"<>,]/;

export function dedupe(tags: Iterable<string>): string[] {
  return [...new Set(tags)];
}

export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

// ---------------------------------------------------------------- file-name tags

function tagSpan(name: string): { begin: number; end: number } | null {
  const begin = name.indexOf(TAG_BEGIN);
  const end = name.indexOf(TAG_END);
  if (begin < 0 || end < 0 || begin >= end) return null;
  return { begin, end };
}

/** Tags read from a file name (`a[x y].pdf` -> ["x", "y"]). */
export function parseNameTags(name: string): string[] {
  const span = tagSpan(name);
  if (!span) return [];
  return dedupe(
    name
      .slice(span.begin + 1, span.end)
      .split(TAG_DELIMITER)
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

/** `report.tar.gz` -> ["report", ".tar.gz"]; `.gitignore` / `README` -> [name, ""]. */
export function splitExtension(name: string): [string, string] {
  const lower = name.toLowerCase();
  for (const ext of MULTI_EXTENSIONS) {
    if (lower.endsWith(ext) && name.length > ext.length) return [name.slice(0, -ext.length), name.slice(-ext.length)];
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}

/**
 * Returns `name` with its tag group replaced by `tags`.
 * An existing group is rewritten in place, so `2024 - [IMAC] SteerCo.md` keeps its shape.
 * A new group goes right before the extension, as other tag-aware apps write it. Throws when the result would be
 * unusable: empty, too long, or holding brackets that would be read as a different tag group.
 */
export function setNameTags(name: string, tags: readonly string[], isFile = true): string {
  const wanted = dedupe(tags);
  const group = wanted.length ? TAG_BEGIN + wanted.join(TAG_DELIMITER) + TAG_END : "";
  const span = tagSpan(name);
  let out: string;
  if (span) {
    let left = name.slice(0, span.begin);
    let right = name.slice(span.end + 1);
    if (!group) {
      if (left.endsWith(" ") && right.startsWith(" ")) right = right.slice(1);
      if (!right || right.startsWith(".")) left = left.trimEnd();
      if (!left) right = right.trimStart();
    }
    out = left + group + right;
  } else {
    if (!group) return name;
    const [base, ext] = isFile ? splitExtension(name) : [name, ""];
    out = base.trimEnd() + group + ext;
  }
  if (!out.trim() || (out.startsWith(".") && !name.startsWith("."))) {
    throw new Error("Removing these tags would leave the file without a name");
  }
  if (out.length > MAX_NAME_LENGTH) throw new Error(`The name would be ${out.length} characters long (limit ${MAX_NAME_LENGTH})`);
  if (!sameTags(parseNameTags(out), wanted)) {
    throw new Error("This name already contains brackets that would be read as tags. Rename the file first");
  }
  return out;
}

/**
 * Trims, optionally lower-cases, and rejects what cannot live in a file name. Empty input -> {}.
 * `nested`: the tag only goes to a note's frontmatter, so `/` is allowed (Obsidian nested tag).
 */
export function normalizeTag(raw: string, lowercase = false, nested = false): { tag?: string; error?: string } {
  let tag = raw.trim();
  if (lowercase) tag = tag.toLowerCase();
  if (!tag) return {};
  if (/\s/.test(tag)) return { error: `"${tag}": a tag cannot contain spaces` };
  if (nested) {
    if (FORBIDDEN_IN_NESTED_TAG.test(tag)) return { error: `"${tag}": a tag cannot contain [ ] # ^ | \\ : * ? " < > ,` };
    if (tag.startsWith("/") || tag.endsWith("/") || tag.includes("//")) return { error: `"${tag}": empty part in a nested tag` };
    return { tag };
  }
  if (FORBIDDEN_IN_TAG.test(tag)) {
    if (tag.includes("/") && !FORBIDDEN_IN_NESTED_TAG.test(tag)) {
      return { error: `"${tag}": a file name cannot contain / (nested tags only go in a note's frontmatter)` };
    }
    return { error: `"${tag}": a tag cannot contain [ ] # ^ | \\ / : * ? " < >` };
  }
  return { tag };
}

/**
 * Typed text -> valid tags, error messages, and the invalid words (`rest`, space-separated) to leave in the input
 * box so they can be fixed instead of vanishing.
 */
export function parseTagInput(text: string, lowercase = false, nested = false): { tags: string[]; errors: string[]; rest: string } {
  const tags: string[] = [];
  const errors: string[] = [];
  const bad: string[] = [];
  for (const raw of splitTagInput(text)) {
    const { tag, error } = normalizeTag(raw, lowercase, nested);
    if (error) {
      errors.push(error);
      bad.push(raw);
    } else if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return { tags, errors, rest: bad.join(" ") };
}

/**
 * Throws when a tag about to be written to `target` is not valid there, e.g. a nested `a/b` picked from a note's
 * frontmatter and about to go in a file name.
 */
export function assertWritable(tags: readonly string[], target: TagTarget): void {
  for (const t of tags) {
    const { tag, error } = normalizeTag(t, false, target === "frontmatter");
    if (error) throw new Error(error);
    if (tag !== t) throw new Error(`"${t}": invalid tag`);
  }
}

/** Splits typed text on spaces and commas: "a, b c" -> ["a", "b", "c"]. */
export function splitTagInput(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean);
}

// ---------------------------------------------------------------- paths (vault-relative, "/" separated)

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function baseOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function joinPath(dir: string, name: string): string {
  return dir && dir !== "/" ? `${dir}/${name}` : name;
}

/** `.ts` folder that holds the metadata of the entries inside `folderPath` (vault root = "" or "/"). */
export function metaDirOf(folderPath: string): string {
  return joinPath(folderPath, META_DIR);
}

/** `a/b/c.pdf` -> `a/b/.ts/c.pdf.json` */
export function fileSidecarPath(filePath: string): string {
  return joinPath(metaDirOf(parentOf(filePath)), baseOf(filePath) + ".json");
}

/** `a/b/c.pdf` -> `a/b/.ts/c.pdf.jpg` (thumbnail) */
export function fileThumbPath(filePath: string): string {
  return joinPath(metaDirOf(parentOf(filePath)), baseOf(filePath) + ".jpg");
}

/** `a/b` -> `a/b/.ts/tsm.json` */
export function folderMetaPath(folderPath: string): string {
  return joinPath(metaDirOf(folderPath), FOLDER_META_FILE);
}

// ---------------------------------------------------------------- sidecar JSON

/** Parses a sidecar / tsm.json. A BOM is stripped and empty text gives {}. Anything else invalid throws. */
export function parseSidecar(text: string): SidecarMeta {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!clean.trim()) return {};
  const parsed: unknown = JSON.parse(clean);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a JSON object");
  return parsed as SidecarMeta;
}

export function sidecarTags(meta: SidecarMeta): SidecarTag[] {
  const tags = meta.tags;
  if (!Array.isArray(tags)) return [];
  return tags.filter(
    (t): t is SidecarTag => !!t && typeof t === "object" && typeof (t as SidecarTag).title === "string" && !!(t as SidecarTag).title.trim(),
  );
}

function newId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

/** Returns a copy of `meta` with `tags` replaced. Every other field (id, description, perspective, order...) is kept. */
export function withSidecarTags(meta: SidecarMeta, tags: readonly string[], now = Date.now()): SidecarMeta {
  const previous = new Map(sidecarTags(meta).map((t) => [t.title, t]));
  const next: SidecarTag[] = dedupe(tags).map((title) => previous.get(title) ?? { title, type: "sidecar" });
  const out: SidecarMeta = { ...meta, tags: next, lastUpdated: now };
  if (typeof out.id !== "string" || !out.id) out.id = newId();
  return out;
}

/** Keeps the original layout: one-line files (tsm.json) stay one-line. */
export function serializeSidecar(meta: SidecarMeta, original?: string): string {
  return original !== undefined && original.trim() && !original.includes("\n") ? JSON.stringify(meta) : JSON.stringify(meta, null, 2);
}

// ---------------------------------------------------------------- note frontmatter (Obsidian `tags` property)

/** Keys Obsidian reads tags from: `tags`, and the older `tag`, any case. */
const FRONT_KEY = /^tags?$/i;

function frontKeys(fm: Record<string, unknown>): string[] {
  return Object.keys(fm).filter((k) => FRONT_KEY.test(k));
}

function cleanFrontTag(v: unknown): string {
  return (typeof v === "string" || typeof v === "number" ? String(v) : "").trim().replace(/^#/, "").trim();
}

/** Raw items of one frontmatter value: a list, or a string separated by commas / spaces (`tags: a, b`). */
function frontItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[\s,]+/);
  if (typeof value === "number") return [value];
  return [];
}

/** Tags of a parsed frontmatter object (`#` prefix dropped, duplicates removed). Anything else -> []. */
export function frontmatterTags(fm: unknown): string[] {
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) return [];
  const rec = fm as Record<string, unknown>;
  const out: string[] = [];
  for (const key of frontKeys(rec)) for (const item of frontItems(rec[key])) out.push(cleanFrontTag(item));
  return dedupe(out.filter(Boolean));
}

/**
 * Sets the tags of a parsed frontmatter object in place (meant for `processFrontMatter`): one `tags` list, as
 * Obsidian writes it. A kept list item keeps its spelling (`"#beta"` stays). Other properties are untouched; the
 * older `tag` key is folded into `tags`. No tags left -> the property is removed.
 */
export function setFrontmatterTags(fm: Record<string, unknown>, tags: readonly string[]): void {
  const keys = frontKeys(fm);
  const original = new Map<string, unknown>();
  for (const key of keys) {
    if (!Array.isArray(fm[key])) continue;
    for (const item of fm[key] as unknown[]) {
      const clean = cleanFrontTag(item);
      if (clean && !original.has(clean)) original.set(clean, item);
    }
  }
  const wanted = dedupe(tags);
  const main = keys.find((k) => k === "tags") ?? keys.find((k) => k.toLowerCase() === "tags") ?? "tags";
  for (const key of keys) if (key !== main) delete fm[key];
  if (!wanted.length) {
    delete fm[main];
    return;
  }
  fm[main] = wanted.map((t) => original.get(t) ?? t);
}

// ---------------------------------------------------------------- edit planning

export interface TagState {
  nameTags: string[];
  sideTags: string[];
  /** A note's frontmatter tags. Always empty for other files. */
  frontTags?: string[];
}

export interface TagPlan {
  nameTags: string[];
  sideTags: string[];
  frontTags: string[];
  renamed: boolean;
  sideChanged: boolean;
  frontChanged: boolean;
}

/**
 * Where the `desired` tags go. A kept tag never moves between the name and the frontmatter, and sidecar tags move
 * into the target, so a tag never lives in two places.
 *  - filename:    new and sidecar tags go in the name; frontmatter tags that are kept stay there.
 *  - sidecar:     name and frontmatter tags that are kept stay where they are, so no rename happens just to add a
 *                 tag; the rest goes to the sidecar. Removing a name tag still renames: it is the only way.
 *  - frontmatter: (notes) name tags that are kept stay in the name; everything else goes to the frontmatter.
 */
export function planTags(current: TagState, desired: readonly string[], target: TagTarget): TagPlan {
  const wanted = dedupe(desired);
  const curFront = current.frontTags ?? [];
  let nameTags: string[];
  let sideTags: string[];
  let frontTags: string[];
  if (target === "filename") {
    frontTags = curFront.filter((t) => wanted.includes(t));
    nameTags = wanted.filter((t) => !frontTags.includes(t));
    sideTags = [];
  } else if (target === "frontmatter") {
    nameTags = current.nameTags.filter((t) => wanted.includes(t));
    frontTags = wanted.filter((t) => !nameTags.includes(t));
    sideTags = [];
  } else {
    nameTags = current.nameTags.filter((t) => wanted.includes(t));
    frontTags = curFront.filter((t) => wanted.includes(t) && !nameTags.includes(t));
    sideTags = wanted.filter((t) => !nameTags.includes(t) && !frontTags.includes(t));
  }
  return {
    nameTags,
    sideTags,
    frontTags,
    renamed: !sameTags(nameTags, current.nameTags),
    sideChanged: !sameTags(sideTags, current.sideTags),
    frontChanged: !sameTags(frontTags, curFront),
  };
}

/** Bulk edit of one item: drop `removed`, then append `added` after the existing tags (order kept). */
export function mergeEdit(itemTags: readonly string[], added: readonly string[], removed: readonly string[]): string[] {
  const drop = new Set(removed);
  const out = itemTags.filter((t) => !drop.has(t));
  for (const t of added) if (!out.includes(t)) out.push(t);
  return out;
}
