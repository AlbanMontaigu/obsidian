import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ARCHIVE_TAGS, archiveTagSet, archiveToggleLabel, isArchived, missingTagLabel } from "../src/archive.ts";

test("archiveTagSet: comma or space separated, lower case, without #, once each", () => {
  assert.deepEqual([...archiveTagSet(DEFAULT_ARCHIVE_TAGS)], ["archive", "archives"]);
  assert.deepEqual([...archiveTagSet(" #Old, archive  ARCHIVE;done ")], ["old", "archive", "done"]);
  assert.equal(archiveTagSet("  ").size, 0);
});

test("isArchived: any archive tag among the item's tags (stored or inherited), case ignored", () => {
  const archive = archiveTagSet(DEFAULT_ARCHIVE_TAGS);
  assert.ok(isArchived(["md", "projects", "archives"], archive), "inherited from a folder named Archives");
  assert.ok(isArchived(["Archive"], archive));
  assert.ok(!isArchived(["archived", "archiver"], archive), "a whole tag, not a part of one");
  assert.ok(!isArchived(["archive"], new Set()), "no archive tag: nothing is archived");
});

test("labels: the switch says what a click does and which tags archive; a tag only archived items carry", () => {
  const archive = archiveTagSet("archive");
  assert.equal(archiveToggleLabel(archive, false), "Archived items hidden (tagged archive): click to show them");
  assert.equal(archiveToggleLabel(archive, true), "Archived items shown (tagged archive): click to hide them");
  assert.match(missingTagLabel(true), /Only archived items/);
  assert.equal(missingTagLabel(false), "No file or folder carries this tag");
});
