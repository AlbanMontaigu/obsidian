import { FileSystemAdapter, Notice } from "obsidian";
import { type BringInFolder, SETTLE_MS, arrivalState, isInside, sourceName } from "./bring-in.ts";
import { joinPath } from "./format.ts";
import { PLUGIN_NAME, plural } from "./messages.ts";
import type TagEverythingPlugin from "./main.ts";

/** The parts of Node's `fs` used here. */
interface Fs {
  watch(path: string, listener: () => void): { close(): void; on(event: "error", run: (err: Error) => void): void };
  constants: { COPYFILE_EXCL: number };
  promises: {
    readdir(path: string): Promise<string[]>;
    stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; size: number; mtimeMs: number; birthtimeMs: number }>;
    copyFile(from: string, to: string, mode: number): Promise<void>;
    unlink(path: string): Promise<void>;
  };
}

/** Node's `fs` of the desktop app, reached through Electron's `require` (not bundled: esbuild targets the browser). */
function nodeFs(): Fs {
  return (window as unknown as { require: (id: string) => Fs }).require("fs");
}

/** What one look at one outside folder did. */
interface ScanResult {
  brought: string[];
  failed: string[];
  /** A file may still be written: look again soon. */
  waiting: boolean;
}

/**
 * Watches the outside folders of the settings (`bringIn`) and moves their new files into the vault: copied (never
 * over an existing file), then removed from the outside folder. A copy is a new file for the vault, so it is in the
 * inbox and, with `autoApplyRules` on, gets its rule tags like any new file. Looks at every folder when started (the
 * files that came while Obsidian was closed), then after each change in one, once things settle.
 */
export class BringInWatcher {
  private watchers: { close(): void }[] = [];
  private timer: number | null = null;
  private running: Promise<number> | null = null;
  private again = false;
  /** Files whose failure was already told: said once per session, not at every look. */
  private told = new Set<string>();

  constructor(private plugin: TagEverythingPlugin) {}

  /** (Re)starts watching the folders of the settings, then looks at them at once. */
  restart(): void {
    this.stop();
    const { bringIn } = this.plugin.settings;
    if (!bringIn.length || !this.vaultBase()) return;
    const fs = nodeFs();
    for (const folder of bringIn) {
      try {
        const watcher = fs.watch(folder.source, () => this.soon());
        watcher.on("error", (err) => console.warn(`[tag-everything] watching ${folder.source} stopped`, err));
        this.watchers.push(watcher);
      } catch (err) {
        console.warn(`[tag-everything] cannot watch ${folder.source}`, err); // gone, or no access: the settings row says so
      }
    }
    void this.scanAll();
  }

  stop(): void {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch (err) {
        console.warn("[tag-everything] closing a folder watcher failed", err);
      }
    }
    this.watchers = [];
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  /** A look in SETTLE_MS, once changes stop (a download writes many times). */
  private soon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.scanAll();
    }, SETTLE_MS);
  }

  /** The vault's folder on disk, or null when the vault is not on this computer's disk. */
  private vaultBase(): string | null {
    const adapter = this.plugin.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }

  /**
   * Looks at every outside folder and brings in what arrived; one notice for what came in, one for what could not.
   * Resolves to the number of files brought in (public for the smoke test). A look asked during a look runs after it.
   */
  scanAll(): Promise<number> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async (): Promise<number> => {
      let total = 0;
      try {
        do {
          this.again = false;
          total += await this.scanOnce();
        } while (this.again);
      } finally {
        this.running = null;
      }
      return total;
    })();
    return this.running;
  }

  private async scanOnce(): Promise<number> {
    const base = this.vaultBase();
    if (!base) return 0;
    let count = 0;
    let waiting = false;
    const failed: string[] = [];
    for (const folder of this.plugin.settings.bringIn) {
      const r = await this.scan(folder, base);
      count += r.brought.length;
      waiting ||= r.waiting;
      failed.push(...r.failed);
      if (r.brought.length) {
        const names = r.brought.length <= 3 ? `: ${r.brought.join(", ")}` : "";
        new Notice(`${PLUGIN_NAME}: ${plural(r.brought.length, "file")} brought in from ${sourceName(folder.source)} to ${folder.target || "the vault root"}${names}.`);
      }
    }
    if (failed.length) {
      new Notice([`${PLUGIN_NAME}: could not bring in ${plural(failed.length, "file")}:`, ...failed.slice(0, 5)].join("\n"), 10000);
    }
    if (waiting) this.soon();
    return count;
  }

  /** Brings in the new files of one outside folder; one failing file never stops the others. */
  private async scan(folder: BringInFolder, base: string): Promise<ScanResult> {
    const fs = nodeFs();
    const out: ScanResult = { brought: [], failed: [], waiting: false };
    if (isInside(folder.source, base)) return out; // a folder of the vault itself: the modal refuses it, a hand-edited data.json too
    let names: string[];
    try {
      names = await fs.promises.readdir(folder.source);
    } catch (err) {
      console.warn(`[tag-everything] cannot read ${folder.source}`, err);
      return out;
    }
    const now = Date.now();
    for (const name of names) {
      const from = `${folder.source}\\${name}`.replace(/[\\/]+/g, "\\");
      try {
        const st = await fs.promises.stat(from);
        const state = arrivalState({ name, isFile: st.isFile(), size: st.size, mtime: st.mtimeMs, birthtime: st.birthtimeMs }, folder, now);
        if (state === "wait") out.waiting = true;
        if (state !== "bring") continue;
        await this.bringOne(fs, from, folder.target, name, base);
        out.brought.push(name);
      } catch (err) {
        console.warn(`[tag-everything] bringing in failed  path=${from}`, err);
        if (!this.told.has(from)) {
          this.told.add(from);
          out.failed.push(`${name}: ${(err as Error).message}`);
        }
      }
    }
    return out;
  }

  /** Copies one file into the vault folder `target` (never over a file), then removes it outside. */
  private async bringOne(fs: Fs, from: string, target: string, name: string, base: string): Promise<void> {
    const { vault } = this.plugin.app;
    if (target && !vault.getFolderByPath(target)) {
      try {
        await vault.createFolder(target);
      } catch (err) {
        if (!(await vault.adapter.exists(target))) throw err; // created meanwhile is fine
      }
    }
    const path = joinPath(target, name);
    if (vault.getAbstractFileByPath(path)) throw new Error(`a file named ${name} is already in ${target || "the vault root"}`);
    try {
      await fs.promises.copyFile(from, `${base}/${path}`, fs.constants.COPYFILE_EXCL);
    } catch (err) {
      if ((err as { code?: string }).code === "EEXIST") throw new Error(`a file named ${name} is already in ${target || "the vault root"}`);
      throw err;
    }
    try {
      await fs.promises.unlink(from);
    } catch (err) {
      throw new Error(`copied into the vault, but still in ${sourceName(from.slice(0, from.lastIndexOf("\\")))} (${(err as Error).message})`);
    }
  }
}
