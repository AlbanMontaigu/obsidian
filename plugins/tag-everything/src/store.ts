import { App, TAbstractFile, TFolder } from "obsidian";
import * as ts from "./format.ts";

/**
 * Reads and writes `.ts` metadata through the vault adapter: `.ts` folders are dot-folders,
 * which the Vault API does not see.
 */
export class MetaStore {
  constructor(private app: App) {}

  private get adapter() {
    return this.app.vault.adapter;
  }

  metaPathOf(item: TAbstractFile): string {
    return item instanceof TFolder ? ts.folderMetaPath(item.path) : ts.fileSidecarPath(item.path);
  }

  /** Throws if the file exists but is not a JSON object, so a broken sidecar is never overwritten. */
  async read(metaPath: string): Promise<{ meta: ts.SidecarMeta; raw?: string }> {
    if (!(await this.adapter.exists(metaPath))) return { meta: {} };
    const raw = await this.adapter.read(metaPath);
    try {
      return { meta: ts.parseSidecar(raw), raw };
    } catch (err) {
      throw new Error(`${metaPath} is not valid .ts metadata (${(err as Error).message}); left untouched`);
    }
  }

  async readTags(item: TAbstractFile): Promise<string[]> {
    const { meta } = await this.read(this.metaPathOf(item));
    return ts.sidecarTags(meta).map((t) => t.title.trim());
  }

  /** Replaces the `tags` of a sidecar, keeping every other field. No file is created just to hold nothing. */
  async writeTags(metaPath: string, tags: readonly string[]): Promise<void> {
    const { meta, raw } = await this.read(metaPath);
    if (raw === undefined && !tags.length) return;
    await this.ensureDir(ts.parentOf(metaPath));
    await this.adapter.write(metaPath, ts.serializeSidecar(ts.withSidecarTags(meta, tags), raw));
  }

  /** Moves a file's sidecar and thumbnail after the file itself moved. Never overwrites an existing target. */
  async moveFileMeta(oldPath: string, newPath: string): Promise<void> {
    const pairs: [string, string][] = [
      [ts.fileSidecarPath(oldPath), ts.fileSidecarPath(newPath)],
      [ts.fileThumbPath(oldPath), ts.fileThumbPath(newPath)],
    ];
    for (const [from, to] of pairs) {
      if (from === to || !(await this.adapter.exists(from))) continue;
      if (await this.adapter.exists(to)) {
        console.warn(`[tag-everything] sidecar not moved, target exists  from=${from}  to=${to}`);
        continue;
      }
      await this.ensureDir(ts.parentOf(to));
      await this.adapter.rename(from, to);
    }
  }

  private async ensureDir(dir: string): Promise<void> {
    if (dir && !(await this.adapter.exists(dir))) await this.adapter.mkdir(dir);
  }
}
