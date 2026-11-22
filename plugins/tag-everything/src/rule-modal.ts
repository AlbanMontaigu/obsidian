import { App, ButtonComponent, Modal, Setting, TFile } from "obsidian";
import { FolderSuggest, FormulaTagSuggest } from "./dialogs.ts";
import { type AutoTagRule, cleanFolder, deleteRule, describeConditions, describeRule, hasCondition, ruleMatches, saveRule } from "./inbox.ts";
import { excludeRuleMatches } from "./exclude.ts";
import { PLUGIN_NAME, plural } from "./messages.ts";
import { parseReplacement } from "./naming.ts";
import type TagEverythingPlugin from "./main.ts";

/** What the dialog starts with: a rule to edit (with its id), or the fields of a new one (prefilled from a file). */
export type RuleDraft = Partial<AutoTagRule>;

/** An auto-tag rule (adds tags) or an exclusion rule (src/exclude.ts: the items it covers leave TagEverything). */
export type RuleKind = "tag" | "exclude";

/**
 * Creates or edits an auto-tag rule: a folder, words of the name, extensions (each optional, at least one), and the
 * tags to add. A live line says how many files of the vault it matches, and how many of them have no tag yet.
 * Saved in the settings (`rules`); `onSaved` runs after (the settings list redraws). With `kind` "exclude", the same
 * conditions without tags make an exclusion rule (`excludeRules`).
 */
export class RuleModal extends Modal {
  private fields!: Record<"folder" | "words" | "extensions" | "tags", HTMLInputElement>;
  private previewEl!: HTMLElement;
  private saveButton: ButtonComponent | null = null;

  constructor(
    app: App,
    private plugin: TagEverythingPlugin,
    private draft: RuleDraft = {},
    private onSaved: () => void = () => undefined,
    private kind: RuleKind = "tag",
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, draft, plugin } = this;
    this.modalEl.addClass("tag-everything-dialog", "tag-everything-rule-modal");
    const exclude = this.kind === "exclude";
    this.setTitle(`${PLUGIN_NAME}: ${draft.id ? "edit" : "new"} ${exclude ? "exclusion" : "auto-tag"} rule`);
    contentEl.createDiv({
      cls: "tag-everything-where",
      text: exclude
        ? "A file matching every condition you fill is excluded: TagEverything ignores it and leaves its tags as they are. A folder alone also excludes that folder and everything in it."
        : "A file matching every condition you fill gets the tags. Leave a condition empty to ignore it.",
    });
    const field = (name: string, desc: string, value: string, placeholder: string): HTMLInputElement => {
      let input!: HTMLInputElement;
      new Setting(contentEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) => {
          input = t.setValue(value).setPlaceholder(placeholder).inputEl;
          input.spellcheck = false;
          input.addEventListener("input", () => this.refresh());
        });
      return input;
    };
    this.fields = {
      folder: field("In folder", "At any depth. Empty: anywhere in the vault.", draft.folder ?? "", "Finance/Bank"),
      words: field("Name contains", "One of these words; case and accents ignored. Empty: any name.", draft.words ?? "", "invoice facture"),
      extensions: field("Extension", "One of these. Empty: any file.", draft.extensions ?? "", "pdf docx"),
      tags: field("Add the tags", "Separated by spaces.", (draft.tags ?? []).join(" "), "bank invoice"),
    };
    if (exclude) this.fields.tags.closest(".setting-item")?.addClass("tag-everything-hidden");
    new FolderSuggest(this.app, this.fields.folder);
    const own = (): ReadonlyMap<string, number> => plugin.index.counts(undefined, true);
    new FormulaTagSuggest(this.app, this.fields.tags, () => plugin.index.ranked().filter((t) => own().has(t)), (t) => own().get(t) ?? 0);
    this.previewEl = contentEl.createDiv({ cls: "tag-everything-rule-preview" });

    const buttons = new Setting(contentEl);
    if (draft.id) buttons.addButton((b) => b.setButtonText("Delete rule").setWarning().onClick(() => void this.remove()));
    buttons
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        this.saveButton = b.setButtonText("Save").setCta().onClick(() => void this.save());
      });
    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** The rule as typed, or why it can't be saved. */
  private rule(): AutoTagRule | { error: string } {
    const f = this.fields;
    const exclude = this.kind === "exclude";
    const tags = exclude ? { tags: [] } : parseReplacement(f.tags.value, this.plugin.rule);
    if ("error" in tags) return tags;
    const rule = { id: this.draft.id ?? "", folder: cleanFolder(f.folder.value), words: f.words.value.trim(), extensions: f.extensions.value.trim(), tags: tags.tags };
    if (!hasCondition(rule)) return { error: "Fill at least one condition: a folder, words or extensions." };
    if (!exclude && !rule.tags.length) return { error: "Type the tags to add." };
    return rule;
  }

  private refresh(): void {
    const rule = this.rule();
    this.saveButton?.setDisabled("error" in rule);
    if ("error" in rule) {
      this.previewEl.setText(rule.error);
      this.previewEl.addClass("tag-everything-error");
      return;
    }
    this.previewEl.removeClass("tag-everything-error");
    const index = this.plugin.index;
    if (this.kind === "exclude") {
      const files = this.app.vault.getFiles().filter((f: TFile) => excludeRuleMatches(rule, f.path, false));
      this.previewEl.setText(`${describeConditions(rule)}. Excludes ${plural(files.length, "file")} of the vault.`);
      return;
    }
    const files = this.app.vault.getFiles().filter((f: TFile) => ruleMatches(rule, f.path));
    const untagged = files.filter((f) => !index.ownTagsOf(f.path).length).length;
    this.previewEl.setText(`${describeRule(rule)}. Matches ${plural(files.length, "file")} of the vault, ${untagged} without tags.`);
  }

  /** Saves the rule in the settings (public for the smoke test). */
  async save(): Promise<void> {
    const rule = this.rule();
    if ("error" in rule) return;
    const { settings } = this.plugin;
    if (this.kind === "exclude") {
      const { folder, words, extensions } = rule;
      settings.excludeRules = saveRule(settings.excludeRules, { folder, words, extensions, id: this.draft.id }, "x");
      await this.plugin.exclusionsChanged();
    } else {
      settings.rules = saveRule(settings.rules, { ...rule, id: this.draft.id });
      await this.plugin.saveSettings();
    }
    this.close();
    this.onSaved();
  }

  private async remove(): Promise<void> {
    const id = this.draft.id;
    if (!id) return;
    const { settings } = this.plugin;
    if (this.kind === "exclude") {
      settings.excludeRules = deleteRule(settings.excludeRules, id);
      await this.plugin.exclusionsChanged();
    } else {
      settings.rules = deleteRule(settings.rules, id);
      await this.plugin.saveSettings();
    }
    this.close();
    this.onSaved();
  }
}
