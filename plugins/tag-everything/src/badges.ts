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
  private decorated = new Set<HTMLElement>();

  constructor(private plugin: TagEverythingPlugin) {}

  private explorers(): ExplorerView[] {
    return this.plugin.app.workspace.getLeavesOfType("file-explorer").map((l) => l.view as unknown as ExplorerView);
  }

  clear(): void {
    for (const el of this.decorated) el.querySelector(`:scope > .${BADGE_CLS}`)?.remove();
    this.decorated.clear();
  }

  refresh(): void {
    try {
      this.clear();
      const { settings, index } = this.plugin;
      if (!settings.showBadges) return;
      for (const view of this.explorers()) {
        const items = view.fileItems;
        if (!items) continue;
        for (const path of index.paths()) {
          const host = items[path]?.selfEl;
          if (!host) continue;
          const entry = index.get(path);
          const tags = settings.badgeScope === "sidecar" ? index.tagsOf(path).filter((t) => !entry.name.includes(t)) : index.tagsOf(path);
          if (tags.length) this.decorate(host, tags);
        }
      }
    } catch (err) {
      console.warn("[tag-everything] explorer badges unavailable", err);
    }
  }

  private decorate(host: HTMLElement, tags: string[]): void {
    const { settings, index } = this.plugin;
    const wrap = host.createSpan({ cls: BADGE_CLS });
    for (const tag of tags.slice(0, settings.maxBadges)) {
      const chip = wrap.createSpan({ cls: "tag-everything-badge", text: tag });
      const color = index.colorOf(tag);
      if (color) chip.style.setProperty("--tag-everything-color", color);
      chip.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        void this.plugin.showTag(tag);
      });
    }
    const hidden = tags.length - settings.maxBadges;
    if (hidden > 0) wrap.createSpan({ cls: "tag-everything-badge is-more", text: `+${hidden}`, attr: { "aria-label": tags.join(" ") } });
    this.decorated.add(host);
  }
}
