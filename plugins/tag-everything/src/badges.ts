import { TAbstractFile } from "obsidian";
import type TagEverythingPlugin from "./main.ts";

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

export class ExplorerBadges {
  /** Explorer rows we decorated -> what their badges show, so a refresh only touches rows that changed. */
  private decorated = new Map<HTMLElement, string>();

  constructor(private plugin: TagEverythingPlugin) {}

  private explorers(): ExplorerView[] {
    return this.plugin.app.workspace.getLeavesOfType("file-explorer").map((l) => l.view as unknown as ExplorerView);
  }

  private undecorate(host: HTMLElement): void {
    host.querySelector(`:scope > .${BADGE_CLS}`)?.remove();
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
      const wanted = new Map<HTMLElement, string[]>();
      for (const view of this.explorers()) {
        const items = view.fileItems;
        if (!items) continue;
        for (const path of index.paths()) {
          const host = items[path]?.selfEl;
          if (!host) continue;
          const all = index.tagsOf(path);
          const name = index.get(path).name;
          const tags = settings.badgeScope === "sidecar" ? all.filter((t) => !name.includes(t)) : [...all];
          if (tags.length) wanted.set(host, tags);
        }
      }
      for (const host of [...this.decorated.keys()]) if (!wanted.has(host) || !host.isConnected) this.undecorate(host);
      for (const [host, tags] of wanted) {
        const signature = this.signature(tags);
        if (this.decorated.get(host) === signature && host.querySelector(`:scope > .${BADGE_CLS}`)) continue;
        this.undecorate(host);
        this.decorate(host, tags, signature);
      }
    } catch (err) {
      console.warn("[tag-everything] explorer badges unavailable", err);
    }
  }

  /** Everything the badges of a row depend on: tags, their colours, the badge limit. */
  private signature(tags: readonly string[]): string {
    const { settings, index } = this.plugin;
    return settings.maxBadges + "\u0000" + tags.map((t) => t + "\u0001" + (index.colorFor(t) ?? "")).join("\u0000");
  }

  private decorate(host: HTMLElement, tags: string[], signature: string): void {
    const { settings, index } = this.plugin;
    const wrap = host.createSpan({ cls: BADGE_CLS });
    for (const tag of tags.slice(0, settings.maxBadges)) {
      const chip = wrap.createSpan({ cls: "tag-everything-badge", text: tag });
      const color = index.colorFor(tag);
      if (color) chip.setCssProps({ "--tag-everything-color": color });
      chip.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        void this.plugin.showTag(tag);
      });
    }
    const hidden = tags.length - settings.maxBadges;
    if (hidden > 0) wrap.createSpan({ cls: "tag-everything-badge is-more", text: `+${hidden}`, attr: { "aria-label": tags.slice(settings.maxBadges).join(" ") } });
    this.decorated.set(host, signature);
  }
}
