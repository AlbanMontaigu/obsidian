// The tag groups of the TagEverything panel (src/view.ts): the Groups area of All (the groups in no section, then the
// sections with their groups and tags), their menus, the group dialog, and the operations that change them (stored in
// settings.groups and settings.tabs, pure logic in src/groups.ts and src/sections.ts). The search itself (selected
// tags, the active group) stays in the view, reached through `GroupsHost`.

import { type App, Menu, setIcon } from "obsidian";
import * as gr from "./groups.ts";
import * as fx from "./formula.ts";
import * as sc from "./sections.ts";
import { plural } from "./messages.ts";
import type TagEverythingPlugin from "./main.ts";
import type { TagEverythingSettings } from "./config.ts";
import { type FormulaContext, GroupModal, NameModal } from "./dialogs.ts";
import { GROUP_MIME, clickable, dateChip, dropZone, renderExpr } from "./ui.ts";
import { missingTagLabel } from "./archive.ts";

/** What the groups need from the panel: its search, its chips and menus, and saving. */
export interface GroupsHost {
  readonly app: App;
  readonly plugin: TagEverythingPlugin;
  /** The group whose search runs; null when none. */
  activeGroup(): string | null;
  /** The tags switched on in the search. */
  selected(): readonly string[];
  /** Puts tags in the search, switched on (new tags of the active group's formula); the next render shows them. */
  addToSearch(tags: readonly string[]): void;
  /** The current search as a formula (a new group starts from it). */
  searchExpr(): fx.Expr | null;
  /** Searches with the group (on the active group: stops the search). */
  selectGroup(id: string): void;
  /** Opens the Selection tab. */
  showSelection(): void;
  /** Saves groups and sections, and redraws the panel. */
  save(change: Partial<Pick<TagEverythingSettings, "groups" | "tabs">>): Promise<void>;
  /** A draggable tag chip of the panel. */
  chip(parent: HTMLElement, tag: string, extra: string): HTMLElement;
  /** The tags as the Tags list draws them (count, click to search, right-click menu), all the same size. */
  tagChips(parent: HTMLElement, tags: readonly string[]): void;
  /** Puts the tag in the search, or takes it out. */
  toggle(tag: string): void;
  /** Menu items moving a tag or group into a section, out of it, or into a new one. */
  sectionItems(menu: Menu, kind: sc.SectionKind, value: string): void;
  /** Asks a name, then creates a section holding these tags and groups. */
  newSection(tags?: readonly string[], groups?: readonly string[]): void;
  /** Tagged paths matching `expr` (tags no item carries left out). */
  matchPaths(expr: fx.Expr | null): string[];
}

export class PanelGroups {
  constructor(private host: GroupsHost) {}

  private get groups(): gr.TagGroup[] {
    return this.host.plugin.settings.groups;
  }

  private get sections(): sc.Section[] {
    return this.host.plugin.settings.tabs;
  }

  private async saveGroups(groups: gr.TagGroup[]): Promise<void> {
    await this.host.save({ groups });
  }

  /**
   * Creates a group and returns its id. Tags in `excluded` make it a formula: `tags AND NOT excluded`. Throws on an
   * empty name.
   */
  async createGroup(name: string, tags: readonly string[] = [], excluded: readonly string[] = []): Promise<string> {
    return this.createGroupFrom(name, fx.andOf([...tags.map(fx.tagExpr), ...excluded.map((t) => fx.notExpr(fx.tagExpr(t)))]));
  }

  /** Creates a group searching for `expr` (null: an empty group), in no section; or in `section`. */
  private async createGroupFrom(name: string, expr: fx.Expr | null, section: string | null = null): Promise<string> {
    const { groups, id } = gr.addGroup(this.groups, name);
    await this.host.save({ groups: gr.setFormula(groups, id, expr), tabs: section ? sc.moveToSection(this.sections, section, "groups", id) : this.sections });
    return id;
  }

  private deleteGroup(id: string): void {
    void this.host.save({ groups: gr.deleteGroup(this.groups, id), tabs: sc.forgetGroup(this.sections, id) });
  }

  async addToGroup(id: string, tags: readonly string[]): Promise<void> {
    await this.saveGroups(gr.addTagsToGroup(this.groups, id, tags));
  }

  /**
   * Sets what the group searches for from a formula's text: tags are matched to the vault's spelling, an empty text
   * empties the group. Throws on a syntax error.
   */
  async setGroupFormula(id: string, text: string): Promise<void> {
    await this.saveGroups(this.withFormula(this.groups, id, this.parseFormula(text)));
  }

  /** A formula typed by the user, tags matched to the vault's spelling; null when empty. Throws on a syntax error. */
  private parseFormula(text: string): fx.Expr | null {
    return text.trim() ? fx.resolveTags(fx.parseFormula(text), [...this.host.plugin.index.counts().keys()]) : null;
  }

  /** `groups` with group `id` searching for `expr`; on the active group, its new tags join the search switched on. */
  private withFormula(groups: gr.TagGroup[], id: string, expr: fx.Expr | null): gr.TagGroup[] {
    const before = groups.find((g) => g.id === id);
    if (this.host.activeGroup() === id && expr) {
      const counts = this.host.plugin.index.counts();
      const selected = this.host.selected();
      this.host.addToSearch(fx.formulaTags(expr).filter((t) => !before?.tags.includes(t) && counts.has(t) && !selected.includes(t)));
    }
    return gr.setFormula(groups, id, expr);
  }

  /** The group dialog's view of the vault: tags, counts, and how many items a formula finds. */
  private formulaContext(): FormulaContext {
    const index = this.host.plugin.index;
    const counts = index.visibleCounts(); // as the cloud and the results: archived items only while shown
    return { tags: index.ranked(), counts, countMatches: (expr) => this.host.matchPaths(fx.resolveTags(expr, [...index.counts().keys()])).length };
  }

  /**
   * New group: a name and what it searches for, starting from `expr` (the current search, a dropped tag). With `run`
   * (from the Selection tab), the search becomes the new group's, so its formula's results show at once.
   */
  newGroup(expr: fx.Expr | null, run = false, section: sc.Section | null = null): void {
    const heading = run ? "new group from this search" : section ? `new group in "${section.name}"` : "new group";
    new GroupModal(this.host.app, heading, "", expr ? fx.formatFormula(expr) : "", this.formulaContext(), async (name, text) => {
      const id = await this.createGroupFrom(name, this.parseFormula(text), section?.id ?? null);
      if (run) this.host.selectGroup(id);
    }).open();
  }

  /** Formula… in the Selection tab: the search as a formula, edited, then `run` (nothing is saved; an empty one: null). */
  editSearch(expr: fx.Expr | null, run: (expr: fx.Expr | null) => void): void {
    new GroupModal(this.host.app, "search formula", null, expr ? fx.formatFormula(expr) : "", this.formulaContext(), async (_name, text) => {
      run(this.parseFormula(text)); // a syntax error throws first: the dialog stays open
    }).open();
  }

  /** Edits a group's name and formula in one dialog. */
  editGroup(group: gr.TagGroup): void {
    const expr = gr.groupExpr(group);
    const current = group.formula ?? (expr ? fx.formatFormula(expr) : "");
    new GroupModal(this.host.app, `edit group "${group.name}"`, group.name, current, this.formulaContext(), async (name, text) => {
      const parsed = this.parseFormula(text); // first: a syntax error keeps the dialog open, nothing saved
      await this.saveGroups(this.withFormula(gr.renameGroup(this.groups, group.id, name), group.id, parsed));
    }).open();
  }

  /** The group menu; `inSelection`: opened in the Selection tab, so no "Show in Selection". */
  private menu(group: gr.TagGroup, evt: MouseEvent, inSelection = false): void {
    const host = this.host;
    const menu = new Menu();
    const active = host.activeGroup() === group.id;
    const n = host.matchPaths(gr.groupExpr(group)).length;
    if (active && !inSelection) menu.addItem((i) => i.setTitle(`Show in Selection (${plural(n, "item")})`).setIcon("arrow-right").onClick(() => host.showSelection()));
    menu.addItem((i) =>
      i
        .setTitle(active ? "Stop the search" : `Search with this group (${plural(n, "item")})`)
        .setIcon(active ? "search-x" : "search")
        .onClick(() => host.selectGroup(group.id)),
    );
    menu.addItem((i) =>
      i
        .setTitle("Edit name and formula (AND, OR, NOT)…")
        .setIcon("pencil")
        .onClick(() => this.editGroup(group)),
    );
    const extra = host.selected().filter((t) => !group.tags.includes(t));
    if (extra.length) {
      menu.addItem((i) =>
        i
          .setTitle(`Add the selected tags (${extra.length})`)
          .setIcon("plus")
          .onClick(() => void this.addToGroup(group.id, extra)),
      );
    }
    if (!inSelection) host.sectionItems(menu, "groups", group.id);
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
  private menuAt(group: gr.TagGroup, el: HTMLElement, inSelection = false): void {
    const r = el.getBoundingClientRect();
    this.menu(group, new MouseEvent("contextmenu", { clientX: r.left, clientY: r.bottom }), inSelection);
  }

  /** The Groups area of All, drawn into `el`: the groups in no section, then each section with its groups and tags. */
  render(el: HTMLElement): void {
    const host = this.host;
    el.empty();

    const head = el.createDiv({ cls: "tag-everything-section-head" });
    head.createSpan({ cls: "tag-everything-section-title", text: "Groups" });
    const add = head.createDiv({
      cls: "clickable-icon tag-everything-group-add",
      attr: { "aria-label": "New group: a name and the tags it searches for, with AND, OR, NOT (or drop a tag here)" },
    });
    setIcon(add, "plus");
    clickable(add, () => this.newGroup(host.searchExpr()));
    dropZone(add, (tag) => this.newGroup(fx.tagExpr(tag)));
    const addSection = head.createDiv({
      cls: "clickable-icon tag-everything-section-add",
      attr: { "aria-label": "New section: a heading to sort groups and tags under (or drop a tag or group here)" },
    });
    setIcon(addSection, "folder-plus");
    clickable(addSection, () => host.newSection());
    dropZone(
      addSection,
      (tag) => host.newSection([tag]),
      (group) => host.newSection([], [group]),
    );

    const inSection = new Set(this.sections.flatMap((s) => s.groups));
    const loose = this.groups.filter((g) => !inSection.has(g.id));
    if (!this.groups.length && !this.sections.length) {
      el.createDiv({
        cls: "tag-everything-view-empty",
        text: "No groups yet. + creates one: a name and the tags it searches for, joined with AND, OR, NOT. Drag tags onto a group to add them; its Search button lists what it finds.",
      });
      return;
    }
    for (const group of loose) this.renderGroup(el, group);
    for (const section of this.sections) this.renderSection(el, section);
  }

  /**
   * A section: a foldable heading (name, what it holds, ⋯: new group in it, rename, delete), then its groups, in the
   * panel's group order, and its tags. A tag or group dropped on it moves in.
   */
  private renderSection(el: HTMLElement, section: sc.Section): void {
    const host = this.host;
    const box = el.createDiv({ cls: "tag-everything-panel-section", attr: { "data-section": section.id } });
    box.toggleClass("is-collapsed", !!section.collapsed);
    const header = box.createDiv({ cls: "tag-everything-panel-section-head" });
    const fold = header.createDiv({ cls: "tag-everything-group-fold", attr: { "aria-label": section.collapsed ? "Unfold" : "Fold" } });
    setIcon(fold, "chevron-down");
    const toggleFold = (): void => void host.save({ tabs: sc.setSectionCollapsed(this.sections, section.id, !section.collapsed) });
    header.createSpan({ cls: "tag-everything-panel-section-name", text: section.name });
    header.createSpan({ cls: "tag-everything-section-count", text: [plural(section.groups.length, "group"), plural(section.tags.length, "tag")].join(", ") });
    clickable(header, toggleFold);
    header.setAttr("aria-label", `${section.collapsed ? "Unfold" : "Fold"}. Drop a tag or group here to move it in; right-click: new group, rename, delete`);
    const more = header.createDiv({ cls: "clickable-icon tag-everything-group-more", attr: { "aria-label": "Section options" } });
    setIcon(more, "more-horizontal");
    const menu = (evt: MouseEvent): void => this.sectionMenu(section, evt);
    clickable(more, (evt) => {
      evt.stopPropagation();
      if (evt.instanceOf(MouseEvent)) menu(evt);
      else {
        const r = more.getBoundingClientRect();
        menu(new MouseEvent("contextmenu", { clientX: r.left, clientY: r.bottom }));
      }
    });
    header.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      menu(evt);
    });
    const move = (kind: sc.SectionKind) => (value: string) => void host.save({ tabs: sc.moveToSection(this.sections, section.id, kind, value) });
    dropZone(box, move("tags"), move("groups"));
    if (section.collapsed) return;

    const body = box.createDiv({ cls: "tag-everything-panel-section-body" });
    const groups = this.groups.filter((g) => section.groups.includes(g.id));
    for (const group of groups) this.renderGroup(body, group);
    if (section.tags.length) host.tagChips(body.createDiv({ cls: "tag-everything-panel-section-tags" }), section.tags);
    if (!groups.length && !section.tags.length) body.createDiv({ cls: "tag-everything-view-empty", text: "Empty: drop a tag or group here, or right-click one → Move to the section." });
  }

  private sectionMenu(section: sc.Section, evt: MouseEvent): void {
    const host = this.host;
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("New group in this section…").setIcon("plus").onClick(() => this.newGroup(null, false, section)));
    menu.addItem((i) =>
      i
        .setTitle("Rename section")
        .setIcon("pencil")
        .onClick(() => new NameModal(host.app, "rename section", section.name, "Section name", (name) => host.save({ tabs: sc.renameSection(this.sections, section.id, name) })).open()),
    );
    menu.addItem((i) =>
      i
        .setTitle("Delete section (its groups and tags stay)")
        .setIcon("trash")
        .onClick(() => void host.save({ tabs: sc.deleteSection(this.sections, section.id) })),
    );
    menu.showAtMouseEvent(evt);
  }

  /**
   * A group's card: a header (fold, name, formula icon, search button, ⋯) above its chips, each with its vault count.
   * The Selection tab draws the group searching with it too (`inSelection`): no fold and no search button there (its
   * results are below it), and the header does nothing on click. On the group searching, a tag switched off is
   * dashed; a click on a chip switches it on or off.
   */
  renderGroup(el: HTMLElement, group: gr.TagGroup, inSelection = false): void {
    const host = this.host;
    const counts = host.plugin.index.visibleCounts(); // what a click on the group finds
    const active = host.activeGroup() === group.id;
    const collapsed = group.collapsed && !inSelection;
    const box = el.createDiv({ cls: "tag-everything-group", attr: { "data-group": group.id } });
    box.toggleClass("is-collapsed", collapsed);
    box.toggleClass("is-active", active);

    const header = box.createDiv({ cls: "tag-everything-group-header" });
    header.draggable = true; // drop a group on another to reorder (and join its section), or on a section
    header.addEventListener("dragstart", (evt) => {
      if (!evt.dataTransfer) return;
      evt.dataTransfer.setData(GROUP_MIME, group.id);
      evt.dataTransfer.effectAllowed = "move";
    });

    if (!inSelection) {
      const fold = header.createDiv({ cls: "tag-everything-group-fold", attr: { "aria-label": group.collapsed ? "Unfold" : "Fold" } });
      setIcon(fold, "chevron-down");
      clickable(fold, (evt) => {
        evt.stopPropagation();
        void this.saveGroups(gr.setCollapsed(this.groups, group.id, !group.collapsed));
      });
    }

    header.createSpan({ cls: "tag-everything-group-name", text: group.name });
    if (group.formula) {
      const fxIcon = header.createSpan({ cls: "tag-everything-group-formula-icon", attr: { "aria-label": `Formula: ${group.formula} (click to edit)` } });
      setIcon(fxIcon, "square-function");
      clickable(fxIcon, (evt) => {
        evt.stopPropagation();
        this.editGroup(group);
      });
    }
    if (inSelection) header.setAttr("aria-label", "The search runs this group (⋯: its options)");
    else {
      // Labelled search button: the whole header searches too, but an icon alone was easy to miss. On the group
      // searching it leads to the Selection tab, where its results are; stopping is in ⋯ (and Clear there).
      const n = host.matchPaths(gr.groupExpr(group)).length;
      const open = (): void => (active ? host.showSelection() : host.selectGroup(group.id));
      const find = header.createDiv({
        cls: "tag-everything-group-search",
        attr: {
          "aria-label": active
            ? `Show the ${plural(n, "item")} it finds in the Selection tab (⋯ → Stop the search to clear it)`
            : `Search with the whole group: lists the ${plural(n, "item")} it finds`,
        },
      });
      setIcon(find.createSpan({ cls: "tag-everything-group-search-icon" }), active ? "arrow-right" : "search");
      find.createSpan({ cls: "tag-everything-group-search-label", text: active ? "Selection" : "Search" });
      find.createSpan({ cls: "tag-everything-chip-count", text: String(n) });
      clickable(find, (evt) => {
        evt.stopPropagation();
        open();
      });
      clickable(header, open);
      header.setAttr("aria-label", active ? "Click to show its results in the Selection tab" : "Click to search with this group");
    }
    const more = header.createDiv({ cls: "clickable-icon tag-everything-group-more", attr: { "aria-label": "Group options" } });
    setIcon(more, "more-horizontal");
    clickable(more, (evt) => {
      evt.stopPropagation();
      if (evt.instanceOf(MouseEvent)) this.menu(group, evt, inSelection);
      else this.menuAt(group, more, inSelection);
    });
    header.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      this.menu(group, evt, inSelection);
    });

    dropZone(
      box,
      (tag) => void this.addToGroup(group.id, [tag]),
      // placed before it, and in its section (or out of any, at the top)
      (moved) => void host.save({ groups: gr.moveGroup(this.groups, moved, group.id), tabs: sc.moveToSection(this.sections, sc.sectionOf(this.sections, "groups", group.id)?.id ?? null, "groups", moved) }),
    );

    if (collapsed) return;
    const body = box.createDiv({ cls: "tag-everything-group-tags" });
    const expr = gr.groupFormula(group);
    if (!group.tags.length && !expr) body.createDiv({ cls: "tag-everything-view-empty", text: "Drag tags here." });
    const groupChip = (parent: HTMLElement, tag: string, negated: boolean): void => {
      const c = counts.get(tag) ?? 0;
      const on = host.selected().includes(tag);
      const state = on ? "is-selected" : active ? "is-off" : "";
      const chip = host.chip(parent, tag, state + (c ? "" : " is-missing") + (negated ? " is-negated" : ""));
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
      if (!c) chip.setAttr("aria-label", missingTagLabel(host.plugin.index.counts().has(tag)));
      else {
        clickable(chip, () => host.toggle(tag));
        if (active) chip.setAttr("aria-label", on ? "Click to leave it out of the search" : "Click to search with it");
      }
    };
    const error = gr.formulaError(group);
    if (error) {
      const err = body.createDiv({ cls: "tag-everything-error", text: `Formula not understood (${error}): searching all the tags. ⋯ → Edit name and formula.` });
      err.setAttr("aria-label", group.formula ?? "");
    }
    // A date term (created:30d): its × takes it out of the group's formula.
    const groupDate = (parent: HTMLElement, term: fx.DateExpr, negated: boolean): HTMLElement => {
      const chip = dateChip(parent, term, negated);
      const x = chip.createSpan({ cls: "tag-everything-chip-remove", attr: { "aria-label": "Remove from the group" } });
      setIcon(x, "x");
      x.addEventListener("click", (evt) => {
        evt.stopPropagation();
        void this.saveGroups(gr.removeDateFromGroup(this.groups, group.id, term));
      });
      return chip;
    };
    if (expr) renderExpr(body, expr, groupChip, groupDate);
    else for (const tag of group.tags) groupChip(body, tag, false);
  }
}
