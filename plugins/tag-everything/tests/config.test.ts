import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/config.ts";
import { claudeTook, failureMessage, plural, progressMessage } from "../src/messages.ts";

test("normalizeSettings: missing or broken data gives the defaults", () => {
  for (const raw of [null, undefined, 42, "x", [], {}]) assert.deepEqual(normalizeSettings(raw), DEFAULT_SETTINGS);
});

test("normalizeSettings: valid values kept, wrong types and ranges fixed, unknown keys kept", () => {
  const s = normalizeSettings({
    storage: "sidecar",
    lowercase: true,
    showBadges: "yes",
    badgeScope: "nope",
    groups: [{ name: "G", tags: ["a"] }, "junk"],
    future: 1,
  });
  assert.equal(s.storage, "sidecar");
  assert.equal(s.lowercase, true);
  assert.equal(s.showBadges, DEFAULT_SETTINGS.showBadges);
  assert.equal(s.badgeScope, "all");
  assert.equal(normalizeSettings({ storage: "cloud" }).storage, "filename");
  assert.deepEqual(s.groups.map((g) => g.name), ["G"]);
  assert.equal((s as unknown as Record<string, unknown>).future, 1);
});

test("normalizeSettings: naming rule on by default, stop words repaired", () => {
  assert.equal(DEFAULT_SETTINGS.tagRule, true);
  assert.equal(normalizeSettings({ tagRule: false }).tagRule, false);
  assert.equal(normalizeSettings({ tagRule: "no" }).tagRule, true);
  // extension tags: on by default (also for a data.json written before the setting existed), off kept
  assert.equal(normalizeSettings({ tagRule: false }).extensionTags, true);
  assert.equal(normalizeSettings({ extensionTags: false }).extensionTags, false);
  assert.equal(normalizeSettings({ stopWords: "foo bar" }).stopWords, "foo bar");
  assert.equal(normalizeSettings({ stopWords: "  " }).stopWords, DEFAULT_SETTINGS.stopWords);
  assert.equal(normalizeSettings({ stopWords: 3 }).stopWords, DEFAULT_SETTINGS.stopWords);
});

test("normalizeSettings: ignored names default to the lists, an emptied box stays empty, wrong types repaired", () => {
  const old = normalizeSettings({ tagRule: true }); // a data.json from before the setting
  assert.match(old.excludedFolders, /\.\*.*__pycache__/);
  assert.match(old.excludedFiles, /^\.\*/);
  assert.match(old.excludedExtensions, /tmp/);
  assert.equal(normalizeSettings({ excludedFolders: "" }).excludedFolders, "", "nothing ignored by folder is a choice");
  assert.equal(normalizeSettings({ excludedFiles: "x" }).excludedFiles, "x");
  assert.equal(normalizeSettings({ excludedExtensions: 3 }).excludedExtensions, DEFAULT_SETTINGS.excludedExtensions);
});

test("normalizeSettings: kept folder names empty by default, cleaned like paths", () => {
  assert.deepEqual(normalizeSettings({ tagRule: true }).keptFolderNames, []);
  assert.deepEqual(normalizeSettings({ keptFolderNames: ["/1. Projects/", "1. Projects", 3, " "] }).keptFolderNames, ["1. Projects"]);
  assert.deepEqual(normalizeSettings({ keptFolderNames: "junk" }).keptFolderNames, []);
});

test("normalizeSettings: archives hidden by default, tagged archive or archives; an emptied list stays empty", () => {
  const old = normalizeSettings({ tagRule: true }); // a data.json from before the setting
  assert.equal(old.showArchived, false);
  assert.equal(old.archiveTags, "archive, archives");
  assert.equal(normalizeSettings({ showArchived: true }).showArchived, true);
  assert.equal(normalizeSettings({ showArchived: "yes" }).showArchived, false);
  assert.equal(normalizeSettings({ archiveTags: "" }).archiveTags, "", "archiving turned off is a choice");
  assert.equal(normalizeSettings({ archiveTags: 1 }).archiveTags, DEFAULT_SETTINGS.archiveTags);
});

test("normalizeSettings: Claude Code program and model, empty by default, trimmed", () => {
  assert.equal(DEFAULT_SETTINGS.claudeCommand, "");
  assert.equal(normalizeSettings({}).claudeModel, "");
  assert.equal(normalizeSettings({ claudeCommand: " C:\\bin\\claude.exe " }).claudeCommand, "C:\\bin\\claude.exe");
  assert.equal(normalizeSettings({ claudeModel: 4 }).claudeModel, "");
});

test("normalizeSettings never shares the default groups array", () => {
  const a = normalizeSettings({});
  a.groups.push({ id: "g1", name: "x", tags: [], collapsed: false });
  assert.equal(DEFAULT_SETTINGS.groups.length, 0);
  assert.equal(normalizeSettings({}).groups.length, 0);
});

test("messages", () => {
  assert.equal(plural(1, "item"), "1 item");
  assert.equal(plural(0, "item"), "0 items");
  assert.equal(progressMessage(3, 40), "TagEverything: tagging 3 of 40 items…");
  const few = failureMessage(["a: x", "b: y"], 3);
  assert.equal(few, "TagEverything: tags not changed on 2 of 3 items:\na: x\nb: y");
  const many = failureMessage(Array.from({ length: 8 }, (_, i) => `f${i}`), 10);
  assert.match(many, /f4\n…and 3 more/);
  assert.doesNotMatch(many, /f5/);
});

test("normalizeSettings: inbox and auto-tag rules repaired, off by default", () => {
  const d = normalizeSettings({});
  assert.equal(d.autoApplyRules, false);
  assert.equal(d.inboxDays, 30);
  assert.deepEqual(d.rules, []);
  const s = normalizeSettings({ inboxDays: 0, inboxDismissed: ["a.pdf", 3, "a.pdf"], rules: [{ id: "r1", extensions: "pdf", tags: ["scan"] }, { tags: ["x"] }] });
  assert.equal(s.inboxDays, 30);
  assert.deepEqual(s.inboxDismissed, ["a.pdf"]);
  assert.deepEqual(s.rules.map((r) => r.id), ["r1"]);
  assert.equal(normalizeSettings({ inboxDays: 7 }).inboxDays, 7);
  assert.equal(d.inboxFolder, "");
  assert.equal(normalizeSettings({ inboxFolder: 3 }).inboxFolder, "");
  assert.equal(normalizeSettings({ inboxFolder: " \\Downloads\\Scans/ " }).inboxFolder, "Downloads/Scans");
});

test("claudeTook: time and cost when known", () => {
  assert.equal(claudeTook(4200, 0.031), "4 s, API cost $0.03");
  assert.equal(claudeTook(null, null), "");
});

test("normalizeSettings: the All tab's count range, off by default with 10–100 ready, damaged values back to it", () => {
  const d = normalizeSettings({});
  assert.deepEqual([d.tagRangeOn, d.tagRangeMin, d.tagRangeMax], [false, 10, 100]);
  const kept = normalizeSettings({ tagRangeOn: true, tagRangeMin: 2, tagRangeMax: 0 });
  assert.deepEqual([kept.tagRangeOn, kept.tagRangeMin, kept.tagRangeMax], [true, 2, 0], "0 = no upper limit");
  const bad = normalizeSettings({ tagRangeOn: "yes", tagRangeMin: 0, tagRangeMax: 2.5 });
  assert.deepEqual([bad.tagRangeOn, bad.tagRangeMin, bad.tagRangeMax], [false, 10, 100]);
  assert.equal(normalizeSettings({ tagRangeMax: -1 }).tagRangeMax, 100);
});

test("explorerInheritedTags: off by default, a boolean kept, anything else back to off", () => {
  assert.equal(DEFAULT_SETTINGS.explorerInheritedTags, false);
  assert.equal(normalizeSettings({}).explorerInheritedTags, false);
  assert.equal(normalizeSettings({ explorerInheritedTags: true }).explorerInheritedTags, true);
  assert.equal(normalizeSettings({ explorerInheritedTags: 1 }).explorerInheritedTags, false);
});

test("skipShortNumbers: on by default (older data.json too), a boolean kept, anything else back to on", () => {
  assert.equal(DEFAULT_SETTINGS.skipShortNumbers, true);
  assert.equal(normalizeSettings({}).skipShortNumbers, true);
  assert.equal(normalizeSettings({ skipShortNumbers: false }).skipShortNumbers, false);
  assert.equal(normalizeSettings({ skipShortNumbers: "no" }).skipShortNumbers, true);
});

test("panelExtensionTags: off by default, a boolean kept, anything else back to off", () => {
  assert.equal(normalizeSettings({}).panelExtensionTags, false);
  assert.equal(normalizeSettings({ panelExtensionTags: true }).panelExtensionTags, true);
  assert.equal(normalizeSettings({ panelExtensionTags: "yes" }).panelExtensionTags, false);
});
