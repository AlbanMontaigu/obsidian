import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { type NamingRule, type TagIssue, auditTags, parseReplacement } from "./naming.ts";
import { plural } from "./messages.ts";
import type TagEverythingPlugin from "./main.ts";

interface Row {
  issue: TagIssue;
  checkbox: HTMLInputElement;
  input: HTMLInputElement;
  errorEl: HTMLElement;
}

/**
 * "Check tag names": every tag of the vault that breaks the naming rule, with its suggested fix (editable; empty =
 * remove the tag). Fix rewrites the checked tags on every item that carries them, where they are, through
 * `plugin.replaceTags` (renames go through Obsidian, so links follow).
 */
export class TagFixModal extends Modal {
  private rows: Row[] = [];
  private fixButton: ButtonComponent | null = null;

  constructor(
    app: App,
    private plugin: TagEverythingPlugin,
    private rule: NamingRule,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("tag-everything-fix-modal");
    this.setTitle("Check tag names");
    const counts = this.plugin.index.counts();
    const issues = auditTags(counts, this.rule);
    contentEl.createDiv({
      cls: "tag-everything-where",
      text: "Tags are lower-case single words: no space, - or _ (two tags instead), no liaison word (de, the…).",
    });
    if (!issues.length) {
      contentEl.createDiv({ cls: "tag-everything-fix-summary", text: `All ${plural(counts.size, "tag")} follow the rule.` });
      new Setting(contentEl).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
      return;
    }
    const items = issues.reduce((n, i) => n + i.count, 0);
    contentEl.createDiv({
      cls: "tag-everything-fix-summary",
      text: `${plural(issues.length, "tag")} of ${counts.size} break the rule (${plural(items, "use")}). Check the fixes, edit them if needed (several tags: separate with spaces; empty: the tag is removed), then fix.`,
    });

    const list = contentEl.createDiv({ cls: "tag-everything-fix-list" });
    for (const issue of issues) this.rows.push(this.renderRow(list, issue));

    new Setting(contentEl)
      .setDesc("Files whose name holds a fixed tag are renamed (links follow). Tag groups and bookmark tabs follow too.")
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        this.fixButton = b.setCta().onClick(() => void this.fix());
      });
    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderRow(list: HTMLElement, issue: TagIssue): Row {
    const el = list.createDiv({ cls: "tag-everything-fix-row" });
    const checkbox = el.createEl("input", { type: "checkbox", attr: { "aria-label": `Fix ${issue.tag}` } });
    checkbox.checked = issue.fix !== null;
    const from = el.createDiv({ cls: "tag-everything-fix-from" });
    const chip = from.createSpan({ cls: "tag-everything-chip", text: issue.tag });
    const color = this.plugin.index.colorFor(issue.tag);
    if (color) chip.setCssProps({ "--tag-everything-color": color });
    from.createSpan({ cls: "tag-everything-fix-count", text: `×${issue.count}` });
    from.createDiv({ cls: "tag-everything-fix-problem", text: issue.problem });
    el.createSpan({ cls: "tag-everything-fix-arrow", text: "→" });
    const to = el.createDiv({ cls: "tag-everything-fix-to" });
    const input = to.createEl("input", {
      type: "text",
      cls: "tag-everything-fix-input",
      value: issue.fix?.join(" ") ?? "",
      attr: { placeholder: issue.fix === null ? "Type the new tags" : "(the tag is removed)", spellcheck: "false", "data-tag": issue.tag },
    });
    const errorEl = to.createDiv({ cls: "tag-everything-error" });
    const row = { issue, checkbox, input, errorEl };
    checkbox.addEventListener("change", () => this.refresh());
    input.addEventListener("input", () => {
      if (!checkbox.checked && input.value.trim()) checkbox.checked = true;
      this.refresh();
    });
    return row;
  }

  /** Validates every checked row and updates the Fix button. */
  private refresh(): boolean {
    let checked = 0;
    let valid = true;
    for (const row of this.rows) {
      const r = parseReplacement(row.input.value, this.rule);
      const error = row.checkbox.checked && "error" in r ? r.error : "";
      row.errorEl.setText(error);
      row.input.toggleClass("is-invalid", !!error);
      if (row.checkbox.checked) {
        checked++;
        if (error) valid = false;
      }
    }
    this.fixButton?.setButtonText(checked ? `Fix ${plural(checked, "tag")}` : "Fix").setDisabled(!checked || !valid);
    return checked > 0 && valid;
  }

  /** The checked rows as a tag -> replacements map. */
  mapping(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const row of this.rows) {
      if (!row.checkbox.checked) continue;
      const r = parseReplacement(row.input.value, this.rule);
      if ("tags" in r) out.set(row.issue.tag, r.tags);
    }
    return out;
  }

  async fix(): Promise<void> {
    if (!this.refresh()) return;
    const mapping = this.mapping();
    this.close();
    try {
      const { items, failed } = await this.plugin.replaceTags(mapping);
      // Failures already have their own notice (one line per item).
      if (!failed) new Notice(`File tags: ${plural(mapping.size, "tag")} fixed on ${plural(items, "item")}.`);
    } catch (err) {
      console.error("[tag-everything] fixing tag names failed", err);
      new Notice("File tags: fixing the tag names failed; details in the developer console.");
    }
  }
}
