// Settings data: shape, defaults and loading. Pure, no `obsidian` import (unit-tested under node --test).
// The settings tab is in settings.ts.

import type { StorageMode } from "./format.ts";
import { type TagGroup, normalizeGroups } from "./groups.ts";

export interface TagEverythingSettings {
  /** Where new file tags go. Folder tags always go to `<folder>/.ts/tsm.json`. */
  storage: StorageMode;
  /** Markdown notes: new tags go to the frontmatter `tags` property instead of `storage`. */
  noteTagsInFrontmatter: boolean;
  lowercase: boolean;
  showBadges: boolean;
  /** Tags without a sidecar colour get a stable colour picked from their name. */
  autoColors: boolean;
  /** "sidecar": hide badges for tags already readable in the file name. */
  badgeScope: "all" | "sidecar";
  maxBadges: number;
  /** Move `.ts/<name>.json` and `.ts/<name>.jpg` along when a file is renamed or moved in Obsidian. */
  followRenames: boolean;
  /** Tag groups of the File tags panel (src/groups.ts). Edited in the panel, not in the settings tab. */
  groups: TagGroup[];
}

export const MIN_BADGES = 1;
export const MAX_BADGES = 10;

export const DEFAULT_SETTINGS: TagEverythingSettings = {
  storage: "filename",
  noteTagsInFrontmatter: true,
  lowercase: false,
  showBadges: true,
  autoColors: true,
  badgeScope: "all",
  maxBadges: 4,
  followRenames: true,
  groups: [],
};

/**
 * Settings from whatever `data.json` holds: a value of the wrong type or out of range falls back to its default,
 * never throws. Unknown keys are kept (a newer version may have written them).
 */
export function normalizeSettings(raw: unknown): TagEverythingSettings {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  const bool = (k: keyof TagEverythingSettings): boolean => (typeof r[k] === "boolean" ? r[k] :(d[k] as boolean));
  const max = typeof r.maxBadges === "number" && Number.isFinite(r.maxBadges) ? Math.round(r.maxBadges) : d.maxBadges;
  return {
    ...r,
    storage: r.storage === "filename" || r.storage === "sidecar" ? r.storage : d.storage,
    noteTagsInFrontmatter: bool("noteTagsInFrontmatter"),
    lowercase: bool("lowercase"),
    showBadges: bool("showBadges"),
    autoColors: bool("autoColors"),
    badgeScope: r.badgeScope === "all" || r.badgeScope === "sidecar" ? r.badgeScope : d.badgeScope,
    maxBadges: Math.min(MAX_BADGES, Math.max(MIN_BADGES, max)),
    followRenames: bool("followRenames"),
    groups: normalizeGroups(r.groups),
  };
}
