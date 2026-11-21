import { HoverParent, HoverPopover, ItemView, TAbstractFile, TFile, TFolder, ViewStateResult, WorkspaceLeaf, debounce, setIcon, setTooltip } from "obsidian";
import { compareItems, filterTags, tagNode } from "./explore.ts";
import { PLUGIN_NAME, plural } from "./messages.ts";
import type TagEverythingPlugin from "./main.ts";
import { MAX_RESULTS } from "./view.ts";
import { revealInExplorer, wireItemRow } from "./items.ts";
import { clickable, paintTag } from "./ui.ts";

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

/** What the explorer remembers across restarts (workspace.json): the open tag nodes, each as its trail of tags. */
interface ExplorerState {
  expanded: string[][];
}

/** A node's key in `expanded`: its trail, joined by a character no tag holds. */
const keyOf = (trail: readonly string[]): string => trail.join("\u001f");

/**
 * The TagEverything explorer (left sidebar): the vault as a tree of tags. At the root every tag; inside a tag, the
 * tags found with it (opening the same way), then the items carrying exactly the tags of the path. An item with
 * several tags sits at the end of every path made of them (src/explore.ts `tagNode`). Stored tags only: extension
 * tags are on every file, so they are the chip before a name, not a branch. Every file of the vault can show,
 * including those the core explorer hides (*Detect all file extensions* off). The file open in the editor is
 * highlighted wherever it shows.
 */
export class TagExplorerView extends ItemView implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  /** Open tag nodes, by `keyOf(trail)`. */
  private expanded = new Map<string, string[]>();
  /** The file open in the editor: highlighted. */
  private activePath: string | null = null;
  /** The filter box: only the root tags containing it show (not saved: a quick search). */
  private query = "";
  private statusEl!: HTMLElement;
  private treeEl!: HTMLElement;
  /** Vault events come in bursts (a folder moved, a sync): one redraw once they stop. */
  private requestRender = debounce(() => this.render(), 100, true);

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: TagEverythingPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return EXPLORER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return `${PLUGIN_NAME} explorer`;
  }

  getIcon(): string {
    return EXPLORER_ICON;
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("tag-everything-explorer");

    const bar = root.createDiv({ cls: "tag-everything-explorer-bar" });
    const search = bar.createEl("input", {
      type: "search",
      cls: "tag-everything-explorer-search",
      attr: { placeholder: "Filter tags…", "aria-label": "Filter tags (Enter opens the first one, Escape clears)" },
    });
    search.addEventListener("input", () => {
      this.query = search.value;
      this.render();
    });
    search.addEventListener("keydown", (evt) => {
      if (evt.isComposing) return;
      if (evt.key === "Enter") {
        const first = this.treeEl.querySelector<HTMLElement>(":scope > .tree-item > .tag-everything-explorer-row.is-tag")?.dataset.tag;
        evt.preventDefault();
        if (first && !this.expanded.has(keyOf([first]))) this.toggle([first]);
      } else if (evt.key === "Escape" && search.value) {
        evt.preventDefault();
        evt.stopPropagation();
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
    this.statusEl = root.createDiv({ cls: "tag-everything-explorer-status" });
    this.treeEl = root.createDiv({ cls: "tag-everything-explorer-tree" });

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
    const state: ExplorerState = { expanded: [...this.expanded.values()] };
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
    this.render();
    await super.setState(state, result);
  }

  /** Opens or closes the tag node at `trail` (public for the smoke test). */
  toggle(trail: readonly string[]): void {
    const key = keyOf(trail);
    if (!this.expanded.delete(key)) this.expanded.set(key, [...trail]);
    this.stateChanged();
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
    this.treeEl.empty();
    const root = this.renderNode(this.treeEl, [], index.paths());
    const tagged = root.paths.filter((p) => index.ownTagsOf(p).length).length;
    const shown = filterTags(root.tags, this.query).length;
    this.statusEl.setText(
      !index.ready
        ? "Reading tags…"
        : !root.tags.length
          ? "No tags yet. Right-click a file or folder → TagEverything → Edit tags."
          : shown < root.tags.length
            ? shown
              ? `${shown} of ${plural(root.tags.length, "tag")} match "${this.query.trim()}"`
              : `No tag matches "${this.query.trim()}".`
            : `${plural(root.tags.length, "tag")} on ${plural(tagged, "item")}`,
    );
    this.contentEl.scrollTop = scroll;
  }

  /**
   * Draws the node at `trail` into `parent` (its branches, open ones drawn inside, then its items); returns the node.
   * At the root, only the branches matching the filter box; inside a tag, all of them.
   * Built from Obsidian's own tree classes (`tree-item`, `tree-item-self`, `collapse-icon`, `tree-item-children`,
   * `tree-item-flair`), as the core search and outline are, so it looks and indents like the file explorer.
   */
  private renderNode(parent: HTMLElement, trail: readonly string[], paths: Iterable<string>): ReturnType<typeof tagNode> {
    const index = this.plugin.index;
    const node = tagNode(paths, (p) => index.ownTagsOf(p), trail);
    for (const [tag, n] of trail.length ? node.tags : filterTags(node.tags, this.query)) {
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
   * the folder it is really in; click: shown there in the file explorer). Its tags are not repeated: the branches
   * above are its tags.
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
    wireItemRow(this, row, item); // open (a folder: revealed in the file explorer), preview, drag, file menu
  }
}
