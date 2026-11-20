import { App, CachedMetadata, Events, TAbstractFile, TFile, TFolder, debounce } from "obsidian";
import * as ts from "./format.ts";
import { autoColor } from "./colors.ts";

export interface Entry {
  /** Tags read from the file name. Always empty for folders: folder names are never read for tags. */
  name: string[];
  /** Tags from a note's frontmatter `tags` property. Empty for anything but Markdown notes. */
  front: string[];
  /** Tags from `.ts/<file>.json` or, for a folder, `.ts/tsm.json`. */
  side: string[];
}

/** An entry with its merged tags precomputed: the panel and the badges read them many times per render. */
interface Stored extends Entry {
  all: string[];
  set: ReadonlySet<string>;
}

const EMPTY: Stored = { name: [], front: [], side: [], all: [], set: new Set() };

function stored(e: Entry): Stored {
  const all = ts.dedupe([...e.name, ...e.front, ...e.side]);
  return { name: e.name, front: e.front, side: e.side, all, set: new Set(all) };
}

function isEmpty(e: Entry): boolean {
  return !e.name.length && !e.front.length && !e.side.length;
}

/** Frontmatter tags of a note, from Obsidian's metadata cache. */
export function cachedFrontTags(app: App, file: TFile, cache?: CachedMetadata | null): string[] {
  if (file.extension !== "md") return [];
  return ts.frontmatterTags((cache ?? app.metadataCache.getFileCache(file))?.frontmatter);
}
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;
const SCAN_CONCURRENCY = 8;

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (err) {
        console.warn("[tag-everything] scan failed", err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/** Re-keys `oldPath` and everything below it to `newPath` in a path-keyed map. */
function rekey<V>(map: Map<string, V>, oldPath: string, newPath: string, below: boolean): boolean {
  let moved = false;
  const keys = below ? [...map.keys()].filter((k) => k === oldPath || k.startsWith(oldPath + "/")) : map.has(oldPath) ? [oldPath] : [];
  for (const key of keys) {
    const v = map.get(key)!;
    map.delete(key);
    map.set(newPath + key.slice(oldPath.length), v);
    moved = true;
  }
  return moved;
}

function dropKeys<V>(map: Map<string, V>, path: string, below: boolean): boolean {
  let dropped = map.delete(path);
  if (below) {
    const prefix = path + "/";
    for (const key of [...map.keys()]) if (key.startsWith(prefix)) dropped = map.delete(key) || dropped;
  }
  return dropped;
}

/**
 * In-memory view of every tagged file and folder in the vault. Name tags follow vault events.
 * Sidecars live in `.ts` folders, which Obsidian does not watch, so edits made outside Obsidian show up
 * after a rebuild (on startup, or the "Re-read all tags" command / panel button).
 */
export class TagIndex extends Events {
  private entries = new Map<string, Stored>();
  private colorMap = new Map<string, string>();
  private building: Promise<void> | null = null;
  /**
   * While a rebuild scans the sidecars, sidecar edits, renames and deletions are also recorded here and replayed
   * on the scan's result before it replaces the live map: an edit made during the scan is never lost.
   */
  private scanLog: ((sides: Map<string, string[]>) => void)[] | null = null;
  private countsCache: Map<string, number> | null = null;
  private rankedCache: string[] | null = null;
  /** False until the first scan is done: until then, an empty index does not mean "no tags". */
  ready = false;
  /** Mirrors the `autoColors` setting (set by the plugin). */
  autoColors = true;
  private notify = debounce(() => this.trigger("changed"), 50, true);

  constructor(private app: App) {
    super();
  }

  get(path: string): Entry {
    return this.entries.get(path) ?? EMPTY;
  }

  /** Every tag of the item (name, frontmatter, sidecar), once. Do not mutate. */
  tagsOf(path: string): readonly string[] {
    return (this.entries.get(path) ?? EMPTY).all;
  }

  hasTag(path: string, tag: string): boolean {
    return (this.entries.get(path) ?? EMPTY).set.has(tag);
  }

  /** Colour stored for the tag in a `.ts` sidecar, if any. */
  colorOf(tag: string): string | undefined {
    return this.colorMap.get(tag);
  }

  /** Colour to show: the sidecar one, else (setting `autoColors`) one picked from the tag's name, else none. */
  colorFor(tag: string): string | undefined {
    return this.colorMap.get(tag) ?? (this.autoColors ? autoColor(tag) : undefined);
  }

  paths(): string[] {
    return [...this.entries.keys()];
  }

  get size(): number {
    return this.entries.size;
  }

  /** Tag -> number of items, over `paths` (default: everything, cached until the next change). */
  counts(paths?: Iterable<string>): ReadonlyMap<string, number> {
    if (!paths && this.countsCache) return this.countsCache;
    const out = new Map<string, number>();
    for (const p of paths ?? this.entries.keys()) for (const t of this.tagsOf(p)) out.set(t, (out.get(t) ?? 0) + 1);
    if (!paths) this.countsCache = out;
    return out;
  }

  /** Tags sorted by use, most used first (cached until the next change). Do not mutate. */
  ranked(): readonly string[] {
    this.rankedCache ??= [...this.counts()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
    return this.rankedCache;
  }

  /** Paths carrying every tag in `tags`. */
  matching(tags: readonly string[]): string[] {
    if (!tags.length) return [];
    return this.paths().filter((p) => tags.every((t) => this.hasTag(p, t)));
  }

  private changed(): void {
    this.countsCache = null;
    this.rankedCache = null;
    this.notify();
  }

  private put(path: string, e: Entry): void {
    if (isEmpty(e)) this.entries.delete(path);
    else this.entries.set(path, stored(e));
  }

  setSide(path: string, side: readonly string[]): void {
    const copy = [...side];
    this.scanLog?.push((sides) => (copy.length ? sides.set(path, copy) : sides.delete(path)));
    const e = this.get(path);
    if (ts.sameTags(e.side, copy)) return;
    this.put(path, { ...e, side: copy });
    this.changed();
  }

  /** Called on metadata-cache changes and after this plugin writes a note's frontmatter. */
  setFront(path: string, front: readonly string[]): void {
    const e = this.get(path);
    if (ts.sameTags(e.front, front)) return;
    this.put(path, { ...e, front: [...front] });
    this.changed();
  }

  /** Re-reads the item's name tags; true if they changed. */
  private refreshName(item: TAbstractFile): boolean {
    const name = item instanceof TFile ? ts.parseNameTags(item.name) : [];
    const e = this.get(item.path);
    if (ts.sameTags(e.name, name)) return false;
    this.put(item.path, { ...e, name });
    return true;
  }

  onCreate(item: TAbstractFile): void {
    if (this.refreshName(item)) this.changed();
  }

  onDelete(item: TAbstractFile): void {
    const folder = item instanceof TFolder;
    this.scanLog?.push((sides) => dropKeys(sides, item.path, folder));
    if (dropKeys(this.entries, item.path, folder)) this.changed();
  }

  /** Re-keys the item and, for a folder, everything below it (its `.ts` folder moved with it). */
  onRename(item: TAbstractFile, oldPath: string): void {
    const folder = item instanceof TFolder;
    const newPath = item.path;
    this.scanLog?.push((sides) => rekey(sides, oldPath, newPath, folder));
    const moved = rekey(this.entries, oldPath, newPath, folder);
    if (this.refreshName(item) || moved) this.changed();
  }

  rebuild(): Promise<void> {
    if (!this.building) {
      this.building = this.scan()
        .catch((err) => console.error("[tag-everything] index rebuild failed", err))
        .finally(() => {
          this.scanLog = null;
          this.building = null;
        });
    }
    return this.building;
  }

  private async scan(): Promise<void> {
    const { vault } = this.app;
    const adapter = vault.adapter;
    const sides = new Map<string, string[]>();
    const colors = new Map<string, string>();
    const folders: TFolder[] = [vault.getRoot()];
    for (const item of vault.getAllLoadedFiles()) if (item instanceof TFolder && !item.isRoot()) folders.push(item);
    this.scanLog = [];

    const scanFolder = async (folderPath: string): Promise<void> => {
      const metaDir = ts.metaDirOf(folderPath);
      if (!(await adapter.exists(metaDir))) return;
      const listing = await adapter.list(metaDir);
      for (const metaPath of listing.files) {
        const file = ts.baseOf(metaPath);
        if (!file.endsWith(".json") || (ts.RESERVED_META_FILES.has(file) && file !== ts.FOLDER_META_FILE)) continue;
        let tags: ts.SidecarTag[];
        try {
          const raw = await adapter.read(metaPath);
          if (!raw.includes('"tags"')) continue;
          tags = ts.sidecarTags(ts.parseSidecar(raw));
        } catch (err) {
          // one unreadable sidecar never stops the scan of its folder
          console.warn(`[tag-everything] unreadable sidecar ignored  path=${metaPath}`, err);
          continue;
        }
        if (!tags.length) continue;
        // keyed by the path read: if the folder moves later, the replayed rename re-keys it
        const target = file === ts.FOLDER_META_FILE ? folderPath : ts.joinPath(folderPath, file.slice(0, -".json".length));
        sides.set(target, ts.dedupe(tags.map((t) => t.title.trim())));
        for (const t of tags) if (typeof t.color === "string" && COLOR_RE.test(t.color)) colors.set(t.title.trim(), t.color);
      }
    };
    await pool(folders, SCAN_CONCURRENCY, async (folder) => {
      const path = folder.path;
      try {
        await scanFolder(path);
      } catch (err) {
        if (folder.path === path) throw err;
        await scanFolder(folder.path); // renamed or moved during the scan: read it where it is now
      }
    });

    // From here on, synchronous: replay what happened during the scan, then read names and frontmatter from the
    // vault as it is now, so a rename or a metadata-cache change during the scan is not lost either.
    for (const op of this.scanLog ?? []) op(sides);
    this.scanLog = null;
    const entries = new Map<string, Stored>();
    for (const item of vault.getAllLoadedFiles()) {
      const isFile = item instanceof TFile;
      const e: Entry = {
        name: isFile ? ts.parseNameTags(item.name) : [],
        front: isFile ? cachedFrontTags(this.app, item) : [],
        side: sides.get(item.path) ?? [], // a sidecar whose file is gone (orphan) is ignored
      };
      if (!isEmpty(e)) entries.set(item.path, stored(e));
    }

    this.entries = entries;
    this.colorMap = colors;
    this.ready = true;
    this.changed();
  }
}
