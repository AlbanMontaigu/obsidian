import { Editor, Menu, Notice, Plugin, addIcon, TAbstractFile, TFile, TFolder, View, WorkspaceLeaf, debounce, getFrontMatterInfo, parseYaml } from "obsidian";
import * as ts from "./format.ts";
import { TagIndex, cachedFrontTags } from "./index.ts";
import { MetaStore } from "./store.ts";
import { TagEditorModal, TagEdit, describe } from "./modal.ts";
import { TagEverythingView, VIEW_TYPE } from "./view.ts";
import { EXPLORER_ICON, EXPLORER_ICON_SVG, EXPLORER_VIEW_TYPE, TagExplorerView } from "./explorer.ts";
import { ExplorerBadges } from "./badges.ts";
import { PLUGIN_NAME, failureMessage, plural, progressMessage } from "./messages.ts";
import { type NamingRule, makeRule, replacePlan, ruleMessage } from "./naming.ts";
import { TagFixModal } from "./fix-modal.ts";
import { replaceTagsInGroups } from "./groups.ts";
import { replaceTagsInTabs } from "./tabs.ts";
import { GUIDE_FILE, claudeGuide, guidePath, hasGuide } from "./guide.ts";
import type { ClaudeTask } from "./suggest.ts";
import { runClaudeIn } from "./claude-runner.ts";
import { TagSuggestModal, openSuggestions } from "./suggest-modal.ts";
import { addPluginMenu, fileMenuEntries, filesMenuEntries } from "./menu.ts";
import { QUERY_LANGUAGE } from "./query.ts";
import { QUERY_HOVER_SOURCE, TagQueryBlock } from "./query-block.ts";
import { RenameTagModal, TagPickerModal, TagReviewModal } from "./curator.ts";
import { rulesTags } from "./inbox.ts";
import { ConsistencyModal, openConsistency } from "./consistency-modal.ts";
import { type Exclusion, exclusionOf, renameExcluded, setExcluded } from "./exclude.ts";
import { DEFAULT_SETTINGS, TagEverythingSettings, TagEverythingSettingTab, normalizeSettings, targetFor } from "./settings.ts";

/** Plans one item's change from its current tags and where its new tags go. */
type Planner = (state: ts.TagState, target: ts.TagTarget, item: TAbstractFile) => ts.TagPlan;

/** The planner of an edit: `added` and `removed` merged into the item's stored tags. */
const editPlanner = (added: readonly string[], removed: readonly string[]): Planner => (state, target) => {
  const all = ts.dedupe([...state.nameTags, ...(state.frontTags ?? []), ...state.sideTags]);
  return ts.planTags(state, ts.mergeEdit(all, added, removed), target);
};

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
  /** Files created since the last auto-tag run (setting `autoApplyRules`): tagged together once creations stop. */
  private arrivals = new Set<string>();
  /** A download or a sync creates files in bursts, and a file may still be written: wait for things to settle. */
  private tagArrivalsSoon = debounce(() => void this.tagArrivals(), 2000, true);
  /** `exclusionOf` per item ("d:" folder / "f:" file + path): it only depends on the settings, cleared when they change. */
  private exclusionCache = new Map<string, Exclusion | null>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new TagIndex(this.app, this.settings.extensionTags);
    this.index.autoColors = this.settings.autoColors;
    this.index.excluded = (path, isFolder) => !!this.exclusion(path, isFolder);
    this.store = new MetaStore(this.app);
    this.badges = new ExplorerBadges(this);

    this.registerView(VIEW_TYPE, (leaf) => new TagEverythingView(leaf, this));
    addIcon(EXPLORER_ICON, EXPLORER_ICON_SVG);
    this.registerView(EXPLORER_VIEW_TYPE, (leaf) => new TagExplorerView(leaf, this));
    // Ctrl/Cmd + hover on a row of the panel or the explorer shows Obsidian's page preview.
    this.registerHoverLinkSource(VIEW_TYPE, { display: PLUGIN_NAME, defaultMod: true });
    this.registerHoverLinkSource(EXPLORER_VIEW_TYPE, { display: `${PLUGIN_NAME} explorer`, defaultMod: true });
    // `tag-everything` code blocks in notes: a live list of the items matching a tag formula
    this.registerMarkdownCodeBlockProcessor(QUERY_LANGUAGE, (source, el, ctx) => ctx.addChild(new TagQueryBlock(el, this, source)));
    this.registerHoverLinkSource(QUERY_HOVER_SOURCE, { display: `${PLUGIN_NAME} query blocks`, defaultMod: true });
    this.addSettingTab(new TagEverythingSettingTab(this.app, this));
    this.addRibbonIcon("tags", `${PLUGIN_NAME}: open the tags panel`, () => void this.openView());
    this.addRibbonIcon(EXPLORER_ICON, `${PLUGIN_NAME}: open the tag explorer`, () => void this.openExplorer());

    // Obsidian shows commands as "TagEverything: <name>", so the names don't repeat it.
    this.addCommand({ id: "open-panel", name: "Open the tags panel", callback: () => void this.openView() });
    this.addCommand({ id: "open-explorer", name: "Open the tag explorer (a tree of tags)", callback: () => void this.openExplorer() });
    this.addCommand({ id: "open-inbox", name: "Open the inbox (files without tags)", callback: () => void this.openInbox() });
    this.addCommand({ id: "open-tools", name: "Open the tag tools (re-read, rules, check, review)", callback: () => void this.openTools() });
    this.addCommand({ id: "rename-tag", name: "Rename or merge a tag", callback: () => new TagPickerModal(this.app, this).open() });
    this.addCommand({ id: "review-tags", name: "Review tags (look-alikes, synonyms, used once)", callback: () => void this.reviewTags() });
    this.addCommand({ id: "check-consistency", name: "Check tag consistency (files missing their folder's usual tags)", callback: () => void this.checkConsistency() });
    this.addCommand({ id: "insert-query", name: "Insert a tag query block", editorCallback: (editor) => this.insertQuery(editor) });
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
    this.addCommand({
      id: "suggest-tags-active-file",
      name: "Suggest tags for the current file with Claude Code",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.suggestTags([file]);
        return true;
      },
    });
    this.addCommand({
      id: "write-guide-root",
      name: "Write AI assistant guide in the vault root",
      callback: () => void this.writeGuide(this.app.vault.getRoot()),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile, source: string) =>
        addPluginMenu(menu, fileMenuEntries(this, file, source === EXPLORER_VIEW_TYPE || source === VIEW_TYPE)),
      ),
    );
    this.registerEvent(this.app.workspace.on("files-menu", (menu: Menu, files: TAbstractFile[]) => addPluginMenu(menu, filesMenuEntries(this, files))));

    this.register(() => this.tagArrivalsSoon.cancel());
    const refreshBadges = debounce(() => this.badges.refresh(), 150, true);
    this.register(() => this.badges.clear());
    this.registerEvent(this.index.on("changed", refreshBadges));
    this.registerEvent(this.app.workspace.on("layout-change", refreshBadges));
    // Note frontmatter tags follow Obsidian's metadata cache live (edits in the editor, in Properties, outside).
    this.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => this.index.setFront(file.path, cachedFrontTags(this.app, file, cache))),
    );

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", (f) => {
          this.index.onCreate(f);
          this.onArrival(f);
        }),
      );
      this.registerEvent(this.app.vault.on("delete", (f) => this.index.onDelete(f)));
      this.registerEvent(this.app.vault.on("rename", (f, oldPath) => void this.onRename(f, oldPath)));
      void this.index.rebuild();
      this.closeOldInbox();
    });
  }

  /** Closes the inbox's own sidebar view of 0.27 and before, saved in the workspace: the inbox is a tab of the explorer now. */
  closeOldInbox(): void {
    const old: WorkspaceLeaf[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.getViewState().type === "tag-everything-inbox") old.push(leaf);
    });
    for (const leaf of old) {
      try {
        leaf.detach();
      } catch (err) {
        console.warn("[tag-everything] closing the old inbox view failed", err);
      }
    }
  }

  async loadSettings(): Promise<void> {
    let raw: unknown = null;
    try {
      raw = await this.loadData();
    } catch (err) {
      console.error("[tag-everything] settings unreadable, using the defaults", err);
      new Notice("TagEverything: the settings file (data.json) could not be read; default settings are used.", 10000);
    }
    this.settings = normalizeSettings(raw ?? DEFAULT_SETTINGS); // wrong types and ranges repaired, never throws
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.index.autoColors = this.settings.autoColors;
    this.index.setExtensionTags(this.settings.extensionTags);
    this.index.trigger("changed"); // panel and badges redraw with the new colours
  }

  /**
   * Why the item is excluded from TagEverything (src/exclude.ts), or null. Asked for every item the index or the
   * badges look at: cached, the answer only depends on the path and the settings.
   */
  exclusion(path: string, isFolder: boolean): Exclusion | null {
    const { excluded, excludeRules } = this.settings;
    if (!excluded.length && !excludeRules.length) return null;
    const key = (isFolder ? "d:" : "f:") + path;
    let hit = this.exclusionCache.get(key);
    if (hit === undefined) this.exclusionCache.set(key, (hit = exclusionOf(path, isFolder, excluded, excludeRules)));
    return hit;
  }

  isExcluded(item: TAbstractFile): boolean {
    return !!this.exclusion(item.path, item instanceof TFolder);
  }

  /** Can the item get tags? Every file and folder except the vault root and what is excluded from TagEverything. */
  taggable(item: TAbstractFile): boolean {
    return !(item instanceof TFolder && item.isRoot()) && !this.isExcluded(item);
  }

  /** Excludes (`on`) or includes again these paths, then saves and re-reads the index; one notice. */
  async setExcluded(paths: readonly string[], on: boolean): Promise<void> {
    let excluded = this.settings.excluded;
    for (const path of paths) excluded = setExcluded(excluded, path, on);
    this.settings.excluded = excluded;
    await this.exclusionsChanged();
    const what = paths.length === 1 ? paths[0] : plural(paths.length, "item");
    new Notice(on ? `${PLUGIN_NAME}: ${what} excluded from the tag engine; its tags stay in place.` : `${PLUGIN_NAME}: ${what} included in the tag engine again.`);
  }

  /** After the excluded paths or the exclusion rules changed: saved, then the index re-read (it drops or takes back items). */
  async exclusionsChanged(): Promise<void> {
    this.exclusionCache.clear();
    try {
      await this.saveSettings();
    } catch (err) {
      console.error("[tag-everything] saving the exclusions failed", err);
      new Notice(`${PLUGIN_NAME}: the exclusions could not be saved.`);
    }
    // An item included again has tags to read back (its sidecar too): a rebuild, which also leaves the excluded out.
    await this.index.rebuild();
  }

  /** The tags the auto-tag rules add to the file, without those it has. */
  ruleTagsOf(file: TFile): string[] {
    return rulesTags(this.settings.rules, file.path, this.index.ownTagsOf(file.path));
  }

  /**
   * The files the auto-tag rules would tag, with the tags they would add: the items, a folder standing for every file
   * below it; excluded files and AI assistant guides left out.
   */
  ruleTargets(items: readonly TAbstractFile[]): Map<TFile, string[]> {
    const out = new Map<TFile, string[]>();
    if (!this.settings.rules.length) return out;
    const visit = (item: TAbstractFile): void => {
      if (item instanceof TFolder) return item.children.forEach(visit);
      if (!(item instanceof TFile) || out.has(item) || item.name === GUIDE_FILE || this.isExcluded(item)) return;
      const tags = this.ruleTagsOf(item);
      if (tags.length) out.set(item, tags);
    };
    items.forEach(visit);
    return out;
  }

  /** Adds the auto-tag rules' tags to the items (a folder: the files below it); says what it did. */
  async applyRulesTo(items: readonly TAbstractFile[]): Promise<void> {
    const targets = this.ruleTargets(items);
    if (!targets.size) {
      new Notice(`${PLUGIN_NAME}: no auto-tag rule adds a tag there.`);
      return;
    }
    const failed = await this.addTagsEach(targets);
    // A batch of several items has its own summary notice (applyNow).
    const [[file, tags]] = targets;
    if (!failed && targets.size === 1) new Notice(`${PLUGIN_NAME}: ${file.name} tagged ${tags.join(" ")} (auto-tag rule).`);
  }

  private onArrival(item: TAbstractFile): void {
    if (!this.settings.autoApplyRules || !this.settings.rules.length || !(item instanceof TFile) || item.name === GUIDE_FILE || this.isExcluded(item)) return;
    this.arrivals.add(item.path);
    this.tagArrivalsSoon();
  }

  /** Adds the rule tags to the files created lately (still there, still matching); one notice for the batch. */
  async tagArrivals(): Promise<void> {
    const paths = [...this.arrivals];
    this.arrivals.clear();
    const files = paths.map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f): f is TFile => f instanceof TFile);
    if (this.ruleTargets(files).size) await this.applyRulesTo(files); // nothing to say when no rule matches
  }

  private async onRename(item: TAbstractFile, oldPath: string): Promise<void> {
    const own = this.ownRenames.has(item.path);
    const folder = item instanceof TFolder;
    const wasExcluded = !!this.exclusion(oldPath, folder);
    // An excluded path follows its item (or a folder above it).
    const excluded = renameExcluded(this.settings.excluded, oldPath, item.path);
    if (excluded.some((p, i) => p !== this.settings.excluded[i])) {
      this.settings.excluded = excluded;
      this.exclusionCache.clear();
      this.saveData(this.settings).catch((err) => console.error("[tag-everything] saving the moved exclusion failed", err));
    }
    this.index.onRename(item, oldPath);
    if (this.settings.excluded.length || this.settings.excludeRules.length) {
      this.index.prune(); // moved into an excluded folder, or now matching an exclusion rule
      if (wasExcluded && !this.isExcluded(item)) void this.index.rebuild(); // moved out: its tags are read back
    }
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
    new Notice(`TagEverything: ${plural(this.index.size, "tagged item")}`);
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
      if (!this.index.ownTagsOf(path).some((t) => mapping.has(t))) continue;
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

  /**
   * Writes the AI assistant guide (`CLAUDE.md`, src/guide.ts) into `folder`, with the tags used under it and in the
   * vault. An existing guide is never overwritten: it is skipped. Resolves to the path written, or null.
   */
  async writeGuide(folder: TFolder): Promise<string | null> {
    const path = guidePath(folder.path);
    try {
      if (hasGuide(folder.children.map((c) => c.name)) || (await this.app.vault.adapter.exists(path))) {
        new Notice(`TagEverything: ${path} already exists; left untouched.`);
        return null;
      }
      const prefix = folder.isRoot() ? "" : `${folder.path}/`;
      const under = this.index.paths().filter((p) => p === folder.path || p.startsWith(prefix));
      const { storage, noteTagsInFrontmatter, tagRule, lowercase, stopWords, extensionTags } = this.settings;
      const text = claudeGuide({
        folder: folder.path,
        storage,
        noteTagsInFrontmatter,
        tagRule,
        lowercase,
        stopWords,
        extensionTags,
        // the tags written in the vault: extension tags are explained, not listed
        folderTags: this.index.counts(under, true),
        vaultTags: this.index.counts(undefined, true),
        date: new Date().toISOString().slice(0, 10),
      });
      await this.app.vault.create(path, text); // fails if the file appeared meanwhile: never overwrites
      new Notice(`TagEverything: AI assistant guide written to ${path}`);
      return path;
    } catch (err) {
      console.error(`[tag-everything] writing the guide failed  path=${path}`, err);
      new Notice(`TagEverything: ${path} could not be written (${(err as Error).message}).`);
      return null;
    }
  }

  /** Opens the rename / merge dialog of a stored tag. */
  renameTag(tag: string): RenameTagModal {
    const modal = new RenameTagModal(this.app, this, tag);
    modal.open();
    return modal;
  }

  /** Re-reads every tag, then opens the tag review (look-alikes, synonyms, tags used once). */
  async reviewTags(): Promise<TagReviewModal> {
    await this.index.rebuild();
    const modal = new TagReviewModal(this.app, this);
    modal.open();
    return modal;
  }

  /**
   * Inserts a `tag-everything` query block at the cursor: the selected text as its formula, else the formula of the
   * TagEverything explorer's box, else an empty line to type it on.
   */
  insertQuery(editor: Editor): void {
    const explorer = this.app.workspace.getLeavesOfType(EXPLORER_VIEW_TYPE)[0]?.view;
    const formula = editor.getSelection().trim() || (explorer instanceof TagExplorerView ? (explorer.currentFormula() ?? "") : "");
    const from = editor.getCursor("from");
    const before = from.ch > 0 ? "\n" : ""; // a fence must start its line
    const fence = "```";
    editor.replaceSelection(`${before}${fence}${QUERY_LANGUAGE}\n${formula}\n${fence}\n`);
    editor.setCursor({ line: from.line + (before ? 2 : 1), ch: formula.length });
  }

  /** Shows the TagEverything explorer on its Inbox tab (files without tags), opening the explorer if needed. */
  async openInbox(): Promise<TagExplorerView | null> {
    const view = await this.openExplorer();
    view?.showTab("inbox");
    return view;
  }

  /** Shows the tags panel on its Tools tab (vault-wide actions), opening the panel if needed. */
  async openTools(): Promise<TagEverythingView | null> {
    const view = await this.openView();
    view?.showPage("tools");
    return view;
  }

  /** Focuses the inbox on a folder ("" = the whole vault), then shows it. */
  async focusInbox(folder: string): Promise<void> {
    this.settings.inboxFolder = normalizeSettings({ ...this.settings, inboxFolder: folder }).inboxFolder;
    try {
      await this.saveSettings();
    } catch (err) {
      console.error("[tag-everything] saving the inbox folder failed", err);
    }
    await this.openInbox();
  }

  /** Shows the tags panel (right sidebar), opening it if needed. */
  async openView(): Promise<TagEverythingView | null> {
    const view = await this.revealView(VIEW_TYPE, "right", "the panel");
    return view instanceof TagEverythingView ? view : null;
  }

  /** Shows the TagEverything explorer (left sidebar, next to the file explorer), opening it if needed. */
  async openExplorer(): Promise<TagExplorerView | null> {
    const view = await this.revealView(EXPLORER_VIEW_TYPE, "left", "the explorer");
    return view instanceof TagExplorerView ? view : null;
  }

  /** The first view of `type`, revealed; created in a new tab of the `side` sidebar when there is none. */
  private async revealView(type: string, side: "left" | "right", what: string): Promise<View | null> {
    const { workspace } = this.app;
    try {
      let leaf = workspace.getLeavesOfType(type)[0];
      if (!leaf) {
        const created = side === "left" ? workspace.getLeftLeaf(false) : workspace.getRightLeaf(false);
        if (!created) return null;
        await created.setViewState({ type, active: true });
        leaf = created;
      }
      await workspace.revealLeaf(leaf);
      return leaf.view;
    } catch (err) {
      console.error(`[tag-everything] opening ${what} failed`, err);
      new Notice(`${PLUGIN_NAME}: ${what} could not be opened.`);
      return null;
    }
  }

  async showTag(tag: string): Promise<void> {
    (await this.openView())?.selectOnly(tag);
  }

  editTags(selection: TAbstractFile[]): void {
    const items = selection.filter((i) => this.taggable(i));
    if (!items.length) {
      new Notice(`${PLUGIN_NAME}: excluded from the tag engine; include it again first (right-click).`);
      return;
    }
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
      new Notice([`${PLUGIN_NAME}: tags not changed: tags are lower-case single words.`, ...broken.slice(0, 5)].join("\n"), 10000);
      return Promise.resolve();
    }
    return this.enqueue(items, editPlanner(edit.added, edit.removed)).then(() => undefined);
  }

  /**
   * Adds its own tags to each item (the suggestions of Claude Code); nothing is removed. A tag breaking the naming
   * rule is left out (the suggestions are already fixed). Resolves to the number of items that failed.
   */
  addTagsEach(added: ReadonlyMap<TAbstractFile, readonly string[]>): Promise<number> {
    return this.editEach(new Map([...added].map(([item, tags]) => [item, { added: [...tags], removed: [] }])));
  }

  /**
   * Applies its own edit to each item (the tag consistency check: a tag added, a misspelled one removed). An added
   * tag breaking the naming rule is left out, and then so is the item's whole edit, so nothing is removed without its
   * replacement. Resolves to the number of items that failed.
   */
  editEach(edits: ReadonlyMap<TAbstractFile, TagEdit>): Promise<number> {
    const rule = this.rule;
    const editOf = (item: TAbstractFile): TagEdit => {
      const edit = edits.get(item) ?? { added: [], removed: [] };
      const added = edit.added.filter((t) => !rule || !ruleMessage(t, rule));
      return { added, removed: added.length === edit.added.length ? edit.removed : [] };
    };
    return this.enqueue([...edits.keys()], (state, target, item) => {
      const { added, removed } = editOf(item);
      return editPlanner(added, removed)(state, target, item);
    });
  }

  /**
   * Re-reads every tag, then opens the tag consistency check (src/consistency.ts) on the files below `folder` (default:
   * the vault): the files missing a tag their folder's files nearly all carry.
   */
  checkConsistency(folder: TFolder = this.app.vault.getRoot()): Promise<ConsistencyModal> {
    return openConsistency(this, folder);
  }

  /** Opens the Claude Code suggestions for a selection (src/suggest-modal.ts `openSuggestions`). */
  suggestTags(selection: TAbstractFile[]): TagSuggestModal | null {
    return openSuggestions(this, selection);
  }

  /**
   * Runs Claude Code in `folder` with `prompt` on stdin for `task` (src/claude-runner.ts). A public field: the smoke
   * test replaces it with a fake.
   */
  runClaude = (folder: TFolder, prompt: string, signal: AbortSignal, task?: ClaudeTask): Promise<string> =>
    runClaudeIn(this.app, this.settings, folder, prompt, signal, task);

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
      new Notice(`${PLUGIN_NAME}: tags updated on ${changed} of ${describe(items)}`);
    }
    return failures.length;
  }

  private async applyOne(item: TAbstractFile, planner: Planner): Promise<boolean> {
    // The editor may have stayed open while the item was deleted (or replaced by another with the same path).
    if (this.app.vault.getAbstractFileByPath(item.path) !== item) throw new Error("it no longer exists");
    // Its tags are not in the index: a write would work from a partial view. Never touched while excluded.
    if (this.isExcluded(item)) throw new Error("it is excluded from the tag engine");
    // Sidecars are re-read here, not taken from the index: another app may have changed them since.
    const side = await this.store.readTags(item);

    if (item instanceof TFolder) {
      const { sideTags, sideChanged } = planner({ nameTags: [], sideTags: side, frontTags: [] }, "sidecar", item);
      if (!sideChanged) return false;
      await this.store.writeTags(this.store.metaPathOf(item), sideTags);
      this.index.setSide(item.path, sideTags);
      return true;
    }
    if (!(item instanceof TFile)) return false;

    const nameTags = ts.parseNameTags(item.name);
    const front = await this.readFrontTags(item);
    const plan = planner({ nameTags, sideTags: side, frontTags: front }, targetFor(item, this.settings), item);
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
