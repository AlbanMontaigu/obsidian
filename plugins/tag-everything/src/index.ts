import { App, CachedMetadata, Events, TAbstractFile, TFile, TFolder, debounce } from "obsidian";
import * as ts from "./format.ts";
import { autoColor } from "./colors.ts";
import { type Expr, evaluate } from "./formula.ts";
import { type DateField, type DateRange, inRange } from "./dates.ts";
import { type InheritOptions, Inheritance, folderNameTags, inheriting } from "./inherit.ts";
import { type NamingRule, makeRule } from "./naming.ts";

export interface Entry {
  /** Tags read from the file name. Always empty for folders: folder names are never read for tags. */
  name: string[];
  /** Tags from a note's frontmatter `tags` property. Empty for anything but Markdown notes. */
  front: string[];
  /** Tags from `.ts/<file>.json` or, for a folder, `.ts/tsm.json`. */
  side: string[];
  /** The file's extension tag (setting `extensionTags`): read from the name, never written. Empty for folders. */
  ext: string[];
}

/** An entry with its merged tags precomputed: the panel and the badges read them many times per render. */
interface Stored extends Entry {
  /** Name, frontmatter and sidecar tags: the ones an edit can change. */
  own: string[];
  /** Inherited from the folders above it (src/inherit.ts), minus the tags it already has: never written. */
  inh: string[];
  /** `own` then `inh`: every tag but the extension one. */
  shown: string[];
  /** The extension tag first, then `own`, then `inh`. */
  all: string[];
  set: ReadonlySet<string>;
}

const EMPTY: Stored = { name: [], front: [], side: [], ext: [], own: [], inh: [], shown: [], all: [], set: new Set() };

function stored(e: Entry): Stored {
  const own = ts.dedupe([...e.name, ...e.front, ...e.side]);
  const all = e.ext.length ? ts.dedupe([...e.ext, ...own]) : own;
  return { name: e.name, front: e.front, side: e.side, ext: e.ext, own, inh: [], shown: own, all, set: new Set(all) };
}

function isEmpty(e: Entry): boolean {
  return !e.name.length && !e.front.length && !e.side.length && !e.ext.length;
}

/** Frontmatter tags of a note, from Obsidian's metadata cache. */
export function cachedFrontTags(app: App, file: TFile, cache?: CachedMetadata | null): string[] {
  if (file.extension !== "md") return [];
  return ts.frontmatterTags((cache ?? app.metadataCache.getFileCache(file))?.frontmatter);
}

/** Sidecar colours accepted as is: hex or rgb()/rgba(), nothing that could inject CSS. */
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

/** The keys of a path-keyed map at `path` and, with `below`, under it. */
function keysAt<V>(map: Map<string, V>, path: string, below: boolean): string[] {
  return below ? [...map.keys()].filter((k) => k === path || k.startsWith(path + "/")) : map.has(path) ? [path] : [];
}

/** Re-keys `oldPath` and everything below it to `newPath` in a path-keyed map. */
function rekey<V>(map: Map<string, V>, oldPath: string, newPath: string, below: boolean): boolean {
  let moved = false;
  for (const key of keysAt(map, oldPath, below)) {
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
  /**
   * Items excluded from TagEverything (set by the plugin, src/exclude.ts): never kept in the index. After the
   * exclusions change, a `rebuild()`; after a rename, `prune()` drops what moved into an exclusion.
   */
  excluded: (path: string, isFolder: boolean) => boolean = () => false;
  /** Mirrors the `extensionTags` setting: change it with `setExtensionTags`. */
  private extensionTags: boolean;
  /** Mirrors the settings `inheritFolderTags` / `folderNameTags`: change them with `setInheritance`. */
  private inherit: InheritOptions = { inherit: false, folderNames: false };
  private nameRule: NamingRule = makeRule();
  /**
   * While inheritance is on: `entries` plus, for every item of the vault, the tags it inherits; computed on first use
   * after a change (one pass over the vault). Off: `entries` itself.
   */
  private viewCache: Map<string, Stored> | null = null;
  /** The computation behind `viewCache`, kept to say where an inherited tag comes from. */
  private inheritance: Inheritance | null = null;
  /** Tags that some item inherits and no item stores (a folder name's): drawn as inherited in tag lists. */
  private inheritedOnly = new Set<string>();
  private notify = debounce(() => this.trigger("changed"), 50, true);

  constructor(
    private app: App,
    extensionTags = true,
  ) {
    super();
    this.extensionTags = extensionTags;
  }

  get(path: string): Entry {
    return this.entries.get(path) ?? EMPTY;
  }

  /** Every tag of the item (extension, name, frontmatter, sidecar, inherited), once. Do not mutate. */
  tagsOf(path: string): readonly string[] {
    return (this.view().get(path) ?? EMPTY).all;
  }

  /** The tags an edit can change (name, frontmatter, sidecar): no extension tag, no inherited one. Do not mutate. */
  ownTagsOf(path: string): readonly string[] {
    return (this.entries.get(path) ?? EMPTY).own;
  }

  /** The item's own tags, then the ones it inherits: what the explorers show (no extension tag). Do not mutate. */
  shownTagsOf(path: string): readonly string[] {
    return (this.view().get(path) ?? EMPTY).shown;
  }

  /** The tags the item inherits from its folders (and, for a folder, from its own name). Do not mutate. */
  inheritedOf(path: string): readonly string[] {
    return (this.view().get(path) ?? EMPTY).inh;
  }

  /** The folder the item inherits `tag` from (the nearest), or null when it doesn't inherit it. */
  inheritedFrom(path: string, tag: string): string | null {
    if (!this.inheritedOf(path).includes(tag)) return null;
    return this.inheritance?.sourceOf(path, this.app.vault.getAbstractFileByPath(path) instanceof TFolder, tag) ?? null;
  }

  /** Is the tag only inherited (some item inherits it, none stores it)? Tag lists draw it as inherited. */
  onlyInherited(tag: string): boolean {
    this.view();
    return this.inheritedOnly.has(tag);
  }

  /** Turns inheritance on or off, or changes the liaison words that split folder names (settings). */
  setInheritance(opts: InheritOptions, stopWords: string): void {
    const rule = makeRule(stopWords);
    const sameWords = rule.stopWords.size === this.nameRule.stopWords.size && [...rule.stopWords].every((w) => this.nameRule.stopWords.has(w));
    if (opts.inherit === this.inherit.inherit && opts.folderNames === this.inherit.folderNames && sameWords) return;
    this.inherit = { inherit: opts.inherit, folderNames: opts.folderNames };
    this.nameRule = rule;
    this.inheritedOnly = new Set();
    this.changed();
  }

  private view(): Map<string, Stored> {
    if (!inheriting(this.inherit)) return this.entries;
    return (this.viewCache ??= this.computeView());
  }

  /** One pass over the vault: every item's inherited tags on top of its stored entry. */
  private computeView(): Map<string, Stored> {
    const names = new Map<string, readonly string[]>();
    const inh = new Inheritance(this.inherit, {
      ownOf: (p) => (this.entries.get(p) ?? EMPTY).own,
      nameTagsOf: (name) => {
        let tags = names.get(name);
        if (!tags) names.set(name, (tags = folderNameTags(name, this.nameRule)));
        return tags;
      },
      excluded: (p, isFolder) => this.excluded(p, isFolder),
    });
    const out = new Map<string, Stored>();
    const inherited = new Set<string>();
    const kept = new Set<string>();
    for (const item of this.app.vault.getAllLoadedFiles()) {
      if (item instanceof TFolder && item.isRoot()) continue;
      const base = this.entries.get(item.path) ?? EMPTY;
      for (const t of base.own) kept.add(t);
      const tags = inh.tagsOf(item.path, item instanceof TFolder, base.set);
      if (!tags.length) {
        if (base !== EMPTY) out.set(item.path, base);
        continue;
      }
      for (const t of tags) inherited.add(t);
      const all = [...base.all, ...tags];
      out.set(item.path, { ...base, inh: tags, shown: [...base.own, ...tags], all, set: new Set(all) });
    }
    this.inheritance = inh;
    this.inheritedOnly = new Set([...inherited].filter((t) => !kept.has(t)));
    return out;
  }

  /** Do the file's dates (`stat`) meet the range (src/dates.ts)? A folder, or a path no longer in the vault: no. */
  dated(path: string, field: DateField, range: DateRange, now = Date.now()): boolean {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile && inRange(field === "created" ? f.stat.ctime : f.stat.mtime, range, now);
  }

  /** Does the item match the formula: its tags, and its file's dates for the date terms (looked up only for those). */
  matches(expr: Expr, path: string, now = Date.now()): boolean {
    return evaluate(expr, (t) => this.hasTag(path, t), (field, range) => this.dated(path, field, range, now));
  }

  hasTag(path: string, tag: string): boolean {
    return (this.view().get(path) ?? EMPTY).set.has(tag);
  }

  /** Colour stored for the tag in a `.ts` sidecar, if any. */
  colorOf(tag: string): string | undefined {
    return this.colorMap.get(tag);
  }

  /** Colour to show: the sidecar one, else (setting `autoColors`) one picked from the tag's name, else none. */
  colorFor(tag: string): string | undefined {
    return this.colorMap.get(tag) ?? (this.autoColors ? autoColor(tag) : undefined);
  }

  /** Every item with a tag (stored, extension or inherited). */
  paths(): string[] {
    return [...this.view().keys()];
  }

  get size(): number {
    return this.view().size;
  }

  /**
   * Tag -> number of items, over `paths` (default: everything, cached until the next change). `own`: stored tags
   * only (no extension tag, no inherited one), for what lists or fixes the tags written in the vault.
   */
  counts(paths?: Iterable<string>, own = false): ReadonlyMap<string, number> {
    const cache = !paths && !own;
    if (cache && this.countsCache) return this.countsCache;
    const out = new Map<string, number>();
    for (const p of paths ?? this.view().keys()) for (const t of own ? this.ownTagsOf(p) : this.tagsOf(p)) out.set(t, (out.get(t) ?? 0) + 1);
    if (cache) this.countsCache = out;
    return out;
  }

  /** Tags sorted by use, most used first (cached until the next change). Do not mutate. */
  ranked(): readonly string[] {
    this.rankedCache ??= [...this.counts()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
    return this.rankedCache;
  }

  private changed(): void {
    this.countsCache = null;
    this.rankedCache = null;
    this.viewCache = null;
    this.notify();
  }

  private put(path: string, e: Entry): void {
    if (isEmpty(e) || this.excluded(path, this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) this.entries.delete(path);
    else this.entries.set(path, stored(e));
  }

  /**
   * Drops the item at `path` (with `below`, also everything under it) if it is excluded now: after a move into an
   * excluded folder, or a rename matching an exclusion rule. Only what moved is checked: a folder renamed also sends
   * one rename per item inside it.
   */
  prune(path: string, below: boolean): void {
    let dropped = false;
    for (const key of keysAt(this.entries, path, below)) {
      if (!this.excluded(key, this.app.vault.getAbstractFileByPath(key) instanceof TFolder)) continue;
      this.entries.delete(key);
      dropped = true;
    }
    if (dropped) this.changed();
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

  private extOf(item: TAbstractFile): string[] {
    const tag = this.extensionTags && item instanceof TFile ? ts.extensionTag(item.name) : null;
    return tag ? [tag] : [];
  }

  /** Re-reads the item's name and extension tags; true if they changed. */
  private refreshName(item: TAbstractFile): boolean {
    const name = item instanceof TFile ? ts.parseNameTags(item.name) : [];
    const ext = this.extOf(item);
    const e = this.get(item.path);
    if (ts.sameTags(e.name, name) && ts.sameTags(e.ext, ext)) return false;
    this.put(item.path, { ...e, name, ext });
    return true;
  }

  /** Turns the extension tags on or off for every file (setting `extensionTags`). */
  setExtensionTags(on: boolean): void {
    if (on === this.extensionTags) return;
    this.extensionTags = on;
    let changed = false;
    for (const file of this.app.vault.getFiles()) changed = this.refreshName(file) || changed;
    if (changed) this.changed();
  }

  // While inheritance is on, any item created, deleted or moved can change what is inherited: always `changed()`.

  onCreate(item: TAbstractFile): void {
    if (this.refreshName(item) || inheriting(this.inherit)) this.changed();
  }

  onDelete(item: TAbstractFile): void {
    const folder = item instanceof TFolder;
    this.scanLog?.push((sides) => dropKeys(sides, item.path, folder));
    if (dropKeys(this.entries, item.path, folder) || inheriting(this.inherit)) this.changed();
  }

  /** Re-keys the item and, for a folder, everything below it (its `.ts` folder moved with it). */
  onRename(item: TAbstractFile, oldPath: string): void {
    const folder = item instanceof TFolder;
    const newPath = item.path;
    this.scanLog?.push((sides) => rekey(sides, oldPath, newPath, folder));
    const moved = rekey(this.entries, oldPath, newPath, folder);
    if (this.refreshName(item) || moved || inheriting(this.inherit)) this.changed();
  }

  rebuild(): Promise<void> {
    this.building ??= (async (): Promise<void> => {
      try {
        await this.scan();
      } catch (err) {
        console.error("[tag-everything] index rebuild failed", err);
      } finally {
        this.scanLog = null;
        this.building = null;
      }
    })();
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
        ext: this.extOf(item),
      };
      if (!isEmpty(e) && !this.excluded(item.path, !isFile)) entries.set(item.path, stored(e));
    }

    this.entries = entries;
    this.colorMap = colors;
    this.ready = true;
    this.changed();
  }
}
