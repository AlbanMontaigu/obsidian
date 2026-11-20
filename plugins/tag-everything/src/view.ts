import { AbstractInputSuggest, App, HoverParent, HoverPopover, ItemView, Keymap, Menu, Modal, Notice, TAbstractFile, TFile, TFolder, ViewStateResult, WorkspaceLeaf, setIcon } from "obsidian";
import * as ts from "./format.ts";
import { cloudWeights } from "./cloud.ts";
import * as gr from "./groups.ts";
import * as fx from "./formula.ts";
import { plural } from "./messages.ts";
import type TagEverythingPlugin from "./main.ts";

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

/** What the panel remembers across restarts (workspace.json). */
interface PanelState {
  selected: string[];
  activeGroup: string | null;
  filter: string;
}

/** A DOM node of any window: `instanceof Node` is false for a node of a pop-out window, which has its own `Node`. */
function isNode(target: EventTarget | null): target is Node {
  return !!target && typeof (target as Partial<Node>).nodeType === "number";
}

/** Makes `el` a button for the keyboard too: focusable, Enter / Space run `fn` like a click. */
function clickable(el: HTMLElement, fn: (evt: MouseEvent | KeyboardEvent) => void): void {
  el.tabIndex = 0;
  el.setAttr("role", "button");
  el.addEventListener("click", fn);
  el.addEventListener("keydown", (evt) => {
    if ((evt.key === "Enter" || evt.key === " ") && evt.target === el) {
      evt.preventDefault();
      fn(evt);
    }
  });
}

/**
 * Sidebar panel: tag groups, then every tag with its count; select tags (AND) to list the files and folders
 * carrying them. Selecting a group selects its tags; each can then be switched off and on again.
 */
export class TagEverythingView extends ItemView implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  private selected: string[] = [];
  /** Group whose tags make up the search, if the search started from a group. */
  private activeGroup: string | null = null;
  private filter = "";
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
    return "File tags";
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
    const state: PanelState = { selected: this.selected, activeGroup: this.activeGroup, filter: this.filter };
    return { ...super.getState(), ...state };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state && typeof state === "object" ? state : {}) as Partial<Record<keyof PanelState, unknown>>;
    if (Array.isArray(s.selected)) this.selected = s.selected.filter((t): t is string => typeof t === "string");
    if (typeof s.activeGroup === "string" || s.activeGroup === null) this.activeGroup = s.activeGroup;
    if (typeof s.filter === "string") this.filter = s.filter;
    if (this.searchEl) this.searchEl.value = this.filter;
    this.render();
    await super.setState(state, result);
  }

  /** Shows the items carrying `tag` (used by badge clicks). */
  selectOnly(tag: string): void {
    this.selected = [tag];
    this.activeGroup = null;
    this.render();
  }

  // ---- tag groups (stored in settings.groups, logic in src/groups.ts)

  private get groups(): gr.TagGroup[] {
    return this.plugin.settings.groups;
  }

  private async saveGroups(groups: gr.TagGroup[]): Promise<void> {
    this.plugin.settings.groups = groups;
    this.render();
    this.app.workspace.requestSaveLayout();
    try {
      await this.plugin.saveData(this.plugin.settings);
    } catch (err) {
      console.error("[tag-everything] saving tag groups failed", err);
      new Notice("File tags: the tag groups could not be saved.");
    }
  }

  /** Creates a group and returns its id (public for the smoke test). Throws on an empty name. */
  async createGroup(name: string, tags: readonly string[] = []): Promise<string> {
    const { groups, id } = gr.addGroup(this.groups, name, tags);
    await this.saveGroups(groups);
    return id;
  }

  async addToGroup(id: string, tags: readonly string[]): Promise<void> {
    await this.saveGroups(gr.addTagsToGroup(this.groups, id, tags));
  }

  /** Searches by every tag of the group still in use; on the active group, clears the search. */
  selectGroup(id: string): void {
    const group = this.groups.find((g) => g.id === id);
    if (!group || this.activeGroup === id) {
      this.activeGroup = null;
      this.selected = [];
    } else {
      const counts = this.plugin.index.counts();
      this.activeGroup = id;
      this.selected = group.tags.filter((t) => counts.has(t));
    }
    this.render();
    this.app.workspace.requestSaveLayout();
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

  /** The current search: the active group's formula without its switched-off tags, AND the other selected tags. */
  private searchExpr(): fx.Expr | null {
    const group = this.groups.find((g) => g.id === this.activeGroup);
    const on = (t: string): boolean => this.selected.includes(t);
    const groupPart = group ? gr.groupExpr(group) : null;
    return fx.andOf([
      groupPart && fx.prune(groupPart, on),
      ...this.selected.filter((t) => !group?.tags.includes(t)).map(fx.tagExpr),
    ]);
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
    new GroupNameModal(this.app, title, initial, done).open();
  }

  private newGroup(tags: readonly string[]): void {
    this.askGroupName("New tag group", "", async (name) => {
      await this.createGroup(name, tags);
    });
  }

  private groupMenu(group: gr.TagGroup, evt: MouseEvent): void {
    const menu = new Menu();
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
    menu.addItem((i) =>
      i
        .setTitle("Delete group (the tags stay on the files)")
        .setIcon("trash")
        .onClick(() => void this.saveGroups(gr.deleteGroup(this.groups, group.id))),
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
    const current = group.formula ?? (gr.groupExpr(group) ? fx.formatFormula(gr.groupExpr(group)!) : "");
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

  /** Draws a formula: chips (from `chip`) between AND / OR / NOT and the parentheses it needs. */
  private renderExpr(parent: HTMLElement, e: fx.Expr, chip: (parent: HTMLElement, tag: string) => void, outer: fx.Expr["k"] | null = null): void {
    const op = (text: string, cls = ""): void => void parent.createSpan({ cls: "tag-everything-op " + cls, text });
    if (e.k === "tag") return chip(parent, e.tag);
    if (e.k === "not") {
      op("NOT");
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

  private toggle(tag: string): void {
    this.selected = this.selected.includes(tag) ? this.selected.filter((t) => t !== tag) : [...this.selected, tag];
    this.render();
    this.app.workspace.requestSaveLayout(); // the selection is part of the panel's saved state
  }

  private render(): void {
    if (!this.tagsEl) return;
    const counts = this.plugin.index.counts();
    // Before the first scan the index is empty: keep a selection restored from the saved workspace.
    if (this.plugin.index.ready) this.selected = this.selected.filter((t) => counts.has(t));
    if (this.activeGroup && !this.groups.some((g) => g.id === this.activeGroup)) this.activeGroup = null;
    this.renderSelected();
    this.renderGroups();
    this.renderTags();
    this.renderResults();
  }

  private chip(parent: HTMLElement, tag: string, extra = ""): HTMLElement {
    const el = parent.createDiv({ cls: "tag-everything-chip " + extra });
    el.dataset.tag = tag;
    const color = this.plugin.index.colorFor(tag);
    if (color) el.setCssProps({ "--tag-everything-color": color });
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

  private renderSelected(): void {
    this.selectedEl.empty();
    const group = this.groups.find((g) => g.id === this.activeGroup);
    if (!group && !this.selected.length) return;
    const counts = this.plugin.index.counts();
    if (group) {
      const label = this.selectedEl.createDiv({ cls: "tag-everything-view-selected-group", attr: { "aria-label": "Search started from this group" } });
      setIcon(label.createSpan(), "layers");
      label.createSpan({ text: group.name });
      // The group's tags stay listed (inside its formula, if it has one): a switched-off one (dashed) can be
      // switched on again.
      const toggleChip = (parent: HTMLElement, tag: string): void => {
        const on = this.selected.includes(tag);
        const used = counts.has(tag);
        const el = this.chip(parent, tag, on ? "is-selected" : "is-off" + (used ? "" : " is-missing"));
        el.setAttr("aria-label", !used ? "No file or folder carries this tag" : on ? "Click to leave it out of the search" : "Click to search with it");
        if (used) clickable(el, () => this.toggle(tag));
      };
      const expr = group.formula && !gr.formulaError(group) ? gr.groupExpr(group) : null;
      if (expr) this.renderExpr(this.selectedEl.createDiv({ cls: "tag-everything-formula" }), expr, toggleChip);
      else for (const tag of group.tags) toggleChip(this.selectedEl, tag);
    }
    for (const tag of this.selected) {
      if (group?.tags.includes(tag)) continue;
      const el = this.chip(this.selectedEl, tag, "is-selected");
      const x = el.createSpan({ cls: "tag-everything-chip-remove" });
      setIcon(x, "x");
      el.setAttr("aria-label", "Remove from the search");
      clickable(el, () => this.toggle(tag));
    }
    const clear = this.selectedEl.createEl("button", { cls: "tag-everything-view-clear", text: "Clear" });
    clear.addEventListener("click", () => {
      this.selected = [];
      this.activeGroup = null;
      this.render();
      this.app.workspace.requestSaveLayout();
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
      attr: { "aria-label": "New group, with the selected tags (or drop a tag here)" },
    });
    setIcon(add, "plus");
    clickable(add, () => this.newGroup(this.selected));
    this.dropZone(add, (tag) => this.newGroup([tag]));

    if (!this.groups.length) {
      el.createDiv({ cls: "tag-everything-view-empty", text: "No groups yet. + creates one; drag tags onto a group to add them." });
      return;
    }

    for (const group of this.groups) {
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
      // Visible search button: the whole header searches too, but that was easy to miss.
      const find = header.createDiv({
        cls: "clickable-icon tag-everything-group-search",
        attr: { "aria-label": active ? "Clear the search" : `List the ${plural(n, "item")} this group finds` },
      });
      setIcon(find, active ? "search-x" : "search");
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
      const groupChip = (parent: HTMLElement, tag: string): void => {
        const c = counts.get(tag) ?? 0;
        const chip = this.chip(parent, tag, (this.selected.includes(tag) ? "is-selected" : "") + (c ? "" : " is-missing"));
        chip.createSpan({ cls: "tag-everything-chip-count", text: String(c) });
        const x = chip.createSpan({ cls: "tag-everything-chip-remove", attr: { "aria-label": "Remove from the group" } });
        setIcon(x, "x");
        x.addEventListener("click", (evt) => {
          evt.stopPropagation();
          void this.saveGroups(gr.removeTagFromGroup(this.groups, group.id, tag));
        });
        if (c) clickable(chip, () => this.toggle(tag));
        else chip.setAttr("aria-label", "No file or folder carries this tag");
      };
      const error = gr.formulaError(group);
      if (error) {
        const err = body.createDiv({ cls: "tag-everything-error", text: `Formula not understood (${error}): searching all the tags. ⋯ → Edit formula.` });
        err.setAttr("aria-label", group.formula ?? "");
      }
      const expr = group.formula && !error ? gr.groupExpr(group) : null;
      if (expr) this.renderExpr(body, expr, groupChip);
      else for (const tag of group.tags) groupChip(body, tag);
    }
  }

  private renderTags(): void {
    this.tagsEl.empty();
    const index = this.plugin.index;
    const search = this.searchExpr();
    const scope = search ? this.matchPaths(search) : undefined;
    const counts = index.counts(scope);
    const rows = [...counts]
      .filter(([t]) => !this.selected.includes(t) && (!this.filter || t.toLowerCase().includes(this.filter)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!rows.length) {
      this.tagsEl.createDiv({
        cls: "tag-everything-view-empty",
        text: !index.size
          ? "No tags yet. Right-click a file or folder → Edit tags."
          : this.filter
            ? `No tag matches "${this.filter}".`
            : "No other tag.",
      });
      return;
    }
    // Size by use, relative to the tags shown (so it adapts to the filter and the selection).
    const weights = cloudWeights(rows);
    for (const [tag, n] of rows) {
      const el = this.chip(this.tagsEl, tag);
      el.setCssProps({ "--tag-everything-weight": String(weights.get(tag) ?? 0) });
      el.createSpan({ cls: "tag-everything-chip-count", text: String(n) });
      clickable(el, () => this.toggle(tag));
    }
  }

  private renderResults(): void {
    this.resultsEl.empty();
    const index = this.plugin.index;
    const total = index.size;
    const search = this.searchExpr();
    if (!search) {
      this.statusEl.setText(
        this.activeGroup
          ? "No tag of this group is switched on: click one above."
          : `${plural(total, "tagged item")}. Select a tag or a group to list them.`,
      );
      return;
    }
    const vault = this.app.vault;
    const items = this
      .matchPaths(search)
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
      const file = item;
      const known = app.viewRegistry?.isExtensionRegistered?.(file.extension) ?? true;
      if (!known && app.openWithDefaultApp) app.openWithDefaultApp(file.path);
      else void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file);
    } catch (err) {
      console.error("[tag-everything] open failed", err);
    }
  }
}

/** Asks for a group name. If `done` throws (empty name), the message shows and the modal stays open. */
class GroupNameModal extends Modal {
  constructor(
    app: App,
    private heading: string,
    private initial: string,
    private done: (name: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tag-everything-group-modal");
    this.setTitle(this.heading);
    const input = this.contentEl.createEl("input", { type: "text", cls: "tag-everything-group-input", attr: { placeholder: "Group name" } });
    input.value = this.initial;
    const error = this.contentEl.createDiv({ cls: "tag-everything-error" });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const save = buttons.createEl("button", { cls: "mod-cta", text: "Save" });
    const submit = async (): Promise<void> => {
      try {
        await this.done(input.value);
        this.close();
      } catch (err) {
        error.setText((err as Error).message);
      }
    };
    save.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" || evt.defaultPrevented || evt.isComposing) return;
      evt.preventDefault();
      void submit();
    });
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Completes the tag being typed in a formula (the word before the caret). */
class FormulaTagSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private input: HTMLInputElement,
    private tags: readonly string[],
    private counts: ReadonlyMap<string, number>,
  ) {
    super(app, input);
  }

  private partial(): { start: number; word: string } {
    const caret = this.input.selectionStart ?? this.input.value.length;
    const before = this.input.value.slice(0, caret);
    const m = /[^\s()"!]*$/.exec(before)!;
    return { start: caret - m[0].length, word: m[0].replace(/^#/, "") };
  }

  protected getSuggestions(): string[] {
    const q = this.partial().word.toLowerCase();
    if (!q) return []; // nothing typed: Enter saves
    const hits = this.tags.filter((t) => t.toLowerCase().includes(q) && t.toLowerCase() !== q);
    return hits.sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q))).slice(0, 50);
  }

  renderSuggestion(tag: string, el: HTMLElement): void {
    el.addClass("tag-everything-suggestion");
    el.createSpan({ text: tag });
    el.createSpan({ cls: "tag-everything-suggestion-count", text: String(this.counts.get(tag) ?? 0) });
  }

  selectSuggestion(tag: string): void {
    const { start } = this.partial();
    const caret = this.input.selectionStart ?? this.input.value.length;
    const text = fx.formatFormula(fx.tagExpr(tag)) + " ";
    this.input.value = this.input.value.slice(0, start) + text + this.input.value.slice(caret);
    this.input.setSelectionRange(start + text.length, start + text.length);
    this.close();
    this.input.dispatchEvent(new Event("input")); // refreshes the preview
  }
}

/** Edits a group's formula, with a live check: syntax error, or how many items it finds. */
class FormulaModal extends Modal {
  constructor(
    app: App,
    private groupName: string,
    private initial: string,
    private tags: readonly string[],
    private counts: ReadonlyMap<string, number>,
    private countMatches: (expr: fx.Expr) => number,
    private done: (text: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tag-everything-formula-modal");
    this.setTitle(`Formula of "${this.groupName}"`);
    this.contentEl.createDiv({
      cls: "tag-everything-where",
      text:
        "Combine the tags with AND, OR, NOT (or ET, OU, NON) and parentheses, e.g. (B27 OR INC) AND (q3 OR 2026). " +
        "Two tags side by side = AND. Empty: all the group's tags (AND).",
    });
    const input = this.contentEl.createEl("input", { type: "text", cls: "tag-everything-formula-input", attr: { placeholder: "(tag1 OR tag2) AND tag3", spellcheck: "false" } });
    input.value = this.initial;
    const preview = this.contentEl.createDiv({ cls: "tag-everything-formula-preview" });
    const error = this.contentEl.createDiv({ cls: "tag-everything-error" });
    new FormulaTagSuggest(this.app, input, this.tags, this.counts);

    const update = (): void => {
      preview.empty();
      error.setText("");
      if (!input.value.trim()) {
        preview.setText("No formula: the group searches for all its tags.");
        return;
      }
      const r = fx.tryParseFormula(input.value);
      if ("error" in r) {
        error.setText(r.error);
        return;
      }
      const expr = fx.resolveTags(r.expr, this.tags);
      const n = this.countMatches(expr);
      preview.createDiv({ text: `${fx.formatFormula(expr)}  →  ${plural(n, "item")}` });
      const unknown = fx.formulaTags(expr).filter((t) => !this.counts.has(t));
      if (unknown.length) preview.createDiv({ cls: "tag-everything-formula-unknown", text: `No item carries ${unknown.join(", ")} (left out of the search).` });
    };
    input.addEventListener("input", update);
    update();

    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const save = buttons.createEl("button", { cls: "mod-cta", text: "Save" });
    const submit = async (): Promise<void> => {
      try {
        await this.done(input.value);
        this.close();
      } catch (err) {
        error.setText((err as Error).message);
      }
    };
    save.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" || evt.defaultPrevented || evt.isComposing) return;
      evt.preventDefault();
      void submit();
    });
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
