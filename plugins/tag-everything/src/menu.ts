import { Menu, MenuItem, TAbstractFile, TFolder } from "obsidian";
import { PLUGIN_NAME, plural } from "./messages.ts";
import { revealInExplorer } from "./items.ts";
import { describeConditions } from "./inbox.ts";
import { type Exclusion, describeNameExclusion } from "./exclude.ts";
import { RuleModal } from "./rule-modal.ts";
import { openPutAway, putAwayPlan } from "./putaway-modal.ts";
import type TagEverythingPlugin from "./main.ts";

// The plugin's entries in Obsidian's context menus (file explorer, its own views): one "TagEverything" submenu. They
// are the targeted actions (on the items right-clicked); the vault-wide ones are in the panel's Tools tab.

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

/**
 * The submenu of one file or folder. `fromPlugin`: right-clicked in the plugin's own views (explorer, panel), which
 * also offer to show the item in its real place.
 */
export function fileMenuEntries(plugin: TagEverythingPlugin, file: TAbstractFile, fromPlugin: boolean): MenuEntry[] {
  const excluded = plugin.exclusion(file.path, file instanceof TFolder);
  if (excluded) return [includeEntry(plugin, file, excluded)]; // an excluded item: only the way back in
  const entries: MenuEntry[] = [];
  const taggable = plugin.taggable(file);
  if (fromPlugin && taggable) entries.push({ title: "Show in the file explorer", icon: "folder-search", run: () => revealInExplorer(plugin.app, file) });
  if (taggable) entries.push({ title: "Edit tags", icon: "tags", run: () => plugin.editTags([file]) });
  entries.push({ title: "Suggest tags with Claude Code", icon: "sparkles", run: () => plugin.suggestTags([file]) });
  const rules = rulesEntry(plugin, [file]);
  if (rules) entries.push(rules);
  const away = putAwayEntry(plugin, [file]);
  if (away) entries.push(away);
  if (file instanceof TFolder) {
    entries.push({ title: "Show the inbox of this folder", icon: "inbox", run: () => void plugin.focusInbox(file.isRoot() ? "" : file.path) });
    entries.push({ title: "Check tag consistency", icon: "list-checks", run: () => void plugin.checkConsistency(file) });
    entries.push({ title: "Write a guide for AI assistants (CLAUDE.md)", icon: "bot", run: () => void plugin.writeGuide(file) });
    const kept = keptNameEntry(plugin, file);
    if (kept) entries.push(kept);
  }
  if (taggable) entries.push({ title: "Exclude from the tag engine", icon: "eye-off", run: () => void plugin.setExcluded([file.path], true) });
  return entries;
}

/** The submenu of a multi-selection. */
export function filesMenuEntries(plugin: TagEverythingPlugin, files: readonly TAbstractFile[]): MenuEntry[] {
  const items = files.filter((f) => plugin.taggable(f));
  const own = files.filter((f) => plugin.settings.excluded.includes(f.path)).map((f) => f.path);
  const entries: MenuEntry[] = [];
  if (items.length) {
    entries.push(
      { title: `Edit tags of ${items.length} items`, icon: "tags", run: () => plugin.editTags(items) },
      { title: "Suggest tags with Claude Code", icon: "sparkles", run: () => plugin.suggestTags(items) },
    );
    const rules = rulesEntry(plugin, items);
    if (rules) entries.push(rules);
    const away = putAwayEntry(plugin, items);
    if (away) entries.push(away);
    entries.push({ title: `Exclude ${plural(items.length, "item")} from the tag engine`, icon: "eye-off", run: () => void plugin.setExcluded(items.map((i) => i.path), true) });
  }
  if (own.length) entries.push({ title: `Include ${plural(own.length, "item")} in the tag engine again`, icon: "eye", run: () => void plugin.setExcluded(own, false) });
  return entries;
}

/** "Apply auto-tag rules", only when a rule would add a tag to one of the items (a folder: the files below it). */
function rulesEntry(plugin: TagEverythingPlugin, items: readonly TAbstractFile[]): MenuEntry | null {
  if (!plugin.settings.rules.length) return null;
  const n = plugin.ruleTargets(items).size;
  if (!n) return null;
  return { title: `Apply auto-tag rules (${plural(n, "file")})`, icon: "wand-sparkles", run: () => void plugin.applyRulesTo(items) };
}

/** "Put away", only when some file of the items (a folder: the files below it) has a better folder to go to. */
function putAwayEntry(plugin: TagEverythingPlugin, items: readonly TAbstractFile[]): MenuEntry | null {
  const n = putAwayPlan(plugin, items).size;
  if (!n) return null;
  return { title: `Put away in the usual folder (${plural(n, "file")})`, icon: "folder-input", run: () => void openPutAway(plugin, items) };
}

/**
 * "Don't pass its name down" / "Pass its name down again" (setting `keptFolderNames`, src/inherit.ts): only while
 * folder names are tags, on a folder whose name gives some.
 */
function keptNameEntry(plugin: TagEverythingPlugin, folder: TFolder): MenuEntry | null {
  if (folder.isRoot() || !plugin.settings.folderNameTags) return null;
  const tags = plugin.index.nameTagsOf(folder.path);
  if (!tags.length) return null;
  const on = plugin.settings.keptFolderNames.includes(folder.path);
  return on
    ? { title: `Pass its name down again (${tags.join(", ")})`, icon: "link", run: () => void plugin.setKeptName(folder.path, false) }
    : { title: `Don't pass its name down (${tags.join(", ")})`, icon: "unlink", run: () => void plugin.setKeptName(folder.path, true) };
}

/** The entry of an excluded item: include it (or the folder that excludes it) again, or edit its rule. */
function includeEntry(plugin: TagEverythingPlugin, item: TAbstractFile, why: Exclusion): MenuEntry {
  if (why.by === "name") {
    return { title: `Excluded by ${describeNameExclusion(why)}: change it in the settings`, icon: "eye-off", run: () => plugin.openSettings() };
  }
  if (why.by === "rule") {
    const { rule } = why;
    return {
      title: `Excluded by the rule "${describeConditions(rule)}": edit it`,
      icon: "eye-off",
      run: () => new RuleModal(plugin.app, plugin, rule, undefined, "exclude").open(),
    };
  }
  const title = why.path === item.path ? "Include in the tag engine again" : `Include "${why.path}" in the tag engine again`;
  return { title, icon: "eye", run: () => void plugin.setExcluded([why.path], false) };
}
