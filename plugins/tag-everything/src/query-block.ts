import { HoverParent, HoverPopover, MarkdownRenderChild, TAbstractFile, TFile, TFolder, debounce, setIcon } from "obsidian";
import { PLUGIN_NAME, plural } from "./messages.ts";
import { MAX_QUERY_LIMIT, type Query, compareQueryItems, matchQuery, parseQuery } from "./query.ts";
import { type RowHost, renderItemRow, wireItemRow } from "./items.ts";
import { clickable, paintTag, renderExpr } from "./ui.ts";
import { hasDateTerms } from "./formula.ts";
import type TagEverythingPlugin from "./main.ts";

/** Hover-link source of the query blocks' rows (Ctrl/Cmd + hover: page preview), registered by main.ts. */
export const QUERY_HOVER_SOURCE = "tag-everything-query";

/**
 * A `tag-everything` code block in a note, rendered: the formula as chips (click one: the panel searches it), how
 * many items match, then the items as in the panel's results (open, preview, drag, file menu). It follows the vault
 * live: tags edited, files renamed or deleted. src/query.ts reads the block and picks the items.
 */
export class TagQueryBlock extends MarkdownRenderChild implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  private query: Query;
  /** The paths the block found at its last render: a file saved elsewhere changes nothing (unless dates are searched). */
  private found = new Set<string>();
  /** Tag edits come in bursts (a batch, a rebuild): one redraw once they stop. */
  private requestRender = debounce(() => this.render(), 200, true);

  constructor(
    containerEl: HTMLElement,
    private plugin: TagEverythingPlugin,
    source: string,
  ) {
    super(containerEl);
    this.query = parseQuery(source);
  }

  onload(): void {
    this.containerEl.addClass("tag-everything-query");
    const redraw = (): void => void this.requestRender();
    const { vault } = this.plugin.app;
    this.registerEvent(this.plugin.index.on("changed", redraw));
    this.registerEvent(vault.on("rename", redraw));
    this.registerEvent(vault.on("delete", redraw));
    // A save changes a file's modification date: the order (sort by date) and what date terms find.
    const dated = !!this.query.expr && hasDateTerms(this.query.expr);
    if (this.query.sort !== "name" || dated) this.registerEvent(vault.on("modify", (file) => (dated || this.found.has(file.path)) && redraw()));
    this.render();
  }

  onunload(): void {
    this.requestRender.cancel();
  }

  private render(): void {
    const el = this.containerEl;
    const { query, plugin } = this;
    const index = plugin.index;
    el.empty();
    const head = el.createDiv({ cls: "tag-everything-query-head" });
    setIcon(head.createSpan({ cls: "tag-everything-query-icon", attr: { "aria-label": `${PLUGIN_NAME} query` } }), "tags");
    if (!query.expr) {
      head.createSpan({ cls: "tag-everything-query-formula-text", text: query.formula });
      el.createDiv({ cls: "tag-everything-error", text: `${PLUGIN_NAME} query: ${query.error}` });
      el.createDiv({
        cls: "tag-everything-query-help",
        text: "Tags with AND, OR, NOT and parentheses, e.g. (invoice OR facture) AND NOT paid. Options on their own line: sort: name | modified | created, limit: 20.",
      });
      return;
    }
    if (!index.ready) {
      head.createSpan({ cls: "tag-everything-query-count", text: "Reading tags…" });
      return;
    }
    const known = [...index.counts().keys()];
    const now = Date.now();
    const found = matchQuery(query.expr, index.paths(), (p, t) => index.hasTag(p, t), known, (p, f, r) => index.dated(p, f, r, now));
    this.found = new Set(found.paths);
    const unknown = new Set(found.unknown);
    const formulaEl = head.createDiv({ cls: "tag-everything-formula" });
    renderExpr(formulaEl, found.expr, (parent, tag, negated) => {
      const chip = this.chip(parent, tag);
      chip.toggleClass("is-negated", negated);
      chip.toggleClass("is-missing", unknown.has(tag));
    });

    const { vault } = plugin.app;
    const stat = (f: TAbstractFile): { mtime: number; ctime: number } => (f instanceof TFile ? f.stat : { mtime: 0, ctime: 0 });
    const items = found.paths
      .map((p) => vault.getAbstractFileByPath(p))
      .filter((f): f is TAbstractFile => !!f)
      .map((f) => ({ f, name: f.name, folder: f instanceof TFolder, ...stat(f) }))
      .sort(compareQueryItems(query.sort))
      .map(({ f }) => f);
    head.createSpan({ cls: "tag-everything-query-count", text: plural(items.length, "item") });

    const notes = [...(found.unknown.length ? [`No item carries ${found.unknown.join(", ")}`] : []), ...query.warnings];
    if (notes.length) el.createDiv({ cls: "tag-everything-query-warning mod-warning", text: notes.join(". ") });
    if (!items.length) {
      el.createDiv({ cls: "tag-everything-query-empty", text: "No item matches." });
      return;
    }
    const list = el.createDiv({ cls: "tag-everything-query-list" });
    const host: RowHost = { app: plugin.app, source: QUERY_HOVER_SOURCE, hoverParent: this };
    for (const item of items.slice(0, query.limit)) {
      const { row } = renderItemRow(list, item, index, (parent, tag) => this.chip(parent, tag));
      wireItemRow(host, row, item);
    }
    const more = items.length - query.limit;
    if (more > 0) el.createDiv({ cls: "tag-everything-query-more", text: `…and ${plural(more, "more item")} (a "limit: ${Math.min(items.length, MAX_QUERY_LIMIT)}" line shows more)` });
  }

  /** A small tag chip; a click shows the tag in the panel (not the row's click: that opens the file). */
  private chip(parent: HTMLElement, tag: string): HTMLElement {
    const chip = parent.createSpan({ cls: "tag-everything-chip is-small", text: tag, attr: { "data-tag": tag, "aria-label": `Show ${tag} in the panel` } });
    paintTag(chip, this.plugin.index.colorFor(tag));
    clickable(chip, (evt) => {
      evt.stopPropagation();
      void this.plugin.showTag(tag);
    });
    return chip;
  }
}
