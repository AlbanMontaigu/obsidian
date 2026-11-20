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

const EMPTY: Entry = { name: [], front: [], side: [] };

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

/**
 * In-memory view of every tagged file and folder in the vault. Name tags follow vault events.
 * Sidecars live in `.ts` folders, which Obsidian does not watch, so edits made outside Obsidian show up
 * after a rebuild (on startup, or the "Rebuild tag index" command / panel button).
 */
export class TagIndex extends Events {
  private entries = new Map<string, Entry>();
  private colorMap = new Map<string, string>();
  private building: Promise<void> | null = null;
  /** Mirrors the `autoColors` setting (set by the plugin). */
  autoColors = true;
  private notify = debounce(() => this.trigger("changed"), 50, true);

  constructor(private app: App) {
    super();
  }

  get(path: string): Entry {
    return this.entries.get(path) ?? EMPTY;
  }

  tagsOf(path: string): string[] {
    const e = this.entries.get(path);
    return e ? ts.dedupe([...e.name, ...e.front, ...e.side]) : [];
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

  /** Tag -> number of items, over `paths` (default: everything). */
  counts(paths: Iterable<string> = this.entries.keys()): Map<string, number> {
    const out = new Map<string, number>();
    for (const p of paths) for (const t of this.tagsOf(p)) out.set(t, (out.get(t) ?? 0) + 1);
    return out;
  }

  /** Tags sorted by use, most used first. */
  ranked(): string[] {
    return [...this.counts()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }

  /** Paths carrying every tag in `tags`. */
  matching(tags: readonly string[]): string[] {
    if (!tags.length) return [];
    return this.paths().filter((p) => {
      const own = this.tagsOf(p);
      return tags.every((t) => own.includes(t));
    });
  }

  private put(path: string, e: Entry): void {
    if (e.name.length || e.front.length || e.side.length) this.entries.set(path, e);
    else this.entries.delete(path);
  }

  setSide(path: string, side: readonly string[]): void {
    this.put(path, { ...this.get(path), side: [...side] });
    this.notify();
  }

  /** Called on metadata-cache changes and after this plugin writes a note's frontmatter. */
  setFront(path: string, front: readonly string[]): void {
    const e = this.get(path);
    if (ts.sameTags(e.front, front)) return;
    this.put(path, { ...e, front: [...front] });
    this.notify();
  }

  private refreshName(item: TAbstractFile): void {
    const name = item instanceof TFile ? ts.parseNameTags(item.name) : [];
    this.put(item.path, { ...this.get(item.path), name });
  }

  onCreate(item: TAbstractFile): void {
    this.refreshName(item);
    this.notify();
  }

  onDelete(item: TAbstractFile): void {
    const prefix = item.path + "/";
    for (const key of this.paths()) if (key === item.path || key.startsWith(prefix)) this.entries.delete(key);
    this.notify();
  }

  /** Re-keys the item and, for a folder, everything below it (its `.ts` folder moved with it). */
  onRename(item: TAbstractFile, oldPath: string): void {
    const prefix = oldPath + "/";
    for (const key of this.paths()) {
      if (key !== oldPath && !key.startsWith(prefix)) continue;
      const e = this.entries.get(key)!;
      this.entries.delete(key);
      this.entries.set(item.path + key.slice(oldPath.length), e);
    }
    this.refreshName(item);
    this.notify();
  }

  rebuild(): Promise<void> {
    if (!this.building) {
      this.building = this.scan()
        .catch((err) => console.error("[tag-everything] index rebuild failed", err))
        .finally(() => {
          this.building = null;
        });
    }
    return this.building;
  }

  private async scan(): Promise<void> {
    const { vault } = this.app;
    const adapter = vault.adapter;
    const entries = new Map<string, Entry>();
    const colors = new Map<string, string>();
    const folders: TFolder[] = [vault.getRoot()];

    const notes: TFile[] = [];
    for (const item of vault.getAllLoadedFiles()) {
      if (item instanceof TFile) {
        const name = ts.parseNameTags(item.name);
        if (name.length) entries.set(item.path, { name, front: [], side: [] });
        if (item.extension === "md") notes.push(item);
      } else if (item instanceof TFolder && !item.isRoot()) {
        folders.push(item);
      }
    }

    await pool(folders, SCAN_CONCURRENCY, async (folder) => {
      const metaDir = ts.metaDirOf(folder.path);
      if (!(await adapter.exists(metaDir))) return;
      const listing = await adapter.list(metaDir);
      for (const metaPath of listing.files) {
        const file = ts.baseOf(metaPath);
        if (!file.endsWith(".json") || (ts.RESERVED_META_FILES.has(file) && file !== ts.FOLDER_META_FILE)) continue;
        const raw = await adapter.read(metaPath);
        if (!raw.includes('"tags"')) continue;
        let tags: ts.SidecarTag[];
        try {
          tags = ts.sidecarTags(ts.parseSidecar(raw));
        } catch {
          console.warn(`[tag-everything] unreadable sidecar ignored  path=${metaPath}`);
          continue;
        }
        if (!tags.length) continue;
        const target = file === ts.FOLDER_META_FILE ? folder.path : ts.joinPath(folder.path, file.slice(0, -".json".length));
        if (!vault.getAbstractFileByPath(target)) continue; // orphan sidecar
        const prev = entries.get(target) ?? EMPTY;
        entries.set(target, { ...prev, side: ts.dedupe(tags.map((t) => t.title.trim())) });
        for (const t of tags) if (typeof t.color === "string" && COLOR_RE.test(t.color)) colors.set(t.title.trim(), t.color);
      }
    });

    // Frontmatter last and synchronously, right before the swap: a metadata-cache change during the async folder
    // scan would otherwise land in the old map and be lost. Later changes arrive through setFront().
    for (const note of notes) {
      const front = cachedFrontTags(this.app, note);
      if (front.length) entries.set(note.path, { ...(entries.get(note.path) ?? EMPTY), front });
    }

    this.entries = entries;
    this.colorMap = colors;
    this.notify();
  }
}
