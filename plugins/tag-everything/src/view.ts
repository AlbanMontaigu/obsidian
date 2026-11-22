import { HoverParent, HoverPopover, ItemView, Menu, Notice, TAbstractFile, TFile, ViewStateResult, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import { type CountRange, cloudWeights, inCountRange, narrowingTags, rangeText } from "./cloud.ts";
import * as gr from "./groups.ts";
import * as fx from "./formula.ts";
import * as sc from "./sections.ts";
import { PLUGIN_NAME, plural } from "./messages.ts";
import type TagEverythingPlugin from "./main.ts";
import type { TagEverythingSettings } from "./config.ts";
import { NameModal, dateMenu } from "./dialogs.ts";
import { PanelGroups } from "./panel-groups.ts";
import { type CountRangeControl, TAG_MIME, clickable, countRangeControl, paintTag } from "./ui.ts";
import { type RowHost, markInherited, renderItemRow, wireItemRow } from "./items.ts";
import { renderTools } from "./tools-pane.ts";
import { type DateFilters, DATE_FIELDS, criterionText, filtersText, hasDates, normalizeDates } from "./dates.ts";

export const VIEW_TYPE = "tag-everything-view";
/** Most items listed at once (panel results, a level of the TagEverything explorer). */
export const MAX_RESULTS = 500;

/**
 * A tab of the panel that is not All: Selection (the search and its results), Tools (vault-wide actions,
 * src/tools-pane.ts). The inbox is a tab of the TagEverything explorer (src/explorer.ts), not of the panel.
 */
export type PanelPage = "selection" | "tools";
const PAGES: readonly string[] = ["selection", "tools"];

/** What the panel remembers across restarts (workspace.json). */
interface PanelState {
  selected: string[];
  /** Tags searched with NOT. */
  excluded: string[];
  /** Date criteria of the search (src/dates.ts). */
  dates: DateFilters;
  /** The part of the search written with Formula… that is not plain tags or dates (ORs, parentheses), as text. */
  formula: string | null;
  activeGroup: string | null;
  filter: string;
  /** The page shown instead of All; null = All. */
  page: PanelPage | null;
  /** `page === "selection"`, also read back from the state of 0.27 and before (no `page`). */
  selection: boolean;
}

/**
 * Sidebar panel: tag groups, then every tag with its count; select tags (AND) to list the files and folders
 * carrying them, or exclude tags (NOT). Selecting a group selects its tags; each can then be switched off and on again.
 * In All, groups and tags can be moved into named sections (src/sections.ts), foldable headings under the groups.
 * The search and its results have their own tab, Selection, shown while there is a search, with the tags that can still
 * narrow it: All holds only groups, sections and every tag (the search's ones marked), at full height, whatever the search.
 */
export class TagEverythingView extends ItemView implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  private selected: string[] = [];
  /** Tags the search excludes (AND NOT tag). */
  private excluded: string[] = [];
  /** Date criteria (created / modified): the search keeps only the files meeting them. Kept by a new tag search. */
  private dates: DateFilters = {};
  /** Group whose tags make up the search, if the search started from a group. */
  private activeGroup: string | null = null;
  /** The part of the search written with Formula… that chips can't show (ORs, parentheses); ANDed with the rest. */
  private formula: fx.Expr | null = null;
  private filter = "";
  /** The page shown instead of All (Selection only while there is a search, see `hasSearch`). */
  private page: PanelPage | null = null;
  /** The Groups area of All (groups, sections), its menus and dialogs (src/panel-groups.ts). */
  private groupsPane: PanelGroups;
  /** Tools: its content (files the rules would tag) follows the vault. */
  private requestRender = debounce(() => this.render(), 300, true);
  private tabsEl!: HTMLElement;
  private groupsEl!: HTMLElement;
  private tagsHeadEl!: HTMLElement;
  private tagsCountEl!: HTMLElement;
  /** In All's Tags heading: the count range (src/ui.ts `countRangeControl`). */
  private range!: CountRangeControl;
  private tagsEl!: HTMLElement;
  /** Under All's tags: the Inherited section (tags only folders give, src/inherit.ts), foldable, its own scroll. */
  private inheritedHeadEl!: HTMLElement;
  private inheritedFoldEl!: HTMLElement;
  private inheritedCountEl!: HTMLElement;
  private inheritedEl!: HTMLElement;
  /** In the Selection tab: the tags that can still narrow the search. */
  private refineEl!: HTMLElement;
  private selectedEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private datesEl!: HTMLElement;
  /** In All's Tags heading: shows or hides the extension tags (setting `panelExtensionTags`). */
  private extToggleEl!: HTMLElement;
  private pageEl!: HTMLElement;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: TagEverythingPlugin,
  ) {
    super(leaf);
    this.groupsPane = new PanelGroups({
      app: this.app,
      plugin,
      activeGroup: () => this.activeGroup,
      selected: () => this.selected,
      addToSearch: (tags) => void this.selected.push(...tags),
      searchExpr: () => this.searchExpr(),
      selectGroup: (id) => this.selectGroup(id),
      showSelection: () => this.showSelection(),
      save: (change) => this.save(change),
      chip: (parent, tag, extra) => this.chip(parent, tag, extra),
      tagChips: (parent, tags) => {
        const counts = plugin.index.counts();
        this.cloud(parent, tags.map((t): [string, number] => [t, counts.get(t) ?? 0]), false);
      },
      toggle: (tag) => this.toggle(tag),
      sectionItems: (menu, kind, value) => this.sectionItems(menu, kind, value),
      newSection: (tags, groups) => this.newSection(tags, groups),
      matchPaths: (expr) => this.matchPaths(expr),
    });
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  /** What its result rows need for the file menu and the page preview (src/items.ts). */
  private rowHost(): RowHost {
    return { app: this.app, source: VIEW_TYPE, hoverParent: this, leaf: this.leaf };
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
      if (this.page) {
        this.page = null; // filtering is about tags: back to All
        this.render();
      } else this.renderTags();
      this.app.workspace.requestSaveLayout();
    });
    search.addEventListener("keydown", (evt) => {
      if (evt.isComposing) return;
      if (evt.key === "Enter") {
        // the first tag shown not in the search yet, i.e. the most used one matching the filter
        const first = (el: HTMLElement): string | undefined => el.querySelector<HTMLElement>(":scope > .tag-everything-chip:not(.is-selected)")?.dataset.tag;
        const tag = first(this.tagsEl) ?? first(this.inheritedEl);
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
    const dates = (this.datesEl = bar.createDiv({ cls: "clickable-icon tag-everything-dates-button", attr: { "aria-label": "Dates: created or modified, recently or long ago" } }));
    setIcon(dates, "calendar");
    clickable(dates, () => {
      const r = dates.getBoundingClientRect(); // under the icon, from the mouse or the keyboard alike
      dateMenu(this.dates, (f) => this.setDates(f)).showAtPosition({ x: r.left, y: r.bottom });
    });
    const rebuild = bar.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Re-read tags (picks up changes made outside Obsidian)" } });
    setIcon(rebuild, "refresh-cw");
    clickable(rebuild, () => {
      this.statusEl.setText("Reading tags…");
      void this.plugin.index.rebuild();
    });

    this.tabsEl = root.createDiv({ cls: "tag-everything-tabs", attr: { role: "tablist" } });
    this.selectedEl = root.createDiv({ cls: "tag-everything-view-selected" });
    this.refineEl = root.createDiv({ cls: "tag-everything-view-refine" });
    this.groupsEl = root.createDiv({ cls: "tag-everything-view-groups" });
    // A titled section under the groups, like them: the number of tags shown, then (All) the count range.
    this.tagsHeadEl = root.createDiv({ cls: "tag-everything-section-head tag-everything-tags-head" });
    this.tagsHeadEl.createSpan({ cls: "tag-everything-section-title", text: "Tags" });
    const headEnd = this.tagsHeadEl.createDiv({ cls: "tag-everything-tags-head-end" });
    this.tagsCountEl = headEnd.createSpan({ cls: "tag-everything-section-count" });
    this.extToggleEl = headEnd.createDiv({ cls: "clickable-icon tag-everything-ext-toggle" });
    setIcon(this.extToggleEl, "file-type");
    clickable(this.extToggleEl, () => {
      this.plugin.settings.panelExtensionTags = !this.plugin.settings.panelExtensionTags;
      this.render();
      this.plugin.saveSettings().catch((err) => {
        console.error("[tag-everything] saving the extension tags option failed", err);
        new Notice("TagEverything: the option could not be saved.");
      });
    });
    this.range = countRangeControl(headEnd, countRangeOf(this.plugin.settings), (r, save) => {
      setCountRange(this.plugin, r, save);
      if (!save) this.renderTags(); // saved: every view redraws (index "changed")
    });
    this.tagsEl = root.createDiv({ cls: "tag-everything-view-tags" });
    this.inheritedHeadEl = root.createDiv({ cls: "tag-everything-section-head tag-everything-tags-head tag-everything-inherited-head" });
    const title = this.inheritedHeadEl.createDiv({ cls: "tag-everything-inherited-title" });
    this.inheritedFoldEl = title.createSpan({ cls: "tag-everything-inherited-fold" });
    title.createSpan({ cls: "tag-everything-section-title", text: "Inherited" });
    this.inheritedCountEl = this.inheritedHeadEl.createSpan({ cls: "tag-everything-section-count" });
    clickable(this.inheritedHeadEl, () => {
      this.plugin.settings.panelInheritedCollapsed = !this.plugin.settings.panelInheritedCollapsed;
      this.renderTags();
      this.plugin.saveSettings().catch((err) => {
        console.error("[tag-everything] saving the Inherited section's fold failed", err);
        new Notice("TagEverything: the option could not be saved.");
      });
    });
    this.inheritedEl = root.createDiv({ cls: "tag-everything-view-inherited" });
    this.statusEl = root.createDiv({ cls: "tag-everything-view-status" });
    this.resultsEl = root.createDiv({ cls: "tag-everything-view-results" });
    this.pageEl = root.createDiv({ cls: "tag-everything-view-page" });

    this.registerEvent(this.plugin.index.on("changed", () => this.render()));
    // A file created, deleted or renamed may change what the rules would tag (Tools) without changing the index (no tag).
    const later = (): void => void this.requestRender();
    this.registerEvent(this.app.vault.on("create", later));
    this.registerEvent(this.app.vault.on("delete", later));
    this.registerEvent(this.app.vault.on("rename", later));
    this.render();
  }

  async onClose(): Promise<void> {
    this.requestRender.cancel();
    this.contentEl.empty();
  }

  getState(): Record<string, unknown> {
    const state: PanelState = {
      selected: this.selected,
      excluded: this.excluded,
      dates: this.dates,
      formula: this.formula && fx.formatFormula(this.formula),
      activeGroup: this.activeGroup,
      filter: this.filter,
      page: this.page,
      selection: this.page === "selection",
    };
    return { ...super.getState(), ...state };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state && typeof state === "object" ? state : {}) as Partial<Record<keyof PanelState, unknown>>;
    if (Array.isArray(s.selected)) this.selected = s.selected.filter((t): t is string => typeof t === "string");
    if (Array.isArray(s.excluded)) this.excluded = s.excluded.filter((t): t is string => typeof t === "string");
    if ("dates" in s) this.dates = normalizeDates(s.dates);
    if (typeof s.formula === "string" || s.formula === null) {
      const parsed = s.formula ? fx.tryParseFormula(s.formula) : null;
      this.formula = parsed && "expr" in parsed ? parsed.expr : null;
    }
    if (typeof s.activeGroup === "string" || s.activeGroup === null) this.activeGroup = s.activeGroup;
    if (typeof s.filter === "string") this.filter = s.filter;
    if (typeof s.page === "string" && PAGES.includes(s.page)) this.page = s.page as PanelPage;
    else if (s.page === null || typeof s.selection === "boolean") this.page = s.selection === true ? "selection" : null;
    if (this.searchEl) this.searchEl.value = this.filter;
    this.render();
    await super.setState(state, result);
  }

  /** Shows the items carrying `tag` (used by badge clicks). */
  selectOnly(tag: string): void {
    this.resetSearch();
    this.selected = [tag];
    this.page = "selection";
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

  /** There is a search (a tag selected or excluded, a group search, even with all its tags switched off, or a date criterion). */
  private hasSearch(): boolean {
    return !!this.activeGroup || !!this.formula || this.selected.length > 0 || this.excluded.length > 0 || hasDates(this.dates);
  }

  /**
   * Replaces the whole search with a formula (Formula…; public for the smoke test): its plain tags, NOT tags and dates
   * become chips as if clicked, the rest (ORs, parentheses) one formula chip. null: no search.
   */
  setSearchFormula(expr: fx.Expr | null): void {
    const s = fx.splitSearch(expr);
    this.resetSearch();
    this.selected = s.tags;
    this.excluded = s.not;
    this.dates = s.dates;
    this.formula = s.rest;
    this.page = this.hasSearch() ? "selection" : null;
    this.stateChanged();
  }

  /** Sets the date criteria of the search (public for the smoke test); one set shows what the search finds. */
  setDates(dates: DateFilters): void {
    this.dates = dates;
    if (hasDates(dates)) this.page = "selection";
    this.stateChanged();
  }

  /** Empties the tags of the search: no tag selected or excluded, no formula, no active group. The date criteria stay (Clear drops them). */
  private resetSearch(): void {
    this.selected = [];
    this.excluded = [];
    this.formula = null;
    this.activeGroup = null;
  }

  /** The search, tab or groups changed: redraw, and save the panel state with the workspace. */
  private stateChanged(): void {
    this.render();
    this.app.workspace.requestSaveLayout();
  }

  // ---- tag groups (src/panel-groups.ts) and sections: stored in the settings, saved here

  private get groups(): gr.TagGroup[] {
    return this.plugin.settings.groups;
  }

  /**
   * Creates a group and returns its id (public for the smoke test). Tags in `excluded` make it a formula:
   * `tags AND NOT excluded`. Throws on an empty name.
   */
  createGroup(name: string, tags: readonly string[] = [], excluded: readonly string[] = []): Promise<string> {
    return this.groupsPane.createGroup(name, tags, excluded);
  }

  /** Sets what the group searches for from a formula's text (public for the smoke test). Throws on a syntax error. */
  setGroupFormula(id: string, text: string): Promise<void> {
    return this.groupsPane.setGroupFormula(id, text);
  }

  private async save(change: Partial<Pick<TagEverythingSettings, "groups" | "tabs">>): Promise<void> {
    Object.assign(this.plugin.settings, change);
    this.stateChanged();
    try {
      await this.plugin.saveData(this.plugin.settings);
    } catch (err) {
      console.error("[tag-everything] saving tag groups / sections failed", err);
      new Notice("TagEverything: the tag groups and sections could not be saved.");
    }
  }

  // ---- sections of All (stored in settings.tabs, logic in src/sections.ts)

  private get sections(): sc.Section[] {
    return this.plugin.settings.tabs;
  }

  /** Shows All (public for main.ts and the smoke test). */
  showAll(): void {
    this.page = null;
    this.stateChanged();
  }

  /** Shows the Tools tab, or Selection while there is a search (public for main.ts and the smoke test). */
  showPage(page: PanelPage): void {
    this.page = page;
    this.stateChanged();
  }

  /** Creates a section, moves these tags and groups into it, and shows All (public for the smoke test). Throws on an empty name. */
  async createSection(name: string, tags: readonly string[] = [], groups: readonly string[] = []): Promise<string> {
    const added = sc.addSection(this.sections, name);
    let sections = added.sections;
    for (const t of tags) sections = sc.moveToSection(sections, added.id, "tags", t);
    for (const g of groups) sections = sc.moveToSection(sections, added.id, "groups", g);
    this.page = null;
    await this.save({ tabs: sections });
    return added.id;
  }

  private newSection(tags: readonly string[] = [], groups: readonly string[] = []): void {
    new NameModal(this.app, "new section", "", "Section name", async (name) => void (await this.createSection(name, tags, groups))).open();
  }

  /** Moves a tag or group into a section (null: out of its section, back to the top). Public for the smoke test. */
  async moveToSection(id: string | null, kind: sc.SectionKind, value: string): Promise<void> {
    await this.save({ tabs: sc.moveToSection(this.sections, id, kind, value) });
  }

  /** Menu items: move a tag or group into each other section, out of its own, or into a new one. */
  private sectionItems(menu: Menu, kind: sc.SectionKind, value: string): void {
    menu.addSeparator();
    const own = sc.sectionOf(this.sections, kind, value);
    for (const section of this.sections) {
      if (section === own) continue;
      menu.addItem((i) => i.setTitle(`Move to the section "${section.name}"`).setIcon("folder-input").onClick(() => void this.moveToSection(section.id, kind, value)));
    }
    if (own) {
      const where = kind === "groups" ? "back to the top" : "the tag stays in Tags";
      menu.addItem((i) => i.setTitle(`Take out of the section "${own.name}" (${where})`).setIcon("folder-output").onClick(() => void this.moveToSection(null, kind, value)));
    }
    menu.addItem((i) =>
      i
        .setTitle("Move to a new section…")
        .setIcon("folder-plus")
        .onClick(() => (kind === "tags" ? this.newSection([value]) : this.newSection([], [value]))),
    );
  }

  /** Opens the Selection tab, where the active group's search lists what it finds. */
  private showSelection(): void {
    this.page = "selection";
    this.stateChanged();
  }

  /** Searches by every tag of the group still in use; on the active group, clears the search. */
  selectGroup(id: string): void {
    const group = this.activeGroup === id ? undefined : this.groups.find((g) => g.id === id);
    this.resetSearch();
    const expr = group && gr.groupExpr(group);
    if (expr && fx.hasDateTerms(expr)) this.dates = {}; // a group with dates of its own replaces the search's
    if (group) {
      const counts = this.plugin.index.counts();
      this.activeGroup = group.id;
      this.selected = group.tags.filter((t) => counts.has(t));
      this.page = "selection";
    }
    this.stateChanged();
  }

  /**
   * The current search: the active group's formula without its switched-off tags, AND the other selected tags, AND NOT
   * the excluded ones, AND the date criteria (so *Formula…* keeps them in the new group).
   */
  private searchExpr(): fx.Expr | null {
    const group = this.groups.find((g) => g.id === this.activeGroup);
    const on = (t: string): boolean => this.selected.includes(t);
    const groupPart = group ? gr.groupExpr(group) : null;
    return fx.andOf([
      groupPart && fx.prune(groupPart, on),
      this.formula,
      ...this.selected.filter((t) => !group?.tags.includes(t)).map(fx.tagExpr),
      ...this.excluded.map((t) => fx.notExpr(fx.tagExpr(t))),
      ...fx.dateExprs(this.dates),
    ]);
  }

  /** Paths the current search finds; null when there is no search. */
  private searchMatches(): string[] | null {
    const search = this.searchExpr();
    return search ? this.matchPaths(search) : null;
  }

  /** Indexed paths matching `expr` (tags and dates); tags no item carries (e.g. renamed since) are left out of it first. */
  private matchPaths(expr: fx.Expr | null): string[] {
    const index = this.plugin.index;
    const counts = index.counts();
    const used = expr && fx.prune(expr, (t) => counts.has(t));
    if (!used) return [];
    const now = Date.now();
    return index.paths().filter((p) => index.matches(used, p, now));
  }

  // ---- rendering

  /** Puts the tag in the search ("on"), excludes it ("not") or takes it out (null). */
  private setMode(tag: string, mode: "on" | "not" | null): void {
    this.selected = this.selected.filter((t) => t !== tag);
    this.excluded = this.excluded.filter((t) => t !== tag);
    if (mode === "on") this.selected.push(tag);
    if (mode === "not") this.excluded.push(tag);
    if (mode) this.page = "selection"; // a tag added to the search: show what it finds
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
      if (this.plugin.index.counts(undefined, true).has(tag)) {
        menu.addItem((i) => i.setTitle("Rename or merge tag…").setIcon("pencil").onClick(() => this.plugin.renameTag(tag)));
      }
      this.sectionItems(menu, "tags", tag);
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
    if (this.page === "selection" && !this.hasSearch()) this.page = null;
    // One tab at a time: All (groups, sections, tags), Selection (search, results), or Tools.
    const selection = this.page === "selection";
    for (const el of [this.groupsEl, this.tagsHeadEl, this.tagsEl]) el.toggle(!this.page);
    for (const el of [this.selectedEl, this.refineEl, this.statusEl, this.resultsEl]) el.toggle(selection);
    this.pageEl.toggle(this.page === "tools");
    this.requestRender.cancel();
    const matches = this.searchMatches(); // used by the tabs, narrowing tags and results: computed once
    this.renderTabs(matches);
    this.datesEl.toggleClass("is-active", hasDates(this.dates));
    this.datesEl.setAttr("aria-label", hasDates(this.dates) ? `Dates: ${filtersText(this.dates)}` : "Dates: created or modified, recently or long ago");
    this.renderSelected();
    this.renderRefine(matches);
    this.groupsPane.render(this.groupsEl);
    this.renderTags();
    this.renderResults(matches);
    if (this.page === "tools") renderTools(this.pageEl, this.plugin);
    else this.pageEl.empty();
  }

  private chip(parent: HTMLElement, tag: string, extra = ""): HTMLElement {
    const el = parent.createDiv({ cls: "tag-everything-chip " + extra });
    el.dataset.tag = tag;
    paintTag(el, this.plugin.index.colorFor(tag));
    el.createSpan({ text: tag });
    markInherited(el, this.plugin.index, tag);
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

  /** "All", and, while there is a search, Selection with the number of items it finds (`matches`), then Tools. */
  private renderTabs(matches: string[] | null): void {
    const el = this.tabsEl;
    el.empty();
    const all = el.createDiv({ cls: "tag-everything-tab", text: "All", attr: { role: "tab", "aria-label": "Every group and tag", "aria-selected": String(!this.page) } });
    all.toggleClass("is-active", !this.page);
    clickable(all, () => this.showAll());
    // At the end of the strip: Selection (only while there is a search), Tools.
    const end = el.createDiv({ cls: "tag-everything-tabs-end" });
    const pageTab = (page: PanelPage, label: string, text: string, icon?: string): HTMLElement => {
      const active = this.page === page;
      const t = end.createDiv({ cls: `tag-everything-tab tag-everything-tab-${page}`, attr: { role: "tab", "aria-label": label, "aria-selected": String(active) } });
      if (icon) setIcon(t.createSpan({ cls: "tag-everything-tab-icon" }), icon);
      if (text) t.createSpan({ text });
      t.toggleClass("is-active", active);
      clickable(t, () => this.showPage(page));
      return t;
    };
    if (this.hasSearch()) {
      const n = matches?.length ?? 0;
      pageTab("selection", `The search and the ${plural(n, "item")} it finds`, "Selection").createSpan({ cls: "tag-everything-chip-count", text: String(n) });
    }
    pageTab("tools", "Tools: re-read tags, apply auto-tag rules, check names, review, rename", "", "wrench");
  }

  private renderSelected(): void {
    this.selectedEl.empty();
    const group = this.groups.find((g) => g.id === this.activeGroup);
    if (!group && !this.formula && !this.selected.length && !this.excluded.length && !hasDates(this.dates)) return;
    // A group search shows the group's card, as in All: its tags (inside its formula) with their counts, a
    // switched-off one dashed (a click switches it on again).
    if (group) this.groupsPane.renderGroup(this.selectedEl, group, true);
    const searchChip = (tag: string, negated: boolean): void => {
      if (negated) this.selectedEl.createSpan({ cls: "tag-everything-op", text: "NOT" });
      const el = this.chip(this.selectedEl, tag, negated ? "is-selected is-negated" : "is-selected");
      const x = el.createSpan({ cls: "tag-everything-chip-remove" });
      setIcon(x, "x");
      el.setAttr("aria-label", "Remove from the search (right-click: more)");
      clickable(el, () => this.setMode(tag, null));
      this.tagMenu(el, tag);
    };
    if (this.formula) {
      const el = this.selectedEl.createDiv({ cls: "tag-everything-chip is-selected tag-everything-formula-chip", attr: { "aria-label": "Remove from the search (Formula…: edit it)" } });
      setIcon(el.createSpan({ cls: "tag-everything-date-icon" }), "square-function");
      el.createSpan({ text: fx.formatFormula(this.formula) });
      setIcon(el.createSpan({ cls: "tag-everything-chip-remove" }), "x");
      clickable(el, () => {
        this.formula = null;
        this.stateChanged();
      });
    }
    for (const tag of this.selected) if (!group?.tags.includes(tag)) searchChip(tag, false);
    for (const tag of this.excluded) searchChip(tag, true);
    for (const field of DATE_FIELDS) {
      const range = this.dates[field];
      if (!range) continue;
      const el = this.selectedEl.createDiv({ cls: "tag-everything-chip is-selected tag-everything-date-chip", attr: { "aria-label": "Remove from the search (the calendar icon above: other dates)" } });
      el.dataset.date = field;
      setIcon(el.createSpan({ cls: "tag-everything-date-icon" }), "calendar");
      el.createSpan({ text: criterionText(field, range) });
      setIcon(el.createSpan({ cls: "tag-everything-chip-remove" }), "x");
      clickable(el, () => {
        const next = { ...this.dates };
        delete next[field];
        this.setDates(next);
      });
    }
    // The way to OR and parentheses: the search as a formula, in the group dialog (a group search edits its group).
    const actions = this.selectedEl.createDiv({ cls: "tag-everything-view-actions" });
    const button = (cls: string, icon: string, text: string, label: string, run: () => void): void => {
      const b = actions.createEl("button", { cls: `tag-everything-icon-button ${cls}`, attr: { "aria-label": label } });
      setIcon(b.createSpan({ cls: "tag-everything-button-icon" }), icon);
      b.createSpan({ text });
      b.addEventListener("click", run);
    };
    if (group) button("tag-everything-view-formula", "pencil", "Edit group", `Edit the group "${group.name}": its name and formula`, () => this.groupsPane.editGroup(group));
    else {
      button("tag-everything-view-formula", "square-function", "Formula…", "Edit this search as a formula (AND, OR, NOT, parentheses)", () =>
        this.groupsPane.editSearch(this.searchExpr(), (expr) => this.setSearchFormula(expr)),
      );
      button("tag-everything-view-save-group", "folder-plus", "Save as group", "Save this search as a group in All", () => this.groupsPane.newGroup(this.searchExpr(), true));
    }
    button("tag-everything-view-clear", "search-x", "Clear", "Clear the search", () => {
      this.resetSearch();
      this.dates = {};
      this.stateChanged();
    });
  }

  /**
   * The tag cloud of All: every tag with its count in the whole vault, whatever the search; the tags in the search stay
   * in place, marked (a click takes one out).
   */
  private renderTags(): void {
    this.tagsEl.empty();
    this.inheritedEl.empty();
    const index = this.plugin.index;
    const counts = index.counts();
    // The extension tags only with the option on (a tag in the search stays).
    const shown = this.tagShown();
    const entries: [string, number][] = [...counts].filter(([t]) => shown(t));
    const named = entries.filter(([t]) => !this.filter || t.toLowerCase().includes(this.filter));
    // The count range keeps All to the tags that matter; not while filtering by name (the tag looked for must show),
    // and a tag in the search always stays (a click takes it out).
    const range = countRangeOf(this.plugin.settings);
    const ranged = !this.filter && range.on;
    const kept = named
      .filter(([t, n]) => !ranged || inCountRange(n, range) || this.selected.includes(t) || this.excluded.includes(t))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // The tags only folders give (src/inherit.ts) go to the Inherited section, under the others.
    const rows = kept.filter(([t]) => !index.onlyInherited(t));
    const inherited = kept.filter(([t]) => index.onlyInherited(t));
    this.renderInherited(inherited);
    // the number of tags shown, of how many when the range hides some
    const hidden = named.filter(([t]) => !index.onlyInherited(t)).length - rows.length;
    this.tagsCountEl.setText(hidden ? `${rows.length} of ${plural(rows.length + hidden, "tag")}` : plural(rows.length, "tag"));
    this.tagsCountEl.setAttr("aria-label", hidden ? `${plural(hidden, "tag")} outside the range ${rangeText(range)}` : null);
    this.range.update(range);
    const ext = this.plugin.settings.panelExtensionTags;
    this.extToggleEl.toggleClass("is-active", ext);
    this.extToggleEl.setAttr("aria-label", ext ? "Extension tags shown (pdf, md…): click to hide them" : "Show the extension tags (pdf, md…)");
    if (!rows.length) {
      this.tagsEl.createDiv({
        cls: "tag-everything-view-empty",
        text: this.filter
          ? inherited.length
            ? `None of your own tags matches "${this.filter}": see Inherited below.`
            : `No tag matches "${this.filter}".`
          : hidden
              ? `No tag is used ${rangeText(range)} times. Change the numbers above, or click See all.`
              : "No tags yet. Right-click a file or folder → Edit tags.",
      });
      return;
    }
    this.cloud(this.tagsEl, rows);
  }

  /**
   * The Inherited section of All: the tags only folders give (their names, src/inherit.ts), as a cloud of their own
   * under the others, drawn as inherited. Hidden when there are none; its heading folds it (saved in the settings).
   */
  private renderInherited(rows: [string, number][]): void {
    const show = !this.page && rows.length > 0;
    const folded = this.plugin.settings.panelInheritedCollapsed;
    this.inheritedHeadEl.toggle(show);
    this.inheritedEl.toggle(show && !folded);
    if (!show) return;
    setIcon(this.inheritedFoldEl, folded ? "chevron-right" : "chevron-down");
    this.inheritedCountEl.setText(plural(rows.length, "tag"));
    this.inheritedHeadEl.setAttr("aria-label", `Tags your folders give (their names), never written. Click: ${folded ? "unfold" : "fold"}`);
    this.inheritedHeadEl.setAttr("aria-expanded", String(!folded));
    if (!folded) this.cloud(this.inheritedEl, rows);
  }

  /**
   * Whether the tag lists of the panel (All, Narrow) show a tag: with `panelExtensionTags` off, only the stored and
   * inherited ones (a tag that is only an extension is left out) and those in the search.
   */
  private tagShown(): (tag: string) => boolean {
    if (this.plugin.settings.panelExtensionTags) return () => true;
    const index = this.plugin.index;
    const own = index.counts(undefined, true);
    return (t) => own.has(t) || index.onlyInherited(t) || this.selected.includes(t) || this.excluded.includes(t);
  }

  /** In the Selection tab, above the results: the tags that can still narrow the search, counted in what it finds. */
  private renderRefine(matches: string[] | null): void {
    this.refineEl.empty();
    if (!matches) return;
    const group = this.groups.find((g) => g.id === this.activeGroup);
    // the active group's tags are already in the search bar, switched on or off
    const taken = [...this.selected, ...this.excluded, ...(group?.tags ?? [])];
    const shown = this.tagShown();
    const rows = narrowingTags(this.plugin.index.counts(matches), matches.length, taken).filter(([t]) => shown(t));
    if (!rows.length) return;
    const head = this.refineEl.createDiv({ cls: "tag-everything-section-head tag-everything-refine-head" });
    head.createSpan({ cls: "tag-everything-section-title", text: "Narrow" });
    head.createSpan({ cls: "tag-everything-section-count", text: `counted in the ${plural(matches.length, "item")}` });
    // one size: the counts already rank them, and a cloud's big chips crowd the results out
    this.cloud(this.refineEl.createDiv({ cls: "tag-everything-refine-chips" }), rows, false);
  }

  /**
   * Tag chips with their count, sized by use among `rows` unless `sized` is false: a click puts one in the search
   * (or takes it out).
   */
  private cloud(parent: HTMLElement, rows: [string, number][], sized = true): void {
    const weights = sized ? cloudWeights(rows) : new Map<string, number>();
    for (const [tag, n] of rows) {
      const on = this.selected.includes(tag);
      const not = this.excluded.includes(tag);
      const el = this.chip(parent, tag, [n ? "" : "is-missing", on || not ? "is-selected" : "", not ? "is-negated" : ""].join(" "));
      if (sized) el.setCssProps({ "--tag-everything-weight": String(weights.get(tag) ?? 0) });
      el.createSpan({ cls: "tag-everything-chip-count", text: String(n) });
      if (on || not) el.setAttr("aria-label", "In the search: click to take it out (right-click: more)");
      if (n || on || not) clickable(el, () => this.toggle(tag));
      else el.setAttr("aria-label", "No file or folder carries this tag (right-click: remove it from the tab)");
      this.tagMenu(el, tag);
    }
  }

  private renderResults(matches: string[] | null): void {
    this.resultsEl.empty();
    const index = this.plugin.index;
    const total = index.size;
    this.statusEl.toggleClass("tag-everything-section-head", !!matches);
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
    // a titled section, as Narrow above it
    this.statusEl.empty();
    this.statusEl.createSpan({ cls: "tag-everything-section-title", text: "Results" });
    this.statusEl.createSpan({ cls: "tag-everything-section-count", text: plural(items.length, "item") + (items.length > MAX_RESULTS ? `, first ${MAX_RESULTS} shown` : "") });

    if (!items.length) {
      this.resultsEl.createDiv({ cls: "tag-everything-view-empty", text: "Nothing matches this search: take a tag out above (its ×), or click Clear." });
      return;
    }
    const small = (t: string): string => "is-small" + (this.selected.includes(t) ? " is-selected" : "");
    for (const item of items.slice(0, MAX_RESULTS)) {
      const { row } = renderItemRow(this.resultsEl, item, index, (parent, t) => this.chip(parent, t, small(t)));
      wireItemRow(this.rowHost(), row, item); // open, preview, drag, file menu (src/items.ts)
    }
  }
}

/** The tag count range stored in the settings (src/cloud.ts). */
export function countRangeOf(s: TagEverythingSettings): CountRange {
  return { on: s.tagRangeOn, min: s.tagRangeMin, max: s.tagRangeMax };
}

/**
 * Sets the tag count range (panel and explorer boxes); with `save`, saves the settings, after which the panel and
 * the explorer redraw (index "changed") and their boxes show it.
 */
export function setCountRange(plugin: TagEverythingPlugin, r: CountRange, save: boolean): void {
  Object.assign(plugin.settings, { tagRangeOn: r.on, tagRangeMin: r.min, tagRangeMax: r.max });
  if (!save) return;
  plugin.saveSettings().catch((err) => {
    console.error("[tag-everything] saving the tag count range failed", err);
    new Notice("TagEverything: the tag count range could not be saved.");
  });
}
