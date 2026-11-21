import { HoverParent, HoverPopover, ItemView, Keymap, Menu, Notice, TAbstractFile, TFile, TFolder, ViewStateResult, WorkspaceLeaf, setIcon } from "obsidian";
import * as ts from "./format.ts";
import { cloudWeights } from "./cloud.ts";
import * as gr from "./groups.ts";
import * as fx from "./formula.ts";
import * as tb from "./tabs.ts";
import { PLUGIN_NAME, plural } from "./messages.ts";
import type TagEverythingPlugin from "./main.ts";
import type { TagEverythingSettings } from "./config.ts";
import { FormulaModal, NameModal } from "./dialogs.ts";
import { clickable, isNode, paintTag } from "./ui.ts";

export const VIEW_TYPE = "tag-everything-view";
const MAX_RESULTS = 500;
/** Drag payloads inside the panel (lower-case: DataTransfer.types lower-cases custom types). */
const TAG_MIME = "application/x-tag-everything-tag";
const GROUP_MIME = "application/x-tag-everything-group";

interface InternalApp {
  viewRegistry?: { isExtensionRegistered?: (ext: string) => boolean };
  openWithDefaultApp?: (path: string) => void;
  internalPlugins?: { getPluginById?: (id: string) => { instance?: { revealInFolder?: (f: TAbstractFile) => void } } | null };
  /** Drag a file into a note to link it, as from the file explorer. */
  dragManager?: {
    dragFile?: (evt: DragEvent, file: TFile) => unknown;
    dragFolder?: (evt: DragEvent, folder: TFolder) => unknown;
    onDragStart?: (evt: DragEvent, data: unknown) => void;
  };
}

/** Draws one tag of a formula; `negated` when it is written `NOT tag`. */
type TagChipFn = (parent: HTMLElement, tag: string, negated: boolean) => void;

/** What the panel remembers across restarts (workspace.json). */
interface PanelState {
  selected: string[];
  /** Tags searched with NOT. */
  excluded: string[];
  activeGroup: string | null;
  filter: string;
  /** Bookmark tab shown; null = All. */
  tab: string | null;
}

/**
 * Sidebar panel: tag groups, then every tag with its count; select tags (AND) to list the files and folders
 * carrying them, or exclude tags (NOT). Selecting a group selects its tags; each can then be switched off and on again.
 * Bookmark tabs (src/tabs.ts) narrow the groups and tags shown to those bookmarked in the tab; the search is shared.
 */
export class TagEverythingView extends ItemView implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  private selected: string[] = [];
  /** Tags the search excludes (AND NOT tag). */
  private excluded: string[] = [];
  /** Group whose tags make up the search, if the search started from a group. */
  private activeGroup: string | null = null;
  private filter = "";
  /** Bookmark tab shown; null = All. */
  private tab: string | null = null;
  private tabsEl!: HTMLElement;
  private groupsEl!: HTMLElement;
  private tagsEl!: HTMLElement;
  private selectedEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private searchEl!: HTMLInputElement;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: TagEverythingPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return PLUGIN_NAME;
  }

  getIcon(): string {
    return "tags";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("tag-everything-view");

    const bar = root.createDiv({ cls: "tag-everything-view-bar" });
    const search = (this.searchEl = bar.createEl("input", {
      type: "search",
      cls: "tag-everything-view-search",
      attr: { placeholder: "Filter tags…", "aria-label": "Filter tags (Enter selects the first one, Escape clears)" },
    }));
    search.value = this.filter;
    search.addEventListener("input", () => {
      this.filter = search.value.trim().toLowerCase();
      this.renderTags();
      this.app.workspace.requestSaveLayout();
    });
    search.addEventListener("keydown", (evt) => {
      if (evt.isComposing) return;
      if (evt.key === "Enter") {
        // the first tag shown, i.e. the most used one matching the filter
        const tag = this.tagsEl.querySelector<HTMLElement>(":scope > .tag-everything-chip")?.dataset.tag;
        if (!tag) return;
        evt.preventDefault();
        search.value = this.filter = "";
        this.toggle(tag);
      } else if (evt.key === "Escape" && search.value) {
        evt.preventDefault();
        evt.stopPropagation();
        search.value = this.filter = "";
        this.renderTags();
      }
    });
    const rebuild = bar.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Re-read tags (picks up changes made outside Obsidian)" } });
    setIcon(rebuild, "refresh-cw");
    clickable(rebuild, () => {
      this.statusEl.setText("Reading tags…");
      void this.plugin.index.rebuild();
    });

    this.tabsEl = root.createDiv({ cls: "tag-everything-tabs", attr: { role: "tablist" } });
    this.selectedEl = root.createDiv({ cls: "tag-everything-view-selected" });
    this.groupsEl = root.createDiv({ cls: "tag-everything-view-groups" });
    this.tagsEl = root.createDiv({ cls: "tag-everything-view-tags" });
    this.statusEl = root.createDiv({ cls: "tag-everything-view-status" });
    this.resultsEl = root.createDiv({ cls: "tag-everything-view-results" });

    this.registerEvent(this.plugin.index.on("changed", () => this.render()));
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  getState(): Record<string, unknown> {
    const state: PanelState = { selected: this.selected, excluded: this.excluded, activeGroup: this.activeGroup, filter: this.filter, tab: this.tab };
    return { ...super.getState(), ...state };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state && typeof state === "object" ? state : {}) as Partial<Record<keyof PanelState, unknown>>;
    if (Array.isArray(s.selected)) this.selected = s.selected.filter((t): t is string => typeof t === "string");
    if (Array.isArray(s.excluded)) this.excluded = s.excluded.filter((t): t is string => typeof t === "string");
    if (typeof s.activeGroup === "string" || s.activeGroup === null) this.activeGroup = s.activeGroup;
    if (typeof s.filter === "string") this.filter = s.filter;
    if (typeof s.tab === "string" || s.tab === null) this.tab = s.tab;
    if (this.searchEl) this.searchEl.value = this.filter;
    this.render();
    await super.setState(state, result);
  }

  /** Shows the items carrying `tag` (used by badge clicks). */
  selectOnly(tag: string): void {
    this.resetSearch();
    this.selected = [tag];
    this.stateChanged();
  }

  /** The search as it is, taken before a vault-wide tag fix (renders during the fix drop tags no item carries). */
  searchSnapshot(): { selected: string[]; excluded: string[] } {
    return { selected: [...this.selected], excluded: [...this.excluded] };
  }

  /** After a vault-wide tag fix: the search taken before it, with the new tag names. */
  replaceTags(before: { selected: string[]; excluded: string[] }, fn: (tags: readonly string[]) => string[]): void {
    this.selected = fn(before.selected);
    this.excluded = fn(before.excluded).filter((t) => !this.selected.includes(t));
    this.stateChanged();
  }

  /** Empties the search: no tag selected or excluded, no active group. */
  private resetSearch(): void {
    this.selected = [];
    this.excluded = [];
    this.activeGroup = null;
  }

  /** The search, tab or groups changed: redraw, and save the panel state with the workspace. */
  private stateChanged(): void {
    this.render();
    this.app.workspace.requestSaveLayout();
  }

  // ---- tag groups (stored in settings.groups, logic in src/groups.ts)

  private get groups(): gr.TagGroup[] {
    return this.plugin.settings.groups;
  }

  private async save(change: Partial<Pick<TagEverythingSettings, "groups" | "tabs">>): Promise<void> {
    Object.assign(this.plugin.settings, change);
    this.stateChanged();
    try {
      await this.plugin.saveData(this.plugin.settings);
    } catch (err) {
      console.error("[tag-everything] saving tag groups / tabs failed", err);
      new Notice("TagEverything: the tag groups and tabs could not be saved.");
    }
  }

  private async saveGroups(groups: gr.TagGroup[]): Promise<void> {
    await this.save({ groups });
  }

  /**
   * Creates a group and returns its id (public for the smoke test). Tags in `excluded` make it a formula:
   * `tags AND NOT excluded`. Created from a bookmark tab, it is bookmarked there. Throws on an empty name.
   */
  async createGroup(name: string, tags: readonly string[] = [], excluded: readonly string[] = []): Promise<string> {
    const { groups, id } = gr.addGroup(this.groups, name, tags);
    const formula = excluded.length ? fx.andOf([...tags.map(fx.tagExpr), ...excluded.map((t) => fx.notExpr(fx.tagExpr(t)))]) : null;
    const tabs = this.tab ? tb.setBookmark(this.tabs, this.tab, "groups", id, true) : this.tabs;
    await this.save({ groups: formula ? gr.setFormula(groups, id, formula) : groups, tabs });
    return id;
  }

  private deleteGroup(id: string): void {
    void this.save({ groups: gr.deleteGroup(this.groups, id), tabs: tb.forgetGroup(this.tabs, id) });
  }

  // ---- bookmark tabs (stored in settings.tabs, logic in src/tabs.ts)

  private get tabs(): tb.BookmarkTab[] {
    return this.plugin.settings.tabs;
  }

  private get currentTab(): tb.BookmarkTab | undefined {
    return this.tabs.find((t) => t.id === this.tab);
  }

  /** Shows a bookmark tab, or All with null (public for the smoke test). */
  showTab(id: string | null): void {
    this.tab = id;
    this.stateChanged();
  }

  /** Creates a bookmark tab holding these bookmarks and shows it (public for the smoke test). Throws on an empty name. */
  async createTab(name: string, tags: readonly string[] = [], groups: readonly string[] = []): Promise<string> {
    const added = tb.addTab(this.tabs, name);
    let tabs = added.tabs;
    for (const t of tags) tabs = tb.setBookmark(tabs, added.id, "tags", t, true);
    for (const g of groups) tabs = tb.setBookmark(tabs, added.id, "groups", g, true);
    this.tab = added.id;
    await this.save({ tabs });
    return added.id;
  }

  private newTab(tags: readonly string[] = [], groups: readonly string[] = []): void {
    new NameModal(this.app, "New bookmark tab", "", "Tab name", async (name) => void (await this.createTab(name, tags, groups))).open();
  }

  private bookmark(tabId: string, kind: tb.BookmarkKind, value: string, on: boolean): void {
    void this.save({ tabs: tb.setBookmark(this.tabs, tabId, kind, value, on) });
  }

  /** Menu items: bookmark a tag or group in each tab (or remove it from a tab that has it), or in a new tab. */
  private bookmarkItems(menu: Menu, kind: tb.BookmarkKind, value: string): void {
    menu.addSeparator();
    for (const tab of this.tabs) {
      const has = tab[kind].includes(value);
      menu.addItem((i) =>
        i
          .setTitle(has ? `Remove from the tab "${tab.name}"` : `Bookmark in the tab "${tab.name}"`)
          .setIcon(has ? "bookmark-minus" : "bookmark-plus")
          .onClick(() => this.bookmark(tab.id, kind, value, !has)),
      );
    }
    menu.addItem((i) =>
      i
        .setTitle("Bookmark in a new tab…")
        .setIcon("bookmark")
        .onClick(() => (kind === "tags" ? this.newTab([value]) : this.newTab([], [value]))),
    );
  }

  private tabMenu(tab: tb.BookmarkTab, evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) =>
      i
        .setTitle("Rename tab")
        .setIcon("pencil")
        .onClick(() => new NameModal(this.app, "Rename bookmark tab", tab.name, "Tab name", (name) => this.save({ tabs: tb.renameTab(this.tabs, tab.id, name) })).open()),
    );
    menu.addItem((i) =>
      i
        .setTitle("Delete tab (its tags and groups stay)")
        .setIcon("trash")
        .onClick(() => void this.save({ tabs: tb.deleteTab(this.tabs, tab.id) })),
    );
    menu.showAtMouseEvent(evt);
  }

  async addToGroup(id: string, tags: readonly string[]): Promise<void> {
    await this.saveGroups(gr.addTagsToGroup(this.groups, id, tags));
  }

  /** Searches by every tag of the group still in use; on the active group, clears the search. */
  selectGroup(id: string): void {
    const group = this.activeGroup === id ? undefined : this.groups.find((g) => g.id === id);
    this.resetSearch();
    if (group) {
      const counts = this.plugin.index.counts();
      this.activeGroup = group.id;
      this.selected = group.tags.filter((t) => counts.has(t));
    }
    this.stateChanged();
  }

  /**
   * Sets the group's search formula from text (public for the smoke test): tags are matched to the vault's spelling,
   * an empty text removes the formula (back to all its tags, AND). Throws on a syntax error.
   */
  async setGroupFormula(id: string, text: string): Promise<void> {
    const expr = text.trim() ? fx.resolveTags(fx.parseFormula(text), [...this.plugin.index.counts().keys()]) : null;
    const before = this.groups.find((g) => g.id === id);
    if (this.activeGroup === id && expr) {
      // keep the search in step: new tags of the formula start switched on
      const counts = this.plugin.index.counts();
      for (const t of fx.formulaTags(expr)) if (!before?.tags.includes(t) && counts.has(t) && !this.selected.includes(t)) this.selected.push(t);
    }
    await this.saveGroups(gr.setFormula(this.groups, id, expr));
  }

  /** The current search: the active group's formula without its switched-off tags, AND the other selected tags, AND NOT the excluded ones. */
  private searchExpr(): fx.Expr | null {
    const group = this.groups.find((g) => g.id === this.activeGroup);
    const on = (t: string): boolean => this.selected.includes(t);
    const groupPart = group ? gr.groupExpr(group) : null;
    return fx.andOf([
      groupPart && fx.prune(groupPart, on),
      ...this.selected.filter((t) => !group?.tags.includes(t)).map(fx.tagExpr),
      ...this.excluded.map((t) => fx.notExpr(fx.tagExpr(t))),
    ]);
  }

  /** Paths the current search finds; null when there is no search. */
  private searchMatches(): string[] | null {
    const search = this.searchExpr();
    return search ? this.matchPaths(search) : null;
  }

  /** Tagged paths matching `expr`; tags no item carries (e.g. renamed since) are left out of it first. */
  private matchPaths(expr: fx.Expr | null): string[] {
    const index = this.plugin.index;
    const counts = index.counts();
    const used = expr && fx.prune(expr, (t) => counts.has(t));
    if (!used) return [];
    return index.paths().filter((p) => fx.evaluate(used, (t) => index.hasTag(p, t)));
  }

  private askGroupName(title: string, initial: string, done: (name: string) => Promise<void>): void {
    new NameModal(this.app, title, initial, "Group name", done).open();
  }

  private newGroup(tags: readonly string[], excluded: readonly string[] = []): void {
    this.askGroupName("New tag group", "", async (name) => {
      await this.createGroup(name, tags, excluded);
    });
  }

  private groupMenu(group: gr.TagGroup, evt: MouseEvent): void {
    const menu = new Menu();
    const active = this.activeGroup === group.id;
    const n = this.matchPaths(gr.groupExpr(group)).length;
    menu.addItem((i) =>
      i
        .setTitle(active ? "Stop the search" : `Search with this group (${plural(n, "item")})`)
        .setIcon(active ? "search-x" : "search")
        .onClick(() => this.selectGroup(group.id)),
    );
    menu.addItem((i) =>
      i
        .setTitle("Rename group")
        .setIcon("pencil")
        .onClick(() => this.askGroupName("Rename tag group", group.name, (name) => this.saveGroups(gr.renameGroup(this.groups, group.id, name)))),
    );
    menu.addItem((i) =>
      i
        .setTitle(group.formula ? "Edit formula" : "Combine with a formula (AND, OR, NOT)")
        .setIcon("sigma")
        .onClick(() => this.editFormula(group)),
    );
    const extra = this.selected.filter((t) => !group.tags.includes(t));
    if (extra.length) {
      menu.addItem((i) =>
        i
          .setTitle(`Add the selected tags (${extra.length})`)
          .setIcon("plus")
          .onClick(() => void this.addToGroup(group.id, extra)),
      );
    }
    this.bookmarkItems(menu, "groups", group.id);
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Delete group (the tags stay on the files)")
        .setIcon("trash")
        .onClick(() => this.deleteGroup(group.id)),
    );
    menu.showAtMouseEvent(evt);
  }

  /** The group menu, opened from the keyboard: under the ⋯ button. */
  private groupMenuAt(group: gr.TagGroup, el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    this.groupMenu(group, new MouseEvent("contextmenu", { clientX: r.left, clientY: r.bottom }));
  }

  editFormula(group: gr.TagGroup): void {
    const counts = this.plugin.index.counts();
    const expr = gr.groupExpr(group);
    const current = group.formula ?? (expr ? fx.formatFormula(expr) : "");
    new FormulaModal(
      this.app,
      group.name,
      current,
      this.plugin.index.ranked(),
      counts,
      (expr) => this.matchPaths(fx.resolveTags(expr, [...counts.keys()])).length,
      (text) => this.setGroupFormula(group.id, text),
    ).open();
  }

  /** Draws a formula: chips (from `chip`, told when the tag is negated) between AND / OR / NOT and the parentheses it needs. */
  private renderExpr(parent: HTMLElement, e: fx.Expr, chip: TagChipFn, outer: fx.Expr["k"] | null = null): void {
    const op = (text: string, cls = ""): void => void parent.createSpan({ cls: "tag-everything-op " + cls, text });
    if (e.k === "tag") return chip(parent, e.tag, false);
    if (e.k === "not") {
      op("NOT");
      if (e.item.k === "tag") return chip(parent, e.item.tag, true);
      return this.renderExpr(parent, e.item, chip, "not");
    }
    const parens = (e.k === "or" && (outer === "and" || outer === "not")) || (e.k === "and" && outer === "not");
    if (parens) op("(", "is-paren");
    e.items.forEach((item, i) => {
      if (i) op(e.k === "and" ? "AND" : "OR");
      this.renderExpr(parent, item, chip, e.k);
    });
    if (parens) op(")", "is-paren");
  }

  /** Accepts tags (and, with `onGroup`, groups) dragged within the panel. */
  private dropZone(el: HTMLElement, onTag: (tag: string) => void, onGroup?: (id: string) => void): void {
    const accepts = (evt: DragEvent): boolean => {
      const types = [...(evt.dataTransfer?.types ?? [])];
      return types.includes(TAG_MIME) || (!!onGroup && types.includes(GROUP_MIME));
    };
    el.addEventListener("dragover", (evt) => {
      if (!accepts(evt)) return;
      evt.preventDefault();
      if (evt.dataTransfer) evt.dataTransfer.dropEffect = [...evt.dataTransfer.types].includes(TAG_MIME) ? "copy" : "move";
      el.addClass("is-drop-target");
    });
    el.addEventListener("dragleave", (evt) => {
      const to = evt.relatedTarget;
      if (!(isNode(to) && el.contains(to))) el.removeClass("is-drop-target");
    });
    el.addEventListener("drop", (evt) => {
      el.removeClass("is-drop-target");
      if (!accepts(evt)) return;
      evt.preventDefault();
      evt.stopPropagation();
      const tag = evt.dataTransfer?.getData(TAG_MIME);
      const group = evt.dataTransfer?.getData(GROUP_MIME);
      if (tag) onTag(tag);
      else if (group && onGroup) onGroup(group);
    });
  }

  // ---- rendering

  /** Puts the tag in the search ("on"), excludes it ("not") or takes it out (null). */
  private setMode(tag: string, mode: "on" | "not" | null): void {
    this.selected = this.selected.filter((t) => t !== tag);
    this.excluded = this.excluded.filter((t) => t !== tag);
    if (mode === "on") this.selected.push(tag);
    if (mode === "not") this.excluded.push(tag);
    this.stateChanged();
  }

  private toggle(tag: string): void {
    this.setMode(tag, this.selected.includes(tag) || this.excluded.includes(tag) ? null : "on");
  }

  /** Right-click on a tag of the cloud or of the search bar: search with it, exclude it (NOT), take it out. */
  private tagMenu(el: HTMLElement, tag: string): void {
    el.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const on = this.selected.includes(tag);
      const not = this.excluded.includes(tag);
      const menu = new Menu();
      if (!on) menu.addItem((i) => i.setTitle("Search with this tag").setIcon("search").onClick(() => this.setMode(tag, "on")));
      if (!not) menu.addItem((i) => i.setTitle("Exclude this tag (NOT)").setIcon("ban").onClick(() => this.setMode(tag, "not")));
      if (on || not) menu.addItem((i) => i.setTitle("Remove from the search").setIcon("x").onClick(() => this.setMode(tag, null)));
      this.bookmarkItems(menu, "tags", tag);
      menu.showAtMouseEvent(evt);
    });
  }

  private render(): void {
    if (!this.tagsEl) return;
    const counts = this.plugin.index.counts();
    // Before the first scan the index is empty: keep a selection restored from the saved workspace.
    if (this.plugin.index.ready) {
      this.selected = this.selected.filter((t) => counts.has(t));
      this.excluded = this.excluded.filter((t) => counts.has(t));
    }
    if (this.activeGroup && !this.groups.some((g) => g.id === this.activeGroup)) this.activeGroup = null;
    if (this.tab && !this.currentTab) this.tab = null;
    this.renderTabs();
    this.renderSelected();
    this.renderGroups();
    const matches = this.searchMatches(); // used by both: computed once
    this.renderTags(matches);
    this.renderResults(matches);
  }

  private chip(parent: HTMLElement, tag: string, extra = ""): HTMLElement {
    const el = parent.createDiv({ cls: "tag-everything-chip " + extra });
    el.dataset.tag = tag;
    paintTag(el, this.plugin.index.colorFor(tag));
    el.createSpan({ text: tag });
    // Every chip of the panel can be dragged onto a group.
    el.draggable = true;
    el.addEventListener("dragstart", (evt) => {
      if (!evt.dataTransfer) return;
      evt.stopPropagation(); // not a group drag when the chip sits in a group
      evt.dataTransfer.setData(TAG_MIME, tag);
      evt.dataTransfer.setData("text/plain", tag);
      evt.dataTransfer.effectAllowed = "copy";
    });
    return el;
  }

  /** "All", then the bookmark tabs; a tag or group dropped on a tab is bookmarked there. */
  private renderTabs(): void {
    const el = this.tabsEl;
    el.empty();
    const tabEl = (id: string | null, name: string, label: string): HTMLElement => {
      const t = el.createDiv({ cls: "tag-everything-tab", text: name, attr: { role: "tab", "aria-label": label, "aria-selected": String(this.tab === id) } });
      t.toggleClass("is-active", this.tab === id);
      clickable(t, () => this.showTab(id));
      return t;
    };
    tabEl(null, "All", "Every group and tag");
    for (const tab of this.tabs) {
      const t = tabEl(tab.id, tab.name, `${plural(tab.groups.length, "group")}, ${plural(tab.tags.length, "tag")}. Drop a tag or group here to bookmark it; right-click: rename, delete`);
      t.dataset.tab = tab.id;
      t.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.tabMenu(tab, evt);
      });
      this.dropZone(
        t,
        (tag) => this.bookmark(tab.id, "tags", tag, true),
        (group) => this.bookmark(tab.id, "groups", group, true),
      );
    }
    const add = el.createDiv({ cls: "clickable-icon tag-everything-tab-add", attr: { "aria-label": "New bookmark tab (or drop a tag or group here)" } });
    setIcon(add, "plus");
    clickable(add, () => this.newTab());
    this.dropZone(
      add,
      (tag) => this.newTab([tag]),
      (group) => this.newTab([], [group]),
    );
  }

  private renderSelected(): void {
    this.selectedEl.empty();
    const group = this.groups.find((g) => g.id === this.activeGroup);
    if (!group && !this.selected.length && !this.excluded.length) return;
    const counts = this.plugin.index.counts();
    if (group) {
      const label = this.selectedEl.createDiv({ cls: "tag-everything-view-selected-group", attr: { "aria-label": "Search started from this group" } });
      setIcon(label.createSpan(), "layers");
      label.createSpan({ text: group.name });
      // The group's tags stay listed (inside its formula, if it has one): a switched-off one (dashed) can be
      // switched on again.
      const toggleChip = (parent: HTMLElement, tag: string, negated: boolean): void => {
        const on = this.selected.includes(tag);
        const used = counts.has(tag);
        const el = this.chip(parent, tag, (on ? "is-selected" : "is-off" + (used ? "" : " is-missing")) + (negated ? " is-negated" : ""));
        el.setAttr("aria-label", !used ? "No file or folder carries this tag" : on ? "Click to leave it out of the search" : "Click to search with it");
        if (used) clickable(el, () => this.toggle(tag));
      };
      const expr = gr.groupFormula(group);
      if (expr) this.renderExpr(this.selectedEl.createDiv({ cls: "tag-everything-formula" }), expr, toggleChip);
      else for (const tag of group.tags) toggleChip(this.selectedEl, tag, false);
    }
    const searchChip = (tag: string, negated: boolean): void => {
      if (negated) this.selectedEl.createSpan({ cls: "tag-everything-op", text: "NOT" });
      const el = this.chip(this.selectedEl, tag, negated ? "is-selected is-negated" : "is-selected");
      const x = el.createSpan({ cls: "tag-everything-chip-remove" });
      setIcon(x, "x");
      el.setAttr("aria-label", "Remove from the search (right-click: more)");
      clickable(el, () => this.setMode(tag, null));
      this.tagMenu(el, tag);
    };
    for (const tag of this.selected) if (!group?.tags.includes(tag)) searchChip(tag, false);
    for (const tag of this.excluded) searchChip(tag, true);
    const clear = this.selectedEl.createEl("button", { cls: "tag-everything-view-clear", text: "Clear" });
    clear.addEventListener("click", () => {
      this.resetSearch();
      this.stateChanged();
    });
  }

  private renderGroups(): void {
    const el = this.groupsEl;
    el.empty();
    const index = this.plugin.index;
    const counts = index.counts();

    const head = el.createDiv({ cls: "tag-everything-groups-head" });
    head.createSpan({ cls: "tag-everything-groups-title", text: "Groups" });
    const add = head.createDiv({
      cls: "clickable-icon tag-everything-group-add",
      attr: { "aria-label": "New group, from the current search (or drop a tag here)" },
    });
    setIcon(add, "plus");
    clickable(add, () => this.newGroup(this.selected, this.excluded));
    this.dropZone(add, (tag) => this.newGroup([tag]));

    // In a bookmark tab, its groups only, in the panel's group order (so dragging one onto another still reorders).
    const tab = this.currentTab;
    const shown = tab ? this.groups.filter((g) => tab.groups.includes(g.id)) : this.groups;
    if (!shown.length) {
      el.createDiv({
        cls: "tag-everything-view-empty",
        text: tab
          ? `No group in this tab. + creates one here; or in All, drag a group onto "${tab.name}" (or ⋯ → Bookmark in the tab).`
          : "No groups yet. + creates one; drag tags onto a group to add them. A group is also a search: its Search button lists what it finds.",
      });
      return;
    }

    for (const group of shown) {
      const active = this.activeGroup === group.id;
      const box = el.createDiv({ cls: "tag-everything-group", attr: { "data-group": group.id } });
      box.toggleClass("is-collapsed", group.collapsed);
      box.toggleClass("is-active", active);

      const header = box.createDiv({ cls: "tag-everything-group-header" });
      header.draggable = true; // drop a group on another to reorder
      header.addEventListener("dragstart", (evt) => {
        if (!evt.dataTransfer) return;
        evt.dataTransfer.setData(GROUP_MIME, group.id);
        evt.dataTransfer.effectAllowed = "move";
      });

      const fold = header.createDiv({ cls: "tag-everything-group-fold", attr: { "aria-label": group.collapsed ? "Unfold" : "Fold" } });
      setIcon(fold, "chevron-down");
      clickable(fold, (evt) => {
        evt.stopPropagation();
        void this.saveGroups(gr.setCollapsed(this.groups, group.id, !group.collapsed));
      });

      const n = this.matchPaths(gr.groupExpr(group)).length;
      header.createSpan({ cls: "tag-everything-group-name", text: group.name });
      if (group.formula) {
        const sigma = header.createSpan({ cls: "tag-everything-group-formula-icon", attr: { "aria-label": `Formula: ${group.formula}` } });
        setIcon(sigma, "sigma");
      }
      // Labelled search button: the whole header searches too, but an icon alone was easy to miss.
      const find = header.createDiv({
        cls: "tag-everything-group-search",
        attr: { "aria-label": active ? "Stop the search" : `Search with the whole group: lists the ${plural(n, "item")} it finds` },
      });
      setIcon(find.createSpan({ cls: "tag-everything-group-search-icon" }), active ? "search-x" : "search");
      find.createSpan({ cls: "tag-everything-group-search-label", text: active ? "Stop" : "Search" });
      find.createSpan({ cls: "tag-everything-chip-count", text: String(n) });
      clickable(find, (evt) => {
        evt.stopPropagation();
        this.selectGroup(group.id);
      });
      const more = header.createDiv({ cls: "clickable-icon tag-everything-group-more", attr: { "aria-label": "Group options" } });
      setIcon(more, "more-horizontal");
      clickable(more, (evt) => {
        evt.stopPropagation();
        if (evt.instanceOf(MouseEvent)) this.groupMenu(group, evt);
        else this.groupMenuAt(group, more);
      });
      clickable(header, () => this.selectGroup(group.id));
      header.setAttr("aria-label", active ? "Click to stop the search" : "Click to search with this group");
      header.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.groupMenu(group, evt);
      });

      this.dropZone(
        box,
        (tag) => void this.addToGroup(group.id, [tag]),
        (moved) => void this.saveGroups(gr.moveGroup(this.groups, moved, group.id)),
      );

      if (group.collapsed) continue;
      const body = box.createDiv({ cls: "tag-everything-group-tags" });
      if (!group.tags.length) body.createDiv({ cls: "tag-everything-view-empty", text: "Drag tags here." });
      const groupChip = (parent: HTMLElement, tag: string, negated: boolean): void => {
        const c = counts.get(tag) ?? 0;
        const chip = this.chip(parent, tag, (this.selected.includes(tag) ? "is-selected" : "") + (c ? "" : " is-missing") + (negated ? " is-negated" : ""));
        chip.createSpan({ cls: "tag-everything-chip-count", text: String(c) });
        // Hover buttons, also in the chip's right-click menu: NOT on / off in the group's search, take out of the group.
        const notLabel = negated ? "Include it again in the group's search" : "Exclude it in the group's search (NOT)";
        const negate = (): void => void this.saveGroups(gr.toggleTagNot(this.groups, group.id, tag));
        const remove = (): void => void this.saveGroups(gr.removeTagFromGroup(this.groups, group.id, tag));
        const not = chip.createSpan({ cls: "tag-everything-chip-not", attr: { "aria-label": notLabel } });
        setIcon(not, negated ? "undo-2" : "ban");
        const x = chip.createSpan({ cls: "tag-everything-chip-remove", attr: { "aria-label": "Remove from the group" } });
        setIcon(x, "x");
        not.addEventListener("click", (evt) => {
          evt.stopPropagation();
          negate();
        });
        x.addEventListener("click", (evt) => {
          evt.stopPropagation();
          remove();
        });
        chip.addEventListener("contextmenu", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          const menu = new Menu();
          menu.addItem((i) => i.setTitle(notLabel).setIcon(negated ? "undo-2" : "ban").onClick(negate));
          menu.addItem((i) => i.setTitle("Remove from the group").setIcon("x").onClick(remove));
          menu.showAtMouseEvent(evt);
        });
        if (c) clickable(chip, () => this.toggle(tag));
        else chip.setAttr("aria-label", "No file or folder carries this tag");
      };
      const error = gr.formulaError(group);
      if (error) {
        const err = body.createDiv({ cls: "tag-everything-error", text: `Formula not understood (${error}): searching all the tags. ⋯ → Edit formula.` });
        err.setAttr("aria-label", group.formula ?? "");
      }
      const expr = gr.groupFormula(group);
      if (expr) this.renderExpr(body, expr, groupChip);
      else for (const tag of group.tags) groupChip(body, tag, false);
    }
  }

  /** The tag cloud, counted over what the search finds (`matches`; null = no search: the whole vault). */
  private renderTags(matches = this.searchMatches()): void {
    this.tagsEl.empty();
    const index = this.plugin.index;
    const search = matches !== null;
    const counts = index.counts(matches ?? undefined);
    // In a bookmark tab, its tags only; with no search, one no item carries any more stays (faded) so it can be removed.
    const tab = this.currentTab;
    const entries: [string, number][] = tab ? tab.tags.map((t): [string, number] => [t, counts.get(t) ?? 0]).filter(([, n]) => n > 0 || !search) : [...counts];
    const rows = entries
      .filter(([t]) => !this.selected.includes(t) && !this.excluded.includes(t) && (!this.filter || t.toLowerCase().includes(this.filter)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!rows.length) {
      this.tagsEl.createDiv({
        cls: "tag-everything-view-empty",
        text: this.filter
          ? `No tag matches "${this.filter}".`
          : tab && !tab.tags.length
            ? `No tag in this tab yet. In All, drag a tag onto "${tab.name}" (or right-click it → Bookmark in the tab).`
            : !index.size
              ? "No tags yet. Right-click a file or folder → Edit tags."
              : "No other tag.",
      });
      return;
    }
    // Size by use, relative to the tags shown (so it adapts to the filter and the selection).
    const weights = cloudWeights(rows);
    for (const [tag, n] of rows) {
      const el = this.chip(this.tagsEl, tag, n ? "" : "is-missing");
      el.setCssProps({ "--tag-everything-weight": String(weights.get(tag) ?? 0) });
      el.createSpan({ cls: "tag-everything-chip-count", text: String(n) });
      if (n) clickable(el, () => this.toggle(tag));
      else el.setAttr("aria-label", "No file or folder carries this tag (right-click: remove it from the tab)");
      this.tagMenu(el, tag);
    }
  }

  private renderResults(matches: string[] | null): void {
    this.resultsEl.empty();
    const index = this.plugin.index;
    const total = index.size;
    if (!matches) {
      this.statusEl.setText(
        this.activeGroup
          ? "No tag of this group is switched on: click one above."
          : `${plural(total, "tagged item")}. Click a tag (right-click: exclude it), or Search with a whole group.`,
      );
      return;
    }
    const vault = this.app.vault;
    const items = matches
      .map((p) => vault.getAbstractFileByPath(p))
      .filter((f): f is TAbstractFile => !!f)
      .sort((a, b) => Number(a instanceof TFile) - Number(b instanceof TFile) || a.path.localeCompare(b.path));
    this.statusEl.setText(plural(items.length, "item") + (items.length > MAX_RESULTS ? `, first ${MAX_RESULTS} shown` : ""));

    for (const item of items.slice(0, MAX_RESULTS)) {
      const row = this.resultsEl.createDiv({ cls: "tag-everything-result" });
      const icon = row.createSpan({ cls: "tag-everything-result-icon" });
      setIcon(icon, item instanceof TFolder ? "folder" : "file");
      const body = row.createDiv({ cls: "tag-everything-result-body" });
      body.createDiv({ cls: "tag-everything-result-name", text: item.name });
      const parent = ts.parentOf(item.path);
      if (parent) body.createDiv({ cls: "tag-everything-result-path", text: parent });
      const chips = body.createDiv({ cls: "tag-everything-result-tags" });
      for (const t of index.tagsOf(item.path)) this.chip(chips, t, "is-small" + (this.selected.includes(t) ? " is-selected" : ""));

      clickable(row, (evt) => this.openItem(item, evt));
      row.addEventListener("auxclick", (evt) => {
        if (evt.button === 1) this.openItem(item, evt); // middle click: new tab
      });
      row.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        this.app.workspace.trigger("file-menu", menu, item, VIEW_TYPE, this.leaf);
        menu.showAtMouseEvent(evt);
      });
      if (item instanceof TFile) {
        // Ctrl/Cmd + hover: page preview, as in the file explorer (source registered in main.ts)
        row.addEventListener("mouseover", (evt) => {
          this.app.workspace.trigger("hover-link", { event: evt, source: VIEW_TYPE, hoverParent: this, targetEl: row, linktext: item.path });
        });
      }
      // Drag into a note to link the item, as from the file explorer (internal API: skipped if missing).
      row.draggable = true;
      row.addEventListener("dragstart", (evt) => {
        try {
          const dm = (this.app as unknown as InternalApp).dragManager;
          const data = item instanceof TFile ? dm?.dragFile?.(evt, item) : item instanceof TFolder ? dm?.dragFolder?.(evt, item) : null;
          if (data) dm?.onDragStart?.(evt, data);
        } catch (err) {
          console.warn("[tag-everything] drag unavailable", err);
        }
      });
    }
  }

  // Not "open": View.open(containerEl) is an internal Obsidian method that this would shadow.
  private openItem(item: TAbstractFile, evt: MouseEvent | KeyboardEvent): void {
    const app = this.app as unknown as InternalApp;
    try {
      if (item instanceof TFolder) {
        app.internalPlugins?.getPluginById?.("file-explorer")?.instance?.revealInFolder?.(item);
        return;
      }
      if (!(item instanceof TFile)) return;
      // A file Obsidian has no view for (Office files...) opens in the system app.
      const known = app.viewRegistry?.isExtensionRegistered?.(item.extension) ?? true;
      if (!known && app.openWithDefaultApp) app.openWithDefaultApp(item.path);
      else void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(item);
    } catch (err) {
      console.error("[tag-everything] open failed", err);
    }
  }
}
