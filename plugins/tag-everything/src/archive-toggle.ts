import { setIcon } from "obsidian";
import { archiveToggleLabel } from "./archive.ts";
import { clickable } from "./ui.ts";
import type TagEverythingPlugin from "./main.ts";

/**
 * The "show archived items" switch (src/archive.ts), the same in every view that lists items: the panel's bar, the
 * TagEverything explorer's bar, its inbox and query blocks. Each flips the one setting `showArchived`, so all of them
 * follow. Created once; `updateArchiveToggle` after each render shows its state.
 */
export function archiveToggle(parent: HTMLElement, plugin: TagEverythingPlugin): HTMLElement {
  const el = parent.createDiv({ cls: "clickable-icon tag-everything-archive-toggle", attr: { role: "button" } });
  setIcon(el, "archive");
  clickable(el, (evt) => {
    evt.stopPropagation(); // in a query block: not the block's own click (edit the code)
    void plugin.toggleArchived();
  });
  updateArchiveToggle(el, plugin);
  return el;
}

/** Marked while the archived items show; hidden when no archive tag is set (nothing to switch). */
export function updateArchiveToggle(el: HTMLElement, plugin: TagEverythingPlugin): void {
  const archive = plugin.index.archiveTags;
  const shown = plugin.settings.showArchived;
  el.toggle(archive.size > 0);
  el.toggleClass("is-active", shown);
  el.setAttr("aria-pressed", String(shown));
  el.setAttr("aria-label", archiveToggleLabel(archive, shown));
}
