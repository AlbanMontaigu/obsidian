import { App, HoverParent, Keymap, Menu, TAbstractFile, TFile, TFolder, WorkspaceLeaf, setIcon } from "obsidian";
import { parentOf } from "./format.ts";
import type { TagIndex } from "./index.ts";
import { clickable } from "./ui.ts";

// What a file or folder row shows and does in the plugin's views (panel results, TagEverything explorer, query blocks,
// inbox): open, page preview, drag into a note, the usual file menu. Internal APIs are guarded: missing, they do nothing.

/** Where a row lives: the hover-link source registered for it, and what owns its page preview. */
export interface RowHost {
  app: App;
  /** A source registered with `registerHoverLinkSource`, also passed to the file menu. */
  source: string;
  hoverParent: HoverParent;
  leaf?: WorkspaceLeaf;
}

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

/**
 * Shows the item in its real place in Obsidian's file explorer (folders opened, scrolled to, selected). A file type
 * the explorer hides (*Detect all file extensions* off) shows its folder only.
 */
export function revealInExplorer(app: App, item: TAbstractFile): void {
  try {
    (app as unknown as InternalApp).internalPlugins?.getPluginById?.("file-explorer")?.instance?.revealInFolder?.(item);
  } catch (err) {
    console.warn("[tag-everything] reveal in the file explorer failed", err);
  }
}

/**
 * Opens a file (Ctrl/Cmd: in a new tab; a file Obsidian has no view for, such as an Office file, in the system app)
 * or reveals a folder in the file explorer.
 */
export function openItem(app: App, item: TAbstractFile, evt: MouseEvent | KeyboardEvent): void {
  const internal = app as unknown as InternalApp;
  try {
    if (item instanceof TFolder) {
      revealInExplorer(app, item);
      return;
    }
    if (!(item instanceof TFile)) return;
    const known = internal.viewRegistry?.isExtensionRegistered?.(item.extension) ?? true;
    if (!known && internal.openWithDefaultApp) internal.openWithDefaultApp(item.path);
    else void app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(item);
  } catch (err) {
    console.error("[tag-everything] open failed", err);
  }
}

/**
 * Makes `row` behave like a file explorer row for `item`: click or Enter runs `activate` (default: `openItem`),
 * middle click opens in a new tab, right-click shows the file menu, Ctrl/Cmd + hover a page preview (`host.source`
 * must be a registered hover-link source), drag into a note links it.
 */
export function wireItemRow(
  host: RowHost,
  row: HTMLElement,
  item: TAbstractFile,
  activate: (evt: MouseEvent | KeyboardEvent) => void = (evt) => openItem(host.app, item, evt),
): void {
  const { app, source } = host;
  clickable(row, activate);
  row.addEventListener("auxclick", (evt) => {
    if (evt.button === 1) openItem(app, item, evt); // middle click: new tab
  });
  row.addEventListener("contextmenu", (evt) => {
    evt.preventDefault();
    const menu = new Menu();
    app.workspace.trigger("file-menu", menu, item, source, host.leaf);
    menu.showAtMouseEvent(evt);
  });
  if (item instanceof TFile) {
    row.addEventListener("mouseover", (evt) => {
      app.workspace.trigger("hover-link", { event: evt, source, hoverParent: host.hoverParent, targetEl: row, linktext: item.path });
    });
  }
  row.draggable = true;
  row.addEventListener("dragstart", (evt) => {
    try {
      const dm = (app as unknown as InternalApp).dragManager;
      const data = item instanceof TFile ? dm?.dragFile?.(evt, item) : item instanceof TFolder ? dm?.dragFolder?.(evt, item) : null;
      if (data) dm?.onDragStart?.(evt, data);
    } catch (err) {
      console.warn("[tag-everything] drag unavailable", err);
    }
  });
}

/** Draws one tag chip of a row; returns it. */
export type RowChipFn = (parent: HTMLElement, tag: string) => HTMLElement;

/**
 * One result row (panel results, query blocks): the extension tag in place of the file icon (folders keep their
 * icon), the name, its folder, then its other tags. Returns the row, not wired yet (`wireItemRow`), and its body
 * (name, folder, tags), where a view adds its own lines.
 */
export function renderItemRow(parent: HTMLElement, item: TAbstractFile, index: TagIndex, chip: RowChipFn): { row: HTMLElement; body: HTMLElement } {
  const row = parent.createDiv({ cls: "tag-everything-result" });
  row.dataset.path = item.path;
  const [ext] = index.get(item.path).ext;
  if (ext) chip(row, ext).addClass("tag-everything-result-ext");
  else setIcon(row.createSpan({ cls: "tag-everything-result-icon" }), item instanceof TFolder ? "folder" : "file");
  const body = row.createDiv({ cls: "tag-everything-result-body" });
  body.createDiv({ cls: "tag-everything-result-name", text: item.name });
  const folder = parentOf(item.path);
  if (folder) body.createDiv({ cls: "tag-everything-result-path", text: folder });
  const tags = index.tagsOf(item.path).filter((t) => t !== ext);
  if (tags.length) {
    const chips = body.createDiv({ cls: "tag-everything-result-tags" });
    for (const t of tags) chip(chips, t);
  }
  return { row, body };
}
