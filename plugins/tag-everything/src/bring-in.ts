// Bring in: files arriving in a folder outside the vault (Downloads, a scanner's folder) are moved into a vault folder,
// where the inbox and the auto-tag rules take over. Pure, no `obsidian` import (unit-tested); the watcher is
// bring-in-watcher.ts, the settings dialog bring-in-modal.ts.
//
// Only what arrives after the folder was added (`since`) is brought in: the files already there stay. A file still
// being written (a download in progress, its last write under SETTLE_MS ago) waits for the next look.

import { extensionTag } from "./format.ts";
import { cleanFolder, wordList } from "./inbox.ts";
import { nextId } from "./groups.ts";

/** An outside folder watched, and where its new files go. */
export interface BringInFolder {
  id: string;
  /** Absolute path on this computer (`C:\Users\me\Downloads`). */
  source: string;
  /** Vault folder the files are moved into ("" = the vault root). */
  target: string;
  /** Extensions brought in (`pdf jpg`; "" = any file). */
  extensions: string;
  /** Epoch ms: files that arrived in `source` before this stay there. */
  since: number;
}

/** A file still written to less than this long ago is left for the next look. */
export const SETTLE_MS = 2000;

/** Downloads in progress and temporary files: never brought in, whatever the extension list. */
const PARTIAL = new Set(["crdownload", "part", "partial", "download", "opdownload", "tmp", "temp", "lock"]);

/** Outside folders from whatever `data.json` holds: damaged entries dropped, a missing `since` set to `now`. */
export function normalizeBringIn(raw: unknown, now = Date.now()): BringInFolder[] {
  if (!Array.isArray(raw)) return [];
  const out: BringInFolder[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    const source = cleanSource(text(o.source));
    if (!source) continue;
    const id = text(o.id) && !out.some((x) => x.id === text(o.id)) ? text(o.id) : nextId(out, "b");
    const since = typeof o.since === "number" && Number.isFinite(o.since) && o.since > 0 ? o.since : now; // never everything already there
    out.push({ id, source, target: cleanFolder(text(o.target)), extensions: text(o.extensions), since });
  }
  return out;
}

/** An outside path as typed: quotes and trailing separators dropped (`"C:\Downloads\"` -> `C:\Downloads`). */
export function cleanSource(text: string): string {
  return text
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/(?<=.)[\\/]+$/, "");
}

/** Is `path` the folder `base` or inside it? Windows paths: `\` or `/`, case ignored. */
export function isInside(path: string, base: string): boolean {
  const norm = (p: string): string => cleanSource(p).replaceAll("\\", "/").toLowerCase();
  const p = norm(path);
  const b = norm(base);
  return !!b && (p === b || p.startsWith(`${b}/`));
}

/** What `fs.stat` says of an entry of the outside folder. */
export interface OutsideEntry {
  name: string;
  isFile: boolean;
  size: number;
  mtime: number;
  birthtime: number;
}

/** "bring": move it in now; "wait": it may still be written, look again soon; "skip": never (not new, not wanted). */
export type ArrivalState = "bring" | "wait" | "skip";

/** What to do with one entry of the outside folder `folder`. */
export function arrivalState(entry: OutsideEntry, folder: Pick<BringInFolder, "extensions" | "since">, now: number): ArrivalState {
  const { name } = entry;
  if (!entry.isFile || name.startsWith(".") || name.startsWith("~$")) return "skip"; // hidden, Office lock files
  const ext = extensionTag(name) ?? "";
  if (PARTIAL.has(ext)) return "skip";
  const exts = wordList(folder.extensions);
  if (exts.length && !exts.includes(ext)) return "skip";
  // A download has a new birth time; a file copied in keeps its old modification time but is born now.
  if (Math.max(entry.birthtime, entry.mtime) < folder.since) return "skip";
  return now - entry.mtime < SETTLE_MS || entry.size === 0 ? "wait" : "bring";
}

/** The folder in one line: `C:\Users\me\Downloads → Inbox (pdf jpg)`. */
export function describeBringIn(folder: Pick<BringInFolder, "source" | "target" | "extensions">): string {
  const exts = wordList(folder.extensions);
  return `${folder.source} → ${folder.target || "vault root"}${exts.length ? ` (${exts.join(" ")})` : ""}`;
}

/** The last part of an outside path, to name the folder in a notice: `Downloads`. */
export function sourceName(source: string): string {
  const parts = cleanSource(source).split(/[\\/]/);
  return parts[parts.length - 1] || source;
}
