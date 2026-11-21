import { Menu, Notice, Plugin, TAbstractFile, TFile, TFolder, debounce, getFrontMatterInfo, parseYaml } from "obsidian";
import * as ts from "./format.ts";
import { TagIndex, cachedFrontTags } from "./index.ts";
import { MetaStore } from "./store.ts";
import { TagEditorModal, TagEdit, describe } from "./modal.ts";
import { TagEverythingView, VIEW_TYPE } from "./view.ts";
import { ExplorerBadges } from "./badges.ts";
import { failureMessage, plural, progressMessage } from "./messages.ts";
import { type NamingRule, makeRule, replacePlan, ruleMessage } from "./naming.ts";
import { TagFixModal } from "./fix-modal.ts";
import { replaceTagsInGroups } from "./groups.ts";
import { replaceTagsInTabs } from "./tabs.ts";
import { DEFAULT_SETTINGS, TagEverythingSettings, TagEverythingSettingTab, normalizeSettings, targetFor } from "./settings.ts";

/** Plans one item's change from its current tags and where its new tags go. */
type Planner = (state: ts.TagState, target: ts.TagTarget) => ts.TagPlan;

/** Every file and folder can be tagged, except the vault root. */
const taggable = (f: TAbstractFile): boolean => !(f instanceof TFolder && f.isRoot());

export default class TagEverythingPlugin extends Plugin {
  settings: TagEverythingSettings = { ...DEFAULT_SETTINGS };
  index!: TagIndex;
  store!: MetaStore;
  badges!: ExplorerBadges;
  /** Paths this plugin is renaming right now: their sidecars are moved by applyTags, not by the rename hook. */
  private ownRenames = new Set<string>();
  /** Edits run one after the other: two quick edits of the same file must not interleave their reads and writes. */
  private queue: Promise<void> = Promise.resolve();
  private ruleCache: { words: string; rule: NamingRule } | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new TagIndex(this.app);
    this.index.autoColors = this.settings.autoColors;
    this.store = new MetaStore(this.app);
    this.badges = new ExplorerBadges(this);

    this.registerView(VIEW_TYPE, (leaf) => new TagEverythingView(leaf, this));
    // Ctrl/Cmd + hover on a result of the panel shows Obsidian's page preview.
    this.registerHoverLinkSource(VIEW_TYPE, { display: "File tags", defaultMod: true });
    this.addSettingTab(new TagEverythingSettingTab(this.app, this));
    this.addRibbonIcon("tags", "Open file tags panel", () => void this.openView());

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
      id: "check-tag-names",
      name: "Check tag names (naming rule) and fix them",
      callback: () => void this.checkTagNames(),
    });
    this.addCommand({
      id: "rebuild-index",
      name: "Re-read all tags (after editing them outside Obsidian)",
      callback: () => void this.reindex(),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (!taggable(file)) return;
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
        const items = files.filter(taggable);
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
    // Note frontmatter tags follow Obsidian's metadata cache live (edits in the editor, in Properties, outside).
    this.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => this.index.setFront(file.path, cachedFrontTags(this.app, file, cache))),
    );

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (f) => this.index.onCreate(f)));
      this.registerEvent(this.app.vault.on("delete", (f) => this.index.onDelete(f)));
      this.registerEvent(this.app.vault.on("rename", (f, oldPath) => void this.onRename(f, oldPath)));
      void this.index.rebuild();
    });
  }

  async loadSettings(): Promise<void> {
    let raw: unknown = null;
    try {
      raw = await this.loadData();
    } catch (err) {
      console.error("[tag-everything] settings unreadable, using the defaults", err);
      new Notice("File tags: the settings file (data.json) could not be read; default settings are used.", 10000);
    }
    this.settings = normalizeSettings(raw ?? DEFAULT_SETTINGS); // wrong types and ranges repaired, never throws
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.index.autoColors = this.settings.autoColors;
    this.index.trigger("changed"); // panel and badges redraw with the new colours
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

  /** The tag naming rule (src/naming.ts) when the setting is on, else null. */
  get rule(): NamingRule | null {
    if (!this.settings.tagRule) return null;
    const words = this.settings.stopWords;
    if (this.ruleCache?.words !== words) this.ruleCache = { words, rule: makeRule(words) };
    return this.ruleCache.rule;
  }

  /** Re-reads every tag (sidecars, names, frontmatter) and says how many items carry one. */
  async reindex(): Promise<void> {
    await this.index.rebuild();
    new Notice(`File tags: ${plural(this.index.size, "tagged item")}`);
  }

  /**
   * Opens the vault check: every tag breaking the naming rule, with its fix (works with the rule off too). All tags
   * are re-read first, so tags edited outside Obsidian are checked too.
   */
  async checkTagNames(): Promise<TagFixModal> {
    await this.index.rebuild();
    const modal = new TagFixModal(this.app, this, this.rule ?? makeRule(this.settings.stopWords));
    modal.open();
    return modal;
  }

  /**
   * Vault-wide fix: every item carrying a mapped tag gets it replaced by its replacements, where the tag was (name,
   * frontmatter, sidecar; `replacePlan`). Tag groups and bookmark tabs follow. Queued like `applyTags`.
   */
  async replaceTags(mapping: ts.TagMapping): Promise<{ items: number; failed: number }> {
    if (!mapping.size) return { items: 0, failed: 0 };
    const items: TAbstractFile[] = [];
    for (const path of this.index.paths()) {
      if (!this.index.tagsOf(path).some((t) => mapping.has(t))) continue;
      const item = this.app.vault.getAbstractFileByPath(path);
      if (item) items.push(item);
    }
    const panels = this.app.workspace
      .getLeavesOfType(VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((v): v is TagEverythingView => v instanceof TagEverythingView)
      .map((view) => ({ view, before: view.searchSnapshot() }));
    const failed = await this.enqueue(items, (state) => replacePlan(state, mapping));
    const { groups, tabs } = this.settings;
    const nextGroups = replaceTagsInGroups(groups, mapping);
    const nextTabs = replaceTagsInTabs(tabs, mapping);
    if (nextGroups.some((g, i) => g !== groups[i]) || nextTabs.some((t, i) => t !== tabs[i])) {
      this.settings.groups = nextGroups;
      this.settings.tabs = nextTabs;
      try {
        await this.saveSettings();
      } catch (err) {
        console.error("[tag-everything] saving the tag groups after the fix failed", err);
      }
    }
    // The panel's own search follows too.
    for (const { view, before } of panels) view.replaceTags(before, (tags) => ts.mapTagList(tags, mapping));
    return { items: items.length, failed };
  }

  async openView(): Promise<TagEverythingView | null> {
    const { workspace } = this.app;
    try {
      let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (!leaf) {
        const right = workspace.getRightLeaf(false);
        if (!right) return null;
        await right.setViewState({ type: VIEW_TYPE, active: true });
        leaf = right;
      }
      await workspace.revealLeaf(leaf);
      return leaf.view instanceof TagEverythingView ? leaf.view : null;
    } catch (err) {
      console.error("[tag-everything] opening the panel failed", err);
      new Notice("File tags: the panel could not be opened.");
      return null;
    }
  }

  async showTag(tag: string): Promise<void> {
    (await this.openView())?.selectOnly(tag);
  }

  editTags(items: TAbstractFile[]): void {
    new TagEditorModal(this.app, items, this.index, this.settings, (edit) => this.applyTags(items, edit), this.rule).open();
  }

  /**
   * Applies one edit to every item; one failing item never stops the others. Edits are queued: a second edit
   * starts once the first is written, so two quick edits of the same file never interleave.
   */
  applyTags(items: TAbstractFile[], edit: TagEdit): Promise<void> {
    // Naming rule: a new tag that breaks it is refused (the editor already offers the fix).
    const rule = this.rule;
    const broken = rule ? edit.added.map((t) => ruleMessage(t, rule)).filter((m): m is string => !!m) : [];
    if (broken.length) {
      new Notice(["Tags not changed: tags are lower-case single words.", ...broken.slice(0, 5)].join("\n"), 10000);
      return Promise.resolve();
    }
    const run = this.enqueue(items, (state, target) => {
      const all = ts.dedupe([...state.nameTags, ...(state.frontTags ?? []), ...state.sideTags]);
      return ts.planTags(state, ts.mergeEdit(all, edit.added, edit.removed), target);
    });
    return run.then(() => undefined);
  }

  /** Runs one batch after the previous one; resolves to the number of items that failed. */
  private enqueue(items: TAbstractFile[], planner: Planner): Promise<number> {
    const previous = this.queue;
    const run = (async (): Promise<number> => {
      await previous; // never rejects: see below
      return this.applyNow(items, planner);
    })();
    this.queue = (async (): Promise<void> => {
      try {
        await run;
      } catch {
        // the caller of applyTags gets the error; the next edit still runs
      }
    })();
    return run;
  }

  private async applyNow(items: TAbstractFile[], planner: Planner): Promise<number> {
    const failures: string[] = [];
    let changed = 0;
    const progress = items.length > 5 ? new Notice(progressMessage(0, items.length), 0) : null;
    try {
      for (const [i, item] of items.entries()) {
        try {
          if (await this.applyOne(item, planner)) changed++;
        } catch (err) {
          failures.push(`${item.name}: ${(err as Error).message}`);
          console.error(`[tag-everything] tagging failed  path=${item.path}`, err);
        }
        if (progress && (i % 10 === 9 || i === items.length - 1)) progress.setMessage(progressMessage(i + 1, items.length));
      }
    } finally {
      progress?.hide();
    }
    if (failures.length) {
      new Notice(failureMessage(failures, items.length), 10000);
    } else if (items.length > 1) {
      new Notice(`Tags updated on ${changed} of ${describe(items)}`);
    }
    return failures.length;
  }

  private async applyOne(item: TAbstractFile, planner: Planner): Promise<boolean> {
    // The editor may have stayed open while the item was deleted (or replaced by another with the same path).
    if (this.app.vault.getAbstractFileByPath(item.path) !== item) throw new Error("it no longer exists");
    // Sidecars are re-read here, not taken from the index: another app may have changed them since.
    const side = await this.store.readTags(item);

    if (item instanceof TFolder) {
      const { sideTags, sideChanged } = planner({ nameTags: [], sideTags: side, frontTags: [] }, "sidecar");
      if (!sideChanged) return false;
      await this.store.writeTags(this.store.metaPathOf(item), sideTags);
      this.index.setSide(item.path, sideTags);
      return true;
    }
    if (!(item instanceof TFile)) return false;

    const nameTags = ts.parseNameTags(item.name);
    const front = await this.readFrontTags(item);
    const plan = planner({ nameTags, sideTags: side, frontTags: front }, targetFor(item, this.settings));
    if (!plan.renamed && !plan.sideChanged && !plan.frontChanged) return false;
    // A tag picked from the vault (e.g. a nested note tag `a/b`) may not be valid where it is about to go.
    ts.assertWritable(plan.nameTags.filter((t) => !nameTags.includes(t)), "filename");
    ts.assertWritable(plan.frontTags.filter((t) => !front.includes(t)), "frontmatter");

    const oldPath = item.path;
    let newPath = oldPath;
    if (plan.renamed) {
      newPath = ts.joinPath(ts.parentOf(oldPath), ts.setNameTags(item.name, plan.nameTags));
      const clash = this.app.vault.getAbstractFileByPath(newPath);
      if (clash && clash !== item) throw new Error(`"${ts.baseOf(newPath)}" already exists`);
    }

    // Rename first: if it fails nothing has changed. Then the frontmatter, then the sidecar: tags only move from
    // the sidecar into the name or the frontmatter, so a failure part-way at worst leaves a tag in two places.
    if (newPath !== oldPath) {
      this.ownRenames.add(newPath);
      try {
        await this.app.fileManager.renameFile(item, newPath); // also updates links in notes
        await this.store.moveFileMeta(oldPath, newPath);
      } finally {
        this.ownRenames.delete(newPath);
      }
    }
    if (plan.frontChanged) {
      await this.app.fileManager.processFrontMatter(item, (fm: Record<string, unknown>) => ts.setFrontmatterTags(fm, plan.frontTags));
      this.index.setFront(item.path, plan.frontTags);
    }
    if (plan.sideChanged) await this.store.writeTags(this.store.metaPathOf(item), plan.sideTags); // item.path is the new path
    this.index.setSide(item.path, plan.sideTags);
    return true;
  }

  /**
   * A note's frontmatter tags, read from the file itself (the metadata cache can lag right after a write).
   * Throws on frontmatter that isn't valid YAML, so it is never rewritten.
   */
  private async readFrontTags(file: TFile): Promise<string[]> {
    if (file.extension !== "md") return [];
    const info = getFrontMatterInfo(await this.app.vault.read(file));
    if (!info.exists) return [];
    let fm: unknown;
    try {
      fm = parseYaml(info.frontmatter);
    } catch (err) {
      throw new Error(`the frontmatter is not valid YAML (${(err as Error).message.split("\n")[0]}); left untouched`);
    }
    if (fm !== null && fm !== undefined && (typeof fm !== "object" || Array.isArray(fm))) {
      throw new Error("the frontmatter is not a set of properties; left untouched");
    }
    return ts.frontmatterTags(fm);
  }
}
