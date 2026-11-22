import { Menu, MenuItem } from "obsidian";
import { PLUGIN_NAME } from "./messages.ts";

// The plugin's entries in Obsidian's context menus (file explorer, its own views): one "TagEverything" submenu.

/** One entry of the plugin's context submenu. */
export interface MenuEntry {
  title: string;
  icon: string;
  run: () => void;
}

/** `MenuItem.setSubmenu()`: in the app, not in the typed API (docs/obsidian-api.md, internal APIs). */
interface SubmenuItem {
  setSubmenu?: () => Menu;
}

/**
 * Adds the plugin's entries to a context menu under one "TagEverything" item, so the user sees where they come
 * from. Without submenus (internal API gone), they are added flat, each prefixed with the plugin's name.
 */
export function addPluginMenu(menu: Menu, entries: readonly MenuEntry[]): void {
  if (!entries.length) return;
  let sub: Menu | undefined;
  menu.addItem((item) => {
    try {
      sub = (item as unknown as SubmenuItem).setSubmenu?.();
    } catch (err) {
      console.warn("[tag-everything] context submenu unavailable", err);
    }
    if (sub) item.setTitle(PLUGIN_NAME).setIcon("tags").setSection("action");
    else flatItem(item, entries[0]);
  });
  if (sub) for (const e of entries) sub.addItem((i) => i.setTitle(e.title).setIcon(e.icon).onClick(e.run));
  else for (const e of entries.slice(1)) menu.addItem((i) => flatItem(i, e));
}

function flatItem(item: MenuItem, e: MenuEntry): void {
  item.setTitle(`${PLUGIN_NAME}: ${e.title}`).setIcon(e.icon).setSection("action").onClick(e.run);
}
