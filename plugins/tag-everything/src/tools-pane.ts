import { Setting } from "obsidian";
import { plural } from "./messages.ts";
import { RuleModal } from "./rule-modal.ts";
import { TagPickerModal } from "./curator.ts";
import { openBetterPlaces } from "./putaway-modal.ts";
import type TagEverythingPlugin from "./main.ts";

/**
 * The Tools tab of the tags panel (src/view.ts): the vault-wide tag actions, one row each (what it does, a button).
 * Settings hold only options; the actions live here, in the right-click menu (on chosen items) and as commands.
 */
export function renderTools(el: HTMLElement, plugin: TagEverythingPlugin): void {
  el.empty();
  const box = el.createDiv({ cls: "tag-everything-tools" });
  const { app } = plugin;
  const row = (name: string, desc: string, label: string, run: () => void, action: string): Setting =>
    new Setting(box)
      .setName(name)
      .setDesc(desc)
      .addButton((b) => {
        b.setButtonText(label).onClick(run);
        b.buttonEl.dataset.action = action;
      });

  row("Re-read all tags", "Rebuilds the tag index, e.g. after tags were edited outside Obsidian.", "Re-read", () => void plugin.reindex(), "reindex");

  const { rules } = plugin.settings;
  const targets = plugin.ruleTargets([app.vault.getRoot()]);
  const apply = row(
    "Apply auto-tag rules",
    rules.length
      ? `${plural(rules.length, "rule")}; ${plural(targets.size, "file")} of the vault would get tags. Rules only add tags. On a folder or a selection: right-click → TagEverything.`
      : "No auto-tag rule yet: a rule gives tags to the files it matches (folder, words of the name, extension).",
    targets.size ? `Apply to ${plural(targets.size, "file")}` : "Apply",
    () => void plugin.applyRulesTo([app.vault.getRoot()]),
    "apply-rules",
  );
  apply.setDisabled(!targets.size);
  apply.addButton((b) => b.setButtonText("New rule…").onClick(() => new RuleModal(app, plugin).open()));

  row(
    "Check and fix tag names",
    "Re-reads every tag, then lists those breaking the naming rule with a fix you can edit; nothing changes until you click Fix.",
    "Check…",
    () => void plugin.checkTagNames(),
    "check-names",
  );
  row(
    "Review tags",
    "Look-alike tags (case, accents, plural, typos), synonyms found by Claude Code, tags used once: merge or remove them in one go.",
    "Review…",
    () => void plugin.reviewTags(),
    "review",
  );
  row(
    "Check tag consistency",
    "Files missing a tag that nearly all the files of their folder carry, or carrying a misspelled one. On one folder: right-click → TagEverything.",
    "Check…",
    () => void plugin.checkConsistency(),
    "consistency",
  );
  row(
    "Suggest better places",
    "Tagged files whose tags fit another folder better than their own, from where the files with the same tags are. Nothing moves until you tick a file. The inbox lists the files waiting in the inbox folder.",
    "Suggest…",
    () => void openBetterPlaces(plugin),
    "better-places",
  );
  row("Rename or merge a tag", "Everywhere in the vault, with the tag groups, sections and searches following.", "Rename…", () => new TagPickerModal(app, plugin).open(), "rename");
}
