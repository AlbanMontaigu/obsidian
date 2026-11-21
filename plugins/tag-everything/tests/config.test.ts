import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/config.ts";
import { failureMessage, plural, progressMessage } from "../src/messages.ts";

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
