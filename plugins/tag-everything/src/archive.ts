// Archived items. Pure, no `obsidian` import (unit-tested under node --test).
//
// An item carrying an archive tag (setting `archiveTags`), its own or an inherited one (a folder tagged `archive`, or
// named `4. Archives`, passes it to everything inside), is archived. While the setting `showArchived` is off (the
// default), archived items are hidden from what the user browses: the panel, the TagEverything explorer, its inbox and
// query blocks. One switch, shown in each of them (src/archive-toggle.ts). Maintenance (rename, checks, reviews,
// rules, the AI guide) still sees them: their tags are real tags of the vault.

/** Archive tags by default: both forms, since a folder named `Archives` gives `archives`. */
export const DEFAULT_ARCHIVE_TAGS = "archive, archives";

/** The archive tags of the setting: comma or space separated, lower case, without `#`; once each. */
export function archiveTagSet(text: string): ReadonlySet<string> {
  return new Set(
    text
      .split(/[\s,;]+/)
      .map((t) => t.replace(/^#+/, "").toLowerCase())
      .filter(Boolean),
  );
}

/** Does an item with these tags (stored and inherited) carry an archive tag? Case ignored. */
export function isArchived(tags: readonly string[], archive: ReadonlySet<string>): boolean {
  return archive.size > 0 && tags.some((t) => archive.has(t.toLowerCase()));
}

/** A tag with no item shown: no item carries it, or (`archivedOnly`) only hidden archived items do. */
export function missingTagLabel(archivedOnly: boolean): string {
  return archivedOnly ? "Only archived items carry this tag: the archive switch shows them" : "No file or folder carries this tag";
}

/** The switch's tooltip: what it does now, and which tags archive an item. */
export function archiveToggleLabel(archive: ReadonlySet<string>, shown: boolean): string {
  const tags = [...archive].join(", ");
  return shown ? `Archived items shown (tagged ${tags}): click to hide them` : `Archived items hidden (tagged ${tags}): click to show them`;
}
