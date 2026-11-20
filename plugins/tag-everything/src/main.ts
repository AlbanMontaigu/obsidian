import { Menu, Notice, Plugin, TAbstractFile, TFile, TFolder, debounce } from "obsidian";
import * as ts from "./format.ts";
import { TagIndex } from "./index.ts";
import { MetaStore } from "./store.ts";
import { TagEditorModal, TagEdit, describe } from "./modal.ts";
import { TagEverythingView, VIEW_TYPE } from "./view.ts";
import { ExplorerBadges } from "./badges.ts";
import { DEFAULT_SETTINGS, TagEverythingSettings, TagEverythingSettingTab } from "./settings.ts";

export default class TagEverythingPlugin extends Plugin {
  settings: TagEverythingSettings = { ...DEFAULT_SETTINGS };
  index!: TagIndex;
  store!: MetaStore;
  badges!: ExplorerBadges;
  /** Paths this plugin is renaming right now: their sidecars are moved by applyTags, not by the rename hook. */
  private ownRenames = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new TagIndex(this.app);
    this.store = new MetaStore(this.app);
    this.badges = new ExplorerBadges(this);

    this.registerView(VIEW_TYPE, (leaf) => new TagEverythingView(leaf, this));
    this.addSettingTab(new TagEverythingSettingTab(this.app, this));
    this.addRibbonIcon("tags", "File tags", () => void this.openView());

    this.addCommand({ id: "open-panel", name: "Open file tags panel", callback: () => void this.openView() });
    this.addCommand({
      id: "edit-active-file-tags",
      name: "Edit tags of the current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.editTags([file]);
        return true;
      },
    });
    this.addCommand({
      id: "rebuild-index",
      name: "Re-read all tags (after editing them outside Obsidian)",
      callback: async () => {
        await this.index.rebuild();
        new Notice(`File tags: ${this.index.paths().length} tagged items`);
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFolder && file.isRoot()) return;
        menu.addItem((item) =>
          item
            .setTitle("Edit tags")
            .setIcon("tags")
            .setSection("action")
            .onClick(() => this.editTags([file])),
        );
      }),
    );
    this.registerEvent(
      this.app.workspace.on("files-menu", (menu: Menu, files: TAbstractFile[]) => {
        const items = files.filter((f) => !(f instanceof TFolder && f.isRoot()));
        if (!items.length) return;
        menu.addItem((item) =>
          item
            .setTitle(`Edit tags of ${items.length} items`)
            .setIcon("tags")
            .setSection("action")
            .onClick(() => this.editTags(items)),
        );
      }),
    );

    const refreshBadges = debounce(() => this.badges.refresh(), 150, true);
    this.register(() => this.badges.clear());
    this.registerEvent(this.index.on("changed", refreshBadges));
    this.registerEvent(this.app.workspace.on("layout-change", refreshBadges));

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (f) => this.index.onCreate(f)));
      this.registerEvent(this.app.vault.on("delete", (f) => this.index.onDelete(f)));
      this.registerEvent(this.app.vault.on("rename", (f, oldPath) => void this.onRename(f, oldPath)));
      void this.index.rebuild();
    });
  }

  onunload(): void {
    this.badges?.clear();
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<TagEverythingSettings> | null) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.badges.refresh();
  }

  private async onRename(item: TAbstractFile, oldPath: string): Promise<void> {
    const own = this.ownRenames.has(item.path);
    this.index.onRename(item, oldPath);
    if (own || !(item instanceof TFile)) return; // a folder's .ts folder moves with it
    if (!this.settings.followRenames) {
      this.index.setSide(item.path, []);
      return;
    }
    try {
      await this.store.moveFileMeta(oldPath, item.path);
    } catch (err) {
      console.error(`[tag-everything] sidecar move failed  from=${oldPath}  to=${item.path}`, err);
    }
  }

  async openView(): Promise<TagEverythingView | null> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) return null;
      await right.setViewState({ type: VIEW_TYPE, active: true });
      leaf = right;
    }
    await workspace.revealLeaf(leaf);
    return leaf.view instanceof TagEverythingView ? leaf.view : null;
  }

  async showTag(tag: string): Promise<void> {
    (await this.openView())?.selectOnly(tag);
  }

  editTags(items: TAbstractFile[]): void {
    new TagEditorModal(this.app, items, this.index, this.settings, (edit) => this.applyTags(items, edit)).open();
  }

  /** Applies one edit to every item; one failing item never stops the others. */
  async applyTags(items: TAbstractFile[], edit: TagEdit): Promise<void> {
    const failures: string[] = [];
    let changed = 0;
    const progress = items.length > 5 ? new Notice(`Tagging ${items.length} items…`, 0) : null;
    for (const item of items) {
      try {
        if (await this.applyOne(item, edit)) changed++;
      } catch (err) {
        failures.push(`${item.name}: ${(err as Error).message}`);
        console.error(`[tag-everything] tagging failed  path=${item.path}`, err);
      }
    }
    progress?.hide();
    if (failures.length) {
      new Notice(`Tags not changed on ${failures.length} of ${items.length}:\n` + failures.slice(0, 5).join("\n"), 10000);
    } else if (items.length > 1) {
      new Notice(`Tags updated on ${changed} of ${describe(items)}`);
    }
  }

  private async applyOne(item: TAbstractFile, edit: TagEdit): Promise<boolean> {
    // Sidecars are re-read here, not taken from the index: another app may have changed them since.
    const side = await this.store.readTags(item);

    if (item instanceof TFolder) {
      const desired = ts.mergeEdit(side, edit.added, edit.removed);
      if (ts.sameTags(desired, side)) return false;
      await this.store.writeTags(ts.folderMetaPath(item.path), desired);
      this.index.setSide(item.path, desired);
      return true;
    }
    if (!(item instanceof TFile)) return false;

    const nameTags = ts.parseNameTags(item.name);
    const desired = ts.mergeEdit(ts.dedupe([...nameTags, ...side]), edit.added, edit.removed);
    const plan = ts.planTags({ nameTags, sideTags: side }, desired, this.settings.storage);
    if (!plan.renamed && !plan.sideChanged) return false;

    const oldPath = item.path;
    let newPath = oldPath;
    if (plan.renamed) {
      newPath = ts.joinPath(ts.parentOf(oldPath), ts.setNameTags(item.name, plan.nameTags));
      const clash = this.app.vault.getAbstractFileByPath(newPath);
      if (clash && clash !== item) throw new Error(`"${ts.baseOf(newPath)}" already exists`);
    }

    // Rename first: if it fails nothing has changed. A sidecar write failing afterwards at worst leaves a
    // tag in both places, never a tag lost.
    if (newPath !== oldPath) {
      this.ownRenames.add(newPath);
      try {
        await this.app.fileManager.renameFile(item, newPath); // also updates links in notes
        await this.store.moveFileMeta(oldPath, newPath);
      } finally {
        this.ownRenames.delete(newPath);
      }
    }
    if (plan.sideChanged) await this.store.writeTags(ts.fileSidecarPath(item.path), plan.sideTags);
    this.index.setSide(item.path, plan.sideTags);
    return true;
  }
}
