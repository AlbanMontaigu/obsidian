import { HoverParent, HoverPopover, ItemView, Menu, TAbstractFile, TFile, TFolder, ViewStateResult, WorkspaceLeaf, debounce, setIcon, setTooltip } from "obsidian";
import { compareItems, joinFormula, tagNode, treeSearch } from "./explore.ts";
import { FormulaTagSuggest } from "./dialogs.ts";
import { type Expr, evaluate, formatFormula, formulaTags, prune, requiredTags, resolveTags, tryParseFormula } from "./formula.ts";
import { PLUGIN_NAME, plural } from "./messages.ts";
import type TagEverythingPlugin from "./main.ts";
import { MAX_RESULTS, countRangeOf, setCountRange } from "./view.ts";
import { inCountRange } from "./cloud.ts";
import { type RowHost, revealInExplorer, wireItemRow } from "./items.ts";
import { type CountRangeControl, clickable, countRangeControl, onEnter, paintTag, renderExpr } from "./ui.ts";
import { InboxPane } from "./inbox-pane.ts";

export const EXPLORER_VIEW_TYPE = "tag-everything-explorer";

/** The explorer's icon (tab, ribbon), registered with `addIcon` by main.ts. */
export const EXPLORER_ICON = "tag-everything-tag-tree";

/**
 * Lucide's `folder-tree` drawn with tags in place of the folders, same 24-unit grid and stroke as Obsidian's icons. A
 * whole `<svg>` with its own viewBox, so it scales whether Obsidian wraps it in its 100-unit box or uses it as is.
 */
export const EXPLORER_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100" height="100" fill="none" stroke="currentColor" ' +
  'stroke-linecap="round" stroke-linejoin="round" style="stroke-width: var(--icon-stroke, 2)">' +
  '<path d="M3 3v13a2 2 0 0 0 2 2h3"/><path d="M3 5a2 2 0 0 0 2 2h3"/>' +
  '<path d="M12 4.5h8a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-8L10 7Z"/><circle cx="13" cy="7" r="0.6"/>' +
  '<path d="M12 15.5h8a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-8L10 18Z"/><circle cx="13" cy="18" r="0.6"/>' +
  "</svg>";

/** The explorer's two tabs: the tag tree, the inbox. */
export type ExplorerTab = "tags" | "inbox";

/** What the explorer remembers across restarts (workspace.json): the open tag nodes, each as its trail of tags, and the tab shown. */
interface ExplorerState {
  expanded: string[][];
  tab: ExplorerTab;
}

/** A node's key in `expanded`: its trail, joined by a character no tag holds. */
const keyOf = (trail: readonly string[]): string => trail.join("\u001f");

/**
 * The TagEverything explorer (left sidebar): the vault as a tree of tags. At the root every tag; inside a tag, the
 * tags that tell its items apart (opening the same way), then its items: those no branch leads to, and those alone
 * under one of their tags, shown directly rather than one level deeper (src/explore.ts `tagNode`). Stored tags only: extension
 * tags are on every file, so they are the chip before a name, not a branch. Every file of the vault can show,
 * including those the core explorer hides (*Detect all file extensions* off). The file open in the editor is
 * highlighted wherever it shows. The box at the top takes a formula (the panel's syntax, tags completed as typed, a
 * picked tag becomes a chip with a ×): the tree then holds only the matching items. A second tab, Inbox, holds the
 * inbox (untagged files arrived lately, with their rule tags and actions), drawn by its own src/inbox-pane.ts `InboxPane`.
 */
export class TagExplorerView extends ItemView implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  /** Open tag nodes, by `keyOf(trail)`. */
  private expanded = new Map<string, string[]>();
  /** The tab shown. */
  private tab: ExplorerTab = "tags";
  /** The Inbox tab's content (public for the smoke test). */
  readonly inbox: InboxPane;
  /** The file open in the editor: highlighted. */
  private activePath: string | null = null;
  /**
   * The formula box (not saved: a quick search): `chips`, the formula already turned into chips (a tag picked, Enter),
   * then `query`, the text being typed after them (src/explore.ts `joinFormula`).
   */
  private chips: Expr | null = null;
  private query = "";
  /** The box's last valid formula (kept while it holds a syntax error) and the formula applied at the last render. */
  private parsed: Expr | null = null;
  private applied: Expr | null = null;
  private tabsEl!: HTMLElement;
  private barEl!: HTMLElement;
  private pageEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private inputEl!: HTMLInputElement;
  private statusEl!: HTMLElement;
  private treeEl!: HTMLElement;
  /** Under the search box: the tag count range, shared with the panel's All tab (src/ui.ts `countRangeControl`). */
  private range!: CountRangeControl;
  /** Vault events come in bursts (a folder moved, a sync): one redraw once they stop. */
  private requestRender = debounce(() => this.render(), 100, true);

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: TagEverythingPlugin,
  ) {
    super(leaf);
    this.inbox = new InboxPane(plugin, this.rowHost(), () => this.render());
  }

  getViewType(): string {
    return EXPLORER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return `${PLUGIN_NAME} explorer`;
  }

  /** What its file rows need for the file menu and the page preview (src/items.ts). */
  private rowHost(): RowHost {
    return { app: this.app, source: EXPLORER_VIEW_TYPE, hoverParent: this, leaf: this.leaf };
  }

  getIcon(): string {
    return EXPLORER_ICON;
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("tag-everything-explorer");

    this.tabsEl = root.createDiv({ cls: "tag-everything-tabs tag-everything-explorer-tabs", attr: { role: "tablist" } });
    const bar = (this.barEl = root.createDiv({ cls: "tag-everything-explorer-bar" }));
    // looks like one input: the chips, then the text being typed
    const box = bar.createDiv({ cls: "tag-everything-explorer-search" });
    this.chipsEl = box.createDiv({ cls: "tag-everything-formula" });
    const search = (this.inputEl = box.createEl("input", {
      type: "text",
      cls: "tag-everything-explorer-input",
      attr: {
        "aria-label": "Show only the items matching a formula: tags with AND, OR, NOT and parentheses. Enter opens the tags it requires, Escape clears",
        spellcheck: "false",
      },
    }));
    box.addEventListener("click", (evt) => {
      if (evt.target === box) search.focus();
    });
    const index = this.plugin.index;
    new FormulaTagSuggest(this.app, search, () => index.ranked(), (t) => index.counts().get(t) ?? 0, () => this.commit());
    search.addEventListener("input", () => {
      this.query = search.value;
      this.render();
    });
    onEnter(search, () => {
      this.commit();
      this.openRequired();
    });
    search.addEventListener("keydown", (evt) => {
      if (evt.defaultPrevented || evt.isComposing) return; // an open suggestion list takes Escape first
      if (evt.key === "Backspace" && !search.value && this.chips) {
        evt.preventDefault();
        this.removeChip(formulaTags(this.chips).pop()!);
      } else if (evt.key === "Escape" && (search.value || this.chips)) {
        evt.preventDefault();
        evt.stopPropagation();
        this.chips = this.parsed = null;
        search.value = this.query = "";
        this.render();
      }
    });
    const collapse = bar.createDiv({ cls: "clickable-icon tag-everything-explorer-collapse", attr: { "aria-label": "Close every tag" } });
    setIcon(collapse, "chevrons-down-up");
    clickable(collapse, () => {
      this.expanded.clear();
      this.stateChanged();
    });
    this.range = countRangeControl(root.createDiv({ cls: "tag-everything-explorer-range" }), countRangeOf(this.plugin.settings), (r, save) => {
      setCountRange(this.plugin, r, save);
      if (!save) this.render(); // saved: every view redraws (index "changed")
    });
    this.statusEl = root.createDiv({ cls: "tag-everything-explorer-status" });
    this.treeEl = root.createDiv({ cls: "tag-everything-explorer-tree" });
    this.pageEl = root.createDiv({ cls: "tag-everything-explorer-page" });

    const redraw = (): void => void this.requestRender();
    this.registerEvent(this.plugin.index.on("changed", redraw));
    this.registerEvent(this.app.vault.on("create", redraw));
    this.registerEvent(this.app.vault.on("delete", redraw));
    this.registerEvent(this.app.vault.on("rename", redraw));
    this.registerEvent(this.app.workspace.on("file-open", (file) => this.highlight(file?.path ?? null)));
    this.activePath = this.app.workspace.getActiveFile()?.path ?? null;
    this.render();
  }

  async onClose(): Promise<void> {
    this.requestRender.cancel();
    this.contentEl.empty();
  }

  getState(): Record<string, unknown> {
    const state: ExplorerState = { expanded: [...this.expanded.values()], tab: this.tab };
    return { ...super.getState(), ...state };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const s = (state && typeof state === "object" ? state : {}) as Partial<Record<keyof ExplorerState, unknown>>;
    if (Array.isArray(s.expanded)) {
      this.expanded.clear();
      for (const t of s.expanded) {
        if (!Array.isArray(t)) continue;
        const trail = t.filter((x): x is string => typeof x === "string");
        if (trail.length) this.expanded.set(keyOf(trail), trail);
      }
    }
    if (s.tab === "tags" || s.tab === "inbox") this.tab = s.tab;
    this.render();
    await super.setState(state, result);
  }

  /** Opens or closes the tag node at `trail` (public for the smoke test). */
  toggle(trail: readonly string[]): void {
    const key = keyOf(trail);
    if (!this.expanded.delete(key)) this.expanded.set(key, [...trail]);
    this.stateChanged();
  }

  /** Shows a tab: the tag tree or the inbox. */
  showTab(tab: ExplorerTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.contentEl.scrollTop = 0;
    this.stateChanged();
  }

  /** The formula the tree is filtered by, as text; null when none (the "Insert a tag query block" command starts from it). */
  currentFormula(): string | null {
    return this.applied ? formatFormula(this.applied) : null;
  }

  /** The box's text becomes chips, when the whole formula parses (a picked suggestion, Enter). */
  private commit(): void {
    if (!this.query.trim()) return;
    const r = tryParseFormula(joinFormula(this.chips, this.query));
    if ("error" in r) return;
    this.chips = resolveTags(r.expr, [...this.plugin.index.counts().keys()]);
    this.parsed = null;
    this.inputEl.value = this.query = "";
    this.render();
  }

  /** A chip's ×: the tag leaves the formula (its NOT with it, src/formula.ts `prune`). */
  private removeChip(tag: string): void {
    this.chips = this.chips && prune(this.chips, (t) => t !== tag);
    this.parsed = null;
    this.render();
    this.inputEl.focus();
  }

  /** Enter in the formula box: opens, one inside the other, the tags every matching item carries (`tax receipt`: tax › receipt). */
  private openRequired(): void {
    const own = this.plugin.index.counts(undefined, true);
    const trail = this.applied ? requiredTags(this.applied).filter((t) => own.has(t)) : [];
    for (let i = 1; i <= trail.length; i++) this.expanded.set(keyOf(trail.slice(0, i)), trail.slice(0, i));
    if (trail.length) this.stateChanged();
  }

  /** The editor opened another file: move the highlight (it may show in several places). */
  private highlight(path: string | null): void {
    this.activePath = path;
    for (const row of this.treeEl.querySelectorAll<HTMLElement>(".tag-everything-explorer-row[data-path]")) {
      row.toggleClass("is-active", row.dataset.path === path);
    }
  }

  private stateChanged(): void {
    this.render();
    this.app.workspace.requestSaveLayout();
  }

  // ---- rendering

  private render(): void {
    if (!this.treeEl) return;
    this.requestRender.cancel();
    const index = this.plugin.index;
    const scroll = this.contentEl.scrollTop; // a redraw after a tag change must not jump to the top
    const inbox = this.tab === "inbox";
    this.renderTabs();
    for (const el of [this.barEl, this.range.el.parentElement!, this.statusEl, this.treeEl]) el.toggle(!inbox);
    this.pageEl.toggle(inbox);
    this.treeEl.empty();
    this.pageEl.empty();
    if (inbox) {
      this.inbox.render(this.pageEl);
      this.contentEl.scrollTop = scroll;
      return;
    }
    this.renderChips();
    const search = treeSearch(joinFormula(this.chips, this.query), [...index.counts().keys()], this.parsed ?? this.chips);
    this.parsed = search.parsed;
    const expr = (this.applied = search.expr);
    const paths = expr ? index.paths().filter((p) => evaluate(expr, (t) => index.hasTag(p, t))) : index.paths();
    // The count range keeps the root to the tags that matter, as in the panel's All tab; not while a formula filters
    // the tree (its counts are within what it finds), and an open tag stays.
    const range = countRangeOf(this.plugin.settings);
    this.range.update(range);
    const keep = range.on && !expr ? (tag: string, n: number): boolean => inCountRange(n, range) || this.expanded.has(keyOf([tag])) : undefined;
    const root = this.renderNode(this.treeEl, [], paths, keep);
    const tagged = root.paths.filter((p) => index.ownTagsOf(p).length).length;
    const found = expr ? `${plural(tagged, "item")} ${tagged === 1 ? "matches" : "match"} ${formatFormula(expr)}` : null;
    const shown = keep ? root.tags.filter(([t, n]) => keep(t, n)).length : root.tags.length;
    const tagsText =
      shown < root.tags.length ? `${shown} of ${plural(root.tags.length, "tag")}${shown ? "" : " (none in the range: See all shows them)"}` : plural(root.tags.length, "tag");
    this.statusEl.setText(
      !index.ready
        ? "Reading tags…"
        : !index.counts(undefined, true).size
          ? "No tags yet. Right-click a file or folder → TagEverything → Edit tags."
          : [found ?? `${tagsText} on ${plural(tagged, "item")}`, search.problem].filter(Boolean).join(". "),
    );
    this.statusEl.toggleClass("mod-warning", !!search.problem);
    this.contentEl.scrollTop = scroll;
  }

  /** The box's chips, between their AND / OR / NOT, each with a × that removes it; a tag no item carries is faded. */
  private renderChips(): void {
    const index = this.plugin.index;
    const counts = index.counts();
    this.chipsEl.empty();
    this.inputEl.placeholder = this.chips ? "" : "Search: tag1 OR tag2…";
    if (!this.chips) return;
    renderExpr(this.chipsEl, this.chips, (parent, tag, negated) => {
      const chip = parent.createDiv({ cls: "tag-everything-chip is-small is-selected" + (negated ? " is-negated" : "") + (counts.has(tag) ? "" : " is-missing") });
      chip.dataset.tag = tag;
      paintTag(chip, index.colorFor(tag));
      chip.createSpan({ text: tag });
      const x = chip.createSpan({ cls: "tag-everything-chip-remove", attr: { "aria-label": `Remove ${tag} from the search` } });
      setIcon(x, "x");
      clickable(x, () => this.removeChip(tag));
    });
  }

  /** The tab strip: Tags, then Inbox with the number of files waiting. */
  private renderTabs(): void {
    this.tabsEl.empty();
    const tabEl = (tab: ExplorerTab, icon: string, text: string, label: string): HTMLElement => {
      const active = this.tab === tab;
      const t = this.tabsEl.createDiv({ cls: `tag-everything-tab tag-everything-explorer-tab-${tab}`, attr: { role: "tab", "aria-label": label, "aria-selected": String(active) } });
      setIcon(t.createSpan({ cls: "tag-everything-tab-icon" }), icon);
      t.createSpan({ text });
      t.toggleClass("is-active", active);
      clickable(t, () => this.showTab(tab));
      return t;
    };
    tabEl("tags", "tags", "Tags", "The vault as a tree of tags");
    const waiting = this.inbox.files().length;
    const inbox = tabEl("inbox", "inbox", "Inbox", `${plural(waiting, "file")} without tags that arrived lately`);
    if (waiting) inbox.createSpan({ cls: "tag-everything-chip-count", text: String(waiting) });
  }

  /**
   * Draws the node at `trail` into `parent` (its branches, those `keep` keeps when given, open ones drawn inside, then
   * its items); returns the node, all its branches.
   * Built from Obsidian's own tree classes (`tree-item`, `tree-item-self`, `collapse-icon`, `tree-item-children`,
   * `tree-item-flair`), as the core search and outline are, so it looks and indents like the file explorer.
   */
  private renderNode(parent: HTMLElement, trail: readonly string[], paths: Iterable<string>, keep?: (tag: string, n: number) => boolean): ReturnType<typeof tagNode> {
    const index = this.plugin.index;
    const node = tagNode(paths, (p) => index.ownTagsOf(p), trail);
    for (const [tag, n] of node.tags) {
      if (keep && !keep(tag, n)) continue;
      const branch = [...trail, tag];
      const open = this.expanded.has(keyOf(branch));
      const box = parent.createDiv({ cls: "tree-item" });
      box.toggleClass("is-collapsed", !open);
      const row = box.createDiv({ cls: "tree-item-self is-clickable mod-collapsible tag-everything-explorer-row is-tag" });
      row.dataset.tag = tag;
      row.dataset.trail = keyOf(branch);
      row.setAttr("aria-expanded", String(open));
      paintTag(row, index.colorFor(tag));
      const arrow = row.createDiv({ cls: "tree-item-icon collapse-icon" });
      arrow.toggleClass("is-collapsed", !open);
      setIcon(arrow, "right-triangle");
      const inner = row.createDiv({ cls: "tree-item-inner" });
      setIcon(inner.createSpan({ cls: "tag-everything-explorer-icon" }), "tag");
      inner.createSpan({ cls: "tag-everything-explorer-name", text: tag });
      row.createDiv({ cls: "tree-item-flair-outer" }).createSpan({ cls: "tree-item-flair", text: String(n) });
      clickable(row, () => this.toggle(branch));
      row.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        menu.addItem((i) => i.setTitle("Rename or merge tag…").setIcon("pencil").onClick(() => this.plugin.renameTag(tag)));
        menu.showAtMouseEvent(evt);
      });
      if (open) this.renderNode(box.createDiv({ cls: "tree-item-children" }), branch, node.paths);
    }
    const vault = this.app.vault;
    const items = node.items
      .map((p) => vault.getAbstractFileByPath(p))
      .filter((f): f is TAbstractFile => !!f)
      .sort((a, b) => compareItems({ name: a.name, folder: a instanceof TFolder }, { name: b.name, folder: b instanceof TFolder }));
    for (const item of items.slice(0, MAX_RESULTS)) this.itemRow(parent, item);
    if (items.length > MAX_RESULTS) parent.createDiv({ cls: "tag-everything-explorer-more", text: `…and ${plural(items.length - MAX_RESULTS, "more item")}` });
    return node;
  }

  /**
   * One file or folder, as in the core explorer with badges: the extension chip, the name (without extension after a
   * chip), then on the right the round pill with the number of its tags (hover: the list) and a folder icon (hover:
   * the folder it is really in; click: shown there in the file explorer). Its tags are not repeated: the path above
   * holds some, the pill lists them all.
   */
  private itemRow(parent: HTMLElement, item: TAbstractFile): void {
    const index = this.plugin.index;
    const row = parent.createDiv({ cls: "tree-item" }).createDiv({ cls: "tree-item-self is-clickable tag-everything-explorer-row" });
    row.dataset.path = item.path;
    row.toggleClass("is-active", item.path === this.activePath);
    // an invisible arrow, so the name lines up with the tag names of its level, as in the file explorer
    setIcon(row.createDiv({ cls: "tree-item-icon tag-everything-explorer-spacer" }), "right-triangle");
    const inner = row.createDiv({ cls: "tree-item-inner" });
    const [ext] = index.get(item.path).ext;
    if (ext) {
      const chip = inner.createSpan({ cls: "tag-everything-badge tag-everything-ext", text: ext });
      paintTag(chip, index.colorFor(ext));
    } else {
      setIcon(inner.createSpan({ cls: "tag-everything-explorer-icon" }), item instanceof TFolder ? "folder" : "file");
    }
    inner.createSpan({ cls: "tag-everything-explorer-name", text: item instanceof TFile && ext ? item.basename : item.name });
    const flair = row.createDiv({ cls: "tree-item-flair-outer" });
    const tags = index.ownTagsOf(item.path);
    if (tags.length) this.plugin.badges.addPill(flair, tags);
    const where = flair.createSpan({ cls: "clickable-icon tag-everything-explorer-where" });
    setIcon(where, "folder");
    setTooltip(where, `In ${item.parent && !item.parent.isRoot() ? item.parent.path : "the vault root"}. Click: show it there in the file explorer`);
    where.addEventListener("click", (evt) => {
      evt.stopPropagation();
      revealInExplorer(this.app, item);
    });
    wireItemRow(this.rowHost(), row, item); // open (a folder: revealed in the file explorer), preview, drag, file menu
  }
}
