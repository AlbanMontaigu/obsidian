import { TAbstractFile, TFolder, setIcon } from "obsidian";
import type TagEverythingPlugin from "./main.ts";
import { paintTag } from "./ui.ts";
import { markInherited } from "./items.ts";
import { PLUGIN_NAME } from "./messages.ts";
import { type Exclusion, describeNameExclusion } from "./exclude.ts";

/**
 * Explorer badges: the extension chip before a name, a pill with the number of tags after it (hover: the list), and
 * an eye-off icon on what is excluded from TagEverything (src/exclude.ts). In the core file explorer. There is no public API for this: it uses the explorer view's
 * `fileItems` map (path -> item with `selfEl`), as most explorer-decorating plugins do. If Obsidian
 * changes that, badges silently stop appearing and nothing else is affected.
 */
interface ExplorerItem {
  file?: TAbstractFile;
  selfEl?: HTMLElement;
  el?: HTMLElement;
}
interface ExplorerView {
  fileItems?: Record<string, ExplorerItem>;
}

/** The pill after the name: the number of stored tags. */
const COUNT_CLS = "tag-everything-count";
/** The vertical list of a row's tags, shown while the mouse is over its pill (one at a time, in the page body). */
const LIST_CLS = "tag-everything-badge-list";
/** The extension chip, first in the row, before the name. */
const EXT_CLS = "tag-everything-ext";
/** On a row with an extension chip: hides Obsidian's own extension label after the name (styles.css). */
const HAS_EXT_CLS = "tag-everything-has-ext";
/** The eye-off icon after the name of an excluded item. */
const EXCLUDED_CLS = "tag-everything-excluded";
/** On the row of an excluded item: faded (styles.css). */
const IS_EXCLUDED_CLS = "tag-everything-is-excluded";
/** Time to move the mouse from the pill to its list before the list closes. */
const HIDE_DELAY_MS = 200;

/** What one explorer row shows: its extension tag before the name, the number of its other tags after. */
interface RowBadges {
  ext: string | null;
  tags: string[];
  /** Excluded from TagEverything: why, for the icon's tooltip; such a row shows nothing else. */
  excluded?: string;
  /** The item: its pill's list adds the tags it inherits (src/inherit.ts). */
  path?: string;
}

/** Why the item at `path` is excluded, for the icon's tooltip ("" = the item itself, excluded by hand). */
function excludedBy(why: Exclusion, path: string): string {
  if (why.by === "path") return why.path === path ? "" : `folder ${why.path}`;
  return why.by === "name" ? describeNameExclusion(why) : "a rule";
}

export class ExplorerBadges {
  /** Explorer rows we decorated -> what their badges show, so a refresh only touches rows that changed. */
  private decorated = new Map<HTMLElement, string>();
  private list: HTMLElement | null = null;
  private hideTimer: number | undefined;

  constructor(private plugin: TagEverythingPlugin) {}

  private explorers(): ExplorerView[] {
    return this.plugin.app.workspace.getLeavesOfType("file-explorer").map((l) => l.view as unknown as ExplorerView);
  }

  private undecorate(host: HTMLElement): void {
    host.querySelector(`:scope > .${COUNT_CLS}`)?.remove();
    host.querySelector(`:scope > .${EXT_CLS}`)?.remove();
    host.querySelector(`:scope > .${EXCLUDED_CLS}`)?.remove();
    host.removeClass(HAS_EXT_CLS, IS_EXCLUDED_CLS);
    this.decorated.delete(host);
  }

  clear(): void {
    this.hideList();
    for (const host of [...this.decorated.keys()]) this.undecorate(host);
  }

  /** Called (debounced) on every index change and layout change: cheap when nothing changed. */
  refresh(): void {
    try {
      const { settings, index } = this.plugin;
      const excludes = this.plugin.hasExclusions();
      if (!settings.showBadges && !excludes) return this.clear();
      const wanted = new Map<HTMLElement, RowBadges>();
      for (const view of this.explorers()) {
        const items = view.fileItems;
        if (!items) continue;
        // The excluded icon shows even with the badges off: it says why the item is left out everywhere.
        if (excludes) {
          for (const [path, item] of Object.entries(items)) {
            const why = item.selfEl && this.plugin.exclusion(path, item.file instanceof TFolder);
            if (why) wanted.set(item.selfEl!, { ext: null, tags: [], excluded: excludedBy(why, path) });
          }
        }
        if (!settings.showBadges) continue;
        for (const path of index.paths()) {
          const host = items[path]?.selfEl;
          if (!host) continue;
          const { name, ext: [ext = null] } = index.get(path);
          const own = index.ownTagsOf(path);
          const tags = own.filter((t) => t !== ext && (settings.badgeScope !== "sidecar" || !name.includes(t)));
          if (ext || tags.length) wanted.set(host, { ext, tags, path });
        }
      }
      for (const host of [...this.decorated.keys()]) if (!wanted.has(host) || !host.isConnected) this.undecorate(host);
      for (const [host, row] of wanted) {
        const signature = this.signature(row);
        const first = row.excluded !== undefined ? EXCLUDED_CLS : row.ext ? EXT_CLS : COUNT_CLS;
        if (this.decorated.get(host) === signature && host.querySelector(`:scope > .${first}`)) continue;
        this.undecorate(host);
        this.decorate(host, row, signature);
      }
    } catch (err) {
      console.warn("[tag-everything] explorer badges unavailable", err);
    }
  }

  /** Everything the badges of a row depend on: tags and their colours. */
  private signature({ ext, tags, excluded, path }: RowBadges): string {
    if (excluded !== undefined) return `\u0002${excluded}`;
    const { index } = this.plugin;
    const all = [...(ext ? [ext] : []), ...tags, ...(path && tags.length ? index.inheritedOf(path).map((t) => `\u0003${t}`) : [])];
    return (ext ?? "") + "\u0000" + all.map((t) => t + "\u0001" + (index.colorFor(t) ?? "")).join("\u0000");
  }

  private chip(parent: HTMLElement, tag: string, cls = ""): HTMLElement {
    const chip = parent.createSpan({ cls: `tag-everything-badge ${cls}`.trim(), text: tag });
    paintTag(chip, this.plugin.index.colorFor(tag));
    chip.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.hideList();
      void this.plugin.showTag(tag);
    });
    return chip;
  }

  private decorate(host: HTMLElement, { ext, tags, excluded, path }: RowBadges, signature: string): void {
    if (excluded !== undefined) {
      const label = `Excluded from ${PLUGIN_NAME}${excluded ? ` (by ${excluded})` : ""}: its tags are ignored. Right-click → ${PLUGIN_NAME} to include it again.`;
      setIcon(host.createSpan({ cls: EXCLUDED_CLS, attr: { "aria-label": label } }), "eye-off");
      host.addClass(IS_EXCLUDED_CLS);
    }
    if (ext) {
      host.prepend(this.chip(host, ext, EXT_CLS));
      host.addClass(HAS_EXT_CLS);
    }
    if (tags.length) this.addPill(host, tags, path);
    this.decorated.set(host, signature);
  }

  /**
   * Appends the round pill with the number of `tags` (stored) to `host`; hovering or clicking it lists them, then the
   * tags `path` inherits (marked). Also used by the TagEverything explorer's rows.
   */
  addPill(host: HTMLElement, tags: readonly string[], path?: string): void {
    const pill = host.createSpan({ cls: `tag-everything-badge ${COUNT_CLS}`, text: String(tags.length) });
    pill.addEventListener("mouseenter", () => this.showList(pill, tags, path));
    pill.addEventListener("mouseleave", () => this.hideSoon());
    // A click shows the list too (no hover on a touch screen) and doesn't open the file under the pill.
    pill.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this.showList(pill, tags, path);
    });
  }

  /** The row's tags, one per line, under the pill (above it near the bottom of the window). */
  private showList(pill: HTMLElement, tags: readonly string[], path?: string): void {
    this.hideList();
    const doc = pill.ownerDocument;
    const win = doc.defaultView ?? window;
    const list = doc.body.createDiv({ cls: LIST_CLS });
    for (const tag of tags) this.chip(list, tag);
    const { index } = this.plugin;
    if (path) for (const tag of index.inheritedOf(path)) markInherited(this.chip(list, tag), index, tag, path);
    list.addEventListener("mouseenter", () => this.cancelHide());
    list.addEventListener("mouseleave", () => this.hideSoon());
    const at = pill.getBoundingClientRect();
    const { width, height } = list.getBoundingClientRect();
    const top = at.bottom + 4 + height > win.innerHeight ? at.top - 4 - height : at.bottom + 4;
    const left = Math.max(4, Math.min(at.left, win.innerWidth - width - 4));
    list.setCssProps({ "--tag-everything-list-top": `${Math.max(4, top)}px`, "--tag-everything-list-left": `${left}px` });
    this.list = list;
  }

  private hideSoon(): void {
    this.cancelHide();
    this.hideTimer = window.setTimeout(() => this.hideList(), HIDE_DELAY_MS);
  }

  private cancelHide(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
  }

  private hideList(): void {
    this.cancelHide();
    this.list?.remove();
    this.list = null;
  }
}
