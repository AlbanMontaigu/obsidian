import { TAbstractFile } from "obsidian";
import type TagEverythingPlugin from "./main.ts";
import { paintTag } from "./ui.ts";

/**
 * Tag chips in the core file explorer. There is no public API for this: it uses the explorer view's
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

const BADGE_CLS = "tag-everything-badges";
/** The extension chip, first in the row, before the name. */
const EXT_CLS = "tag-everything-ext";
/** On a row with an extension chip: hides Obsidian's own extension label after the name (styles.css). */
const HAS_EXT_CLS = "tag-everything-has-ext";

/** What one explorer row shows: its extension tag before the name, its other tags after. */
interface RowBadges {
  ext: string | null;
  tags: string[];
}

export class ExplorerBadges {
  /** Explorer rows we decorated -> what their badges show, so a refresh only touches rows that changed. */
  private decorated = new Map<HTMLElement, string>();

  constructor(private plugin: TagEverythingPlugin) {}

  private explorers(): ExplorerView[] {
    return this.plugin.app.workspace.getLeavesOfType("file-explorer").map((l) => l.view as unknown as ExplorerView);
  }

  private undecorate(host: HTMLElement): void {
    host.querySelector(`:scope > .${BADGE_CLS}`)?.remove();
    host.querySelector(`:scope > .${EXT_CLS}`)?.remove();
    host.removeClass(HAS_EXT_CLS);
    this.decorated.delete(host);
  }

  clear(): void {
    for (const host of [...this.decorated.keys()]) this.undecorate(host);
  }

  /** Called (debounced) on every index change and layout change: cheap when nothing changed. */
  refresh(): void {
    try {
      const { settings, index } = this.plugin;
      if (!settings.showBadges) return this.clear();
      const wanted = new Map<HTMLElement, RowBadges>();
      for (const view of this.explorers()) {
        const items = view.fileItems;
        if (!items) continue;
        for (const path of index.paths()) {
          const host = items[path]?.selfEl;
          if (!host) continue;
          const { name, ext: [ext = null] } = index.get(path);
          const own = index.ownTagsOf(path);
          const tags = own.filter((t) => t !== ext && (settings.badgeScope !== "sidecar" || !name.includes(t)));
          if (ext || tags.length) wanted.set(host, { ext, tags });
        }
      }
      for (const host of [...this.decorated.keys()]) if (!wanted.has(host) || !host.isConnected) this.undecorate(host);
      for (const [host, row] of wanted) {
        const signature = this.signature(row);
        if (this.decorated.get(host) === signature && host.querySelector(`:scope > .${row.ext ? EXT_CLS : BADGE_CLS}`)) continue;
        this.undecorate(host);
        this.decorate(host, row, signature);
      }
    } catch (err) {
      console.warn("[tag-everything] explorer badges unavailable", err);
    }
  }

  /** Everything the badges of a row depend on: tags, their colours, the badge limit. */
  private signature({ ext, tags }: RowBadges): string {
    const { settings, index } = this.plugin;
    const all = ext ? [ext, ...tags] : tags;
    return settings.maxBadges + "\u0000" + (ext ?? "") + "\u0000" + all.map((t) => t + "\u0001" + (index.colorFor(t) ?? "")).join("\u0000");
  }

  private chip(parent: HTMLElement, tag: string, cls = ""): HTMLElement {
    const chip = parent.createSpan({ cls: `tag-everything-badge ${cls}`.trim(), text: tag });
    paintTag(chip, this.plugin.index.colorFor(tag));
    chip.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      void this.plugin.showTag(tag);
    });
    return chip;
  }

  private decorate(host: HTMLElement, { ext, tags }: RowBadges, signature: string): void {
    const { maxBadges } = this.plugin.settings;
    if (ext) {
      host.prepend(this.chip(host, ext, EXT_CLS));
      host.addClass(HAS_EXT_CLS);
    }
    if (tags.length) {
      const wrap = host.createSpan({ cls: BADGE_CLS });
      for (const tag of tags.slice(0, maxBadges)) this.chip(wrap, tag);
      const hidden = tags.length - maxBadges;
      if (hidden > 0) wrap.createSpan({ cls: "tag-everything-badge is-more", text: `+${hidden}`, attr: { "aria-label": tags.slice(maxBadges).join(" ") } });
    }
    this.decorated.set(host, signature);
  }
}
