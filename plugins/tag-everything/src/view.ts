import { ItemView, Keymap, Menu, TAbstractFile, TFile, TFolder, WorkspaceLeaf, setIcon } from "obsidian";
import * as ts from "./format.ts";
import { cloudWeights } from "./cloud.ts";
import type TagEverythingPlugin from "./main.ts";

export const VIEW_TYPE = "tag-everything-view";
const MAX_RESULTS = 500;

interface InternalApp {
  viewRegistry?: { isExtensionRegistered?: (ext: string) => boolean };
  openWithDefaultApp?: (path: string) => void;
  internalPlugins?: { getPluginById?: (id: string) => { instance?: { revealInFolder?: (f: TAbstractFile) => void } } | null };
}

/** Sidebar panel: every tag with its count; select tags (AND) to list the files and folders carrying them. */
export class TagEverythingView extends ItemView {
  private selected: string[] = [];
  private filter = "";
  private tagsEl!: HTMLElement;
  private selectedEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private statusEl!: HTMLElement;

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
    const search = bar.createEl("input", { type: "search", cls: "tag-everything-view-search", attr: { placeholder: "Filter tags…" } });
    search.addEventListener("input", () => {
      this.filter = search.value.trim().toLowerCase();
      this.renderTags();
    });
    const rebuild = bar.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Re-read tags (picks up changes made outside Obsidian)" } });
    setIcon(rebuild, "refresh-cw");
    rebuild.addEventListener("click", () => {
      this.statusEl.setText("Reading tags…");
      void this.plugin.index.rebuild();
    });

    this.selectedEl = root.createDiv({ cls: "tag-everything-view-selected" });
    this.tagsEl = root.createDiv({ cls: "tag-everything-view-tags" });
    this.statusEl = root.createDiv({ cls: "tag-everything-view-status" });
    this.resultsEl = root.createDiv({ cls: "tag-everything-view-results" });

    this.registerEvent(this.plugin.index.on("changed", () => this.render()));
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Shows the items carrying `tag` (used by badge clicks). */
  selectOnly(tag: string): void {
    this.selected = [tag];
    this.render();
  }

  private toggle(tag: string): void {
    this.selected = this.selected.includes(tag) ? this.selected.filter((t) => t !== tag) : [...this.selected, tag];
    this.render();
  }

  private render(): void {
    if (!this.tagsEl) return;
    const index = this.plugin.index;
    this.selected = this.selected.filter((t) => index.counts().has(t));
    this.renderSelected();
    this.renderTags();
    this.renderResults();
  }

  private chip(parent: HTMLElement, tag: string, extra = ""): HTMLElement {
    const el = parent.createDiv({ cls: "tag-everything-chip " + extra });
    const color = this.plugin.index.colorFor(tag);
    if (color) el.style.setProperty("--tag-everything-color", color);
    el.createSpan({ text: tag });
    return el;
  }

  private renderSelected(): void {
    this.selectedEl.empty();
    if (!this.selected.length) return;
    for (const tag of this.selected) {
      const el = this.chip(this.selectedEl, tag, "is-selected");
      const x = el.createSpan({ cls: "tag-everything-chip-remove" });
      setIcon(x, "x");
      el.addEventListener("click", () => this.toggle(tag));
    }
    const clear = this.selectedEl.createEl("button", { cls: "tag-everything-view-clear", text: "Clear" });
    clear.addEventListener("click", () => {
      this.selected = [];
      this.render();
    });
  }

  private renderTags(): void {
    this.tagsEl.empty();
    const index = this.plugin.index;
    const scope = this.selected.length ? index.matching(this.selected) : undefined;
    const counts = index.counts(scope);
    const rows = [...counts]
      .filter(([t]) => !this.selected.includes(t) && (!this.filter || t.toLowerCase().includes(this.filter)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!rows.length) {
      this.tagsEl.createDiv({
        cls: "tag-everything-view-empty",
        text: index.paths().length ? "No other tag." : "No tags yet. Right-click a file or folder → Edit tags.",
      });
      return;
    }
    // Size by use, relative to the tags shown (so it adapts to the filter and the selection).
    const weights = cloudWeights(rows);
    for (const [tag, n] of rows) {
      const el = this.chip(this.tagsEl, tag);
      el.style.setProperty("--tag-everything-weight", String(weights.get(tag) ?? 0));
      el.createSpan({ cls: "tag-everything-chip-count", text: String(n) });
      el.addEventListener("click", () => this.toggle(tag));
    }
  }

  private renderResults(): void {
    this.resultsEl.empty();
    const index = this.plugin.index;
    const total = index.paths().length;
    if (!this.selected.length) {
      this.statusEl.setText(`${total} tagged item${total === 1 ? "" : "s"}. Select a tag to list them.`);
      return;
    }
    const vault = this.app.vault;
    const items = index
      .matching(this.selected)
      .map((p) => vault.getAbstractFileByPath(p))
      .filter((f): f is TAbstractFile => !!f)
      .sort((a, b) => Number(a instanceof TFile) - Number(b instanceof TFile) || a.path.localeCompare(b.path));
    this.statusEl.setText(`${items.length} item${items.length === 1 ? "" : "s"}` + (items.length > MAX_RESULTS ? `, first ${MAX_RESULTS} shown` : ""));

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

      row.setAttr("title", item.path);
      row.addEventListener("click", (evt) => this.openItem(item, evt));
      row.addEventListener("contextmenu", (evt) => {
        const menu = new Menu();
        this.app.workspace.trigger("file-menu", menu, item, "tag-everything-view", this.leaf);
        menu.showAtMouseEvent(evt);
      });
    }
  }

  // Not "open": View.open(containerEl) is an internal Obsidian method that this would shadow.
  private openItem(item: TAbstractFile, evt: MouseEvent): void {
    const app = this.app as unknown as InternalApp;
    try {
      if (item instanceof TFolder) {
        app.internalPlugins?.getPluginById?.("file-explorer")?.instance?.revealInFolder?.(item);
        return;
      }
      const file = item as TFile;
      const known = app.viewRegistry?.isExtensionRegistered?.(file.extension) ?? true;
      if (!known && app.openWithDefaultApp) app.openWithDefaultApp(file.path);
      else void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(file);
    } catch (err) {
      console.error("[tag-everything] open failed", err);
    }
  }
}
