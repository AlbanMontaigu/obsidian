// Settings data: shape, defaults and loading. Pure, no `obsidian` import (unit-tested under node --test).
// The settings tab is in settings.ts.

import type { StorageMode } from "./format.ts";
import { type TagGroup, cleanTagList, normalizeGroups } from "./groups.ts";
import { type BookmarkTab, normalizeTabs } from "./tabs.ts";
import { DEFAULT_STOP_WORDS } from "./naming.ts";
import { type AutoTagRule, cleanFolder, normalizeRules } from "./inbox.ts";

export interface TagEverythingSettings {
  /** Where new file tags go. Folder tags always go to `<folder>/.ts/tsm.json`. */
  storage: StorageMode;
  /** Markdown notes: new tags go to the frontmatter `tags` property instead of `storage`. */
  noteTagsInFrontmatter: boolean;
  lowercase: boolean;
  /** Tag naming rule (src/naming.ts): new tags must be lower-case single words, no liaison word. */
  tagRule: boolean;
  /** Liaison words refused as tags while `tagRule` is on (space / comma separated). */
  stopWords: string;
  /** Every file also carries its extension as a tag (`pdf`, `md`), read from its name, never written. */
  extensionTags: boolean;
  showBadges: boolean;
  /** Tags without a sidecar colour get a stable colour picked from their name. */
  autoColors: boolean;
  /** "sidecar": hide badges for tags already readable in the file name. */
  badgeScope: "all" | "sidecar";
  /** Move `.ts/<name>.json` and `.ts/<name>.jpg` along when a file is renamed or moved in Obsidian. */
  followRenames: boolean;
  /** Claude Code program for tag suggestions; empty = `claude` on the PATH, then `~/.local/bin`. */
  claudeCommand: string;
  /** Model Claude Code uses for tag suggestions (`sonnet`, `haiku`...); empty = Claude Code's own default. */
  claudeModel: string;
  /** Auto-tag rules (src/inbox.ts): offered in the inbox, applied to new files when `autoApplyRules` is on. */
  rules: AutoTagRule[];
  /** A file created in the vault gets the tags of the rules it matches, without asking. */
  autoApplyRules: boolean;
  /** The inbox lists the untagged files that arrived in the last this many days. */
  inboxDays: number;
  /** The inbox lists only the files inside this vault folder, at any depth ("" = the whole vault). */
  inboxFolder: string;
  /** Paths the user dismissed from the inbox (no tag needed). */
  inboxDismissed: string[];
  /** Tag groups of the TagEverything panel (src/groups.ts). Edited in the panel, not in the settings tab. */
  groups: TagGroup[];
  /** Bookmark tabs of the TagEverything panel (src/tabs.ts). Edited in the panel. */
  tabs: BookmarkTab[];
}

export const DEFAULT_SETTINGS: TagEverythingSettings = {
  storage: "filename",
  noteTagsInFrontmatter: true,
  lowercase: false,
  tagRule: true,
  stopWords: DEFAULT_STOP_WORDS,
  extensionTags: true,
  showBadges: true,
  autoColors: true,
  badgeScope: "all",
  followRenames: true,
  claudeCommand: "",
  claudeModel: "",
  rules: [],
  autoApplyRules: false,
  inboxDays: 30,
  inboxFolder: "",
  inboxDismissed: [],
  groups: [],
  tabs: [],
};

/**
 * Settings from whatever `data.json` holds: a value of the wrong type or out of range falls back to its default,
 * never throws. Unknown keys are kept (a newer version may have written them).
 */
export function normalizeSettings(raw: unknown): TagEverythingSettings {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  const bool = (k: keyof TagEverythingSettings): boolean => (typeof r[k] === "boolean" ? r[k] : (d[k] as boolean));
  const text = (k: "claudeCommand" | "claudeModel"): string => (typeof r[k] === "string" ? r[k].trim() : d[k]);
  const groups = normalizeGroups(r.groups);
  return {
    ...r,
    storage: r.storage === "filename" || r.storage === "sidecar" ? r.storage : d.storage,
    noteTagsInFrontmatter: bool("noteTagsInFrontmatter"),
    lowercase: bool("lowercase"),
    tagRule: bool("tagRule"),
    stopWords: typeof r.stopWords === "string" && r.stopWords.trim() ? r.stopWords : d.stopWords,
    extensionTags: bool("extensionTags"),
    showBadges: bool("showBadges"),
    autoColors: bool("autoColors"),
    badgeScope: r.badgeScope === "all" || r.badgeScope === "sidecar" ? r.badgeScope : d.badgeScope,
    followRenames: bool("followRenames"),
    claudeCommand: text("claudeCommand"),
    claudeModel: text("claudeModel"),
    rules: normalizeRules(r.rules),
    autoApplyRules: bool("autoApplyRules"),
    inboxDays: typeof r.inboxDays === "number" && Number.isInteger(r.inboxDays) && r.inboxDays >= 1 && r.inboxDays <= 365 ? r.inboxDays : d.inboxDays,
    inboxFolder: typeof r.inboxFolder === "string" ? cleanFolder(r.inboxFolder) : d.inboxFolder,
    inboxDismissed: cleanTagList(r.inboxDismissed),
    groups,
    tabs: normalizeTabs(r.tabs, groups.map((g) => g.id)),
  };
}
