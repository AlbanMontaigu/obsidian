import { AbstractInputSuggest, App, Modal, Setting, TAbstractFile, TFile, TFolder, setIcon } from "obsidian";
import * as ts from "./format.ts";
import type { TagIndex } from "./index.ts";
import { TagEverythingSettings, targetFor } from "./settings.ts";

export interface TagEdit {
  added: string[];
  removed: string[];
}

class TagSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private input: HTMLInputElement,
    private source: () => string[],
    private counts: Map<string, number>,
    private onPick: (tag: string) => void,
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): string[] {
    // Nothing typed -> no list, so Enter on an empty box saves instead of picking the first suggestion.
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits = this.source().filter((t) => t.toLowerCase().includes(q));
    // Prefix matches first, the rest keep the index order (most used first).
    return hits.sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q))).slice(0, 50);
  }

  renderSuggestion(tag: string, el: HTMLElement): void {
    el.addClass("tag-everything-suggestion");
    el.createSpan({ text: tag });
    el.createSpan({ cls: "tag-everything-suggestion-count", text: String(this.counts.get(tag) ?? 0) });
  }

  selectSuggestion(tag: string): void {
    this.input.value = "";
    this.close();
    this.onPick(tag);
  }
}

/**
 * Chip editor for one or several items. Each chip is a tag; with several items, a tag that only some of
 * them carry is shown as a partial chip ("3/5"): leave it and those items keep it, click it to give it to
 * every item, remove it to strip it from all.
 */
export class TagEditorModal extends Modal {
  private chips: { tag: string; count: number }[] = [];
  private initial = new Map<string, number>();
  private chipsEl!: HTMLElement;
  private input!: HTMLInputElement;
  private errorEl!: HTMLElement;
  private previewEl: HTMLElement | null = null;
  private suggest: TagSuggest | null = null;

  constructor(
    app: App,
    private items: TAbstractFile[],
    private index: TagIndex,
    private settings: TagEverythingSettings,
    private onSubmit: (edit: TagEdit) => Promise<void>,
  ) {
    super(app);
    for (const item of items) for (const t of index.tagsOf(item.path)) this.initial.set(t, (this.initial.get(t) ?? 0) + 1);
    this.chips = [...this.initial].map(([tag, count]) => ({ tag, count }));
  }

  onOpen(): void {
    const { contentEl, items } = this;
    this.modalEl.addClass("tag-everything-modal");
    this.setTitle(items.length === 1 ? `Tags: ${items[0].name}` : `Tags: ${items.length} items`);

    contentEl.createDiv({ cls: "tag-everything-where", text: this.whereText() });

    const box = contentEl.createDiv({ cls: "tag-everything-input-box" });
    this.chipsEl = box.createDiv({ cls: "tag-everything-chips" });
    this.input = box.createEl("input", {
      type: "text",
      cls: "tag-everything-input",
      attr: { placeholder: "Add a tag… (Enter, space or comma)", spellcheck: "false" },
    });
    box.addEventListener("click", () => this.input.focus());

    this.errorEl = contentEl.createDiv({ cls: "tag-everything-error" });
    if (items.length === 1 && items[0] instanceof TFile) this.previewEl = contentEl.createDiv({ cls: "tag-everything-preview" });

    const counts = this.index.counts();
    this.suggest = new TagSuggest(
      this.app,
      this.input,
      () => this.index.ranked().filter((t) => !this.has(t)),
      counts,
      (tag) => {
        if (!this.has(tag)) this.chips.push({ tag, count: this.items.length });
        this.renderChips();
        this.input.focus();
      },
    );

    this.input.addEventListener("keydown", (evt) => this.onKey(evt));
    this.input.addEventListener("input", () => {
      if (/[\s,]/.test(this.input.value)) this.commitInput();
    });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Save")
          .setCta()
          .onClick(() => void this.save()),
      );

    this.renderChips();
    window.setTimeout(() => this.input.focus(), 0);
  }

  onClose(): void {
    this.suggest?.close();
    this.contentEl.empty();
  }

  private whereText(): string {
    const targets = new Set(this.items.map((i) => (i instanceof TFile ? targetFor(i, this.settings) : "folder")));
    const parts: string[] = [];
    if (targets.has("frontmatter")) parts.push("note tags go in the note's frontmatter (tags property)");
    if (targets.has("filename")) parts.push("file tags go in the file name");
    if (targets.has("sidecar")) parts.push("file tags go in .ts sidecar files");
    if (targets.has("folder")) parts.push("folder tags go in the folder's .ts/tsm.json");
    return parts.join(" · ");
  }

  /** Nested tags (`a/b`) can only be typed when every item stores them in its frontmatter. */
  private allFrontmatter(): boolean {
    return this.items.every((i) => i instanceof TFile && targetFor(i, this.settings) === "frontmatter");
  }

  private has(tag: string): boolean {
    return this.chips.some((c) => c.tag === tag);
  }

  private onKey(evt: KeyboardEvent): void {
    if (evt.defaultPrevented || evt.isComposing) return; // Enter / arrows already taken by the suggestion list
    if (evt.key === "Enter") {
      evt.preventDefault();
      if (this.input.value.trim()) this.commitInput();
      else void this.save();
    } else if (evt.key === "Backspace" && !this.input.value && this.chips.length) {
      this.chips.pop();
      this.renderChips();
    }
  }

  private commitInput(): void {
    const errors: string[] = [];
    for (const raw of ts.splitTagInput(this.input.value)) {
      const { tag, error } = ts.normalizeTag(raw, this.settings.lowercase, this.allFrontmatter());
      if (error) errors.push(error);
      else if (tag && !this.has(tag)) this.chips.push({ tag, count: this.items.length });
    }
    this.input.value = "";
    this.renderChips(errors.join(" · "));
  }

  private renderChips(error = ""): void {
    this.chipsEl.empty();
    const total = this.items.length;
    for (const chip of this.chips) {
      const partial = chip.count < total;
      const el = this.chipsEl.createDiv({ cls: "tag-everything-chip" + (partial ? " is-partial" : "") });
      const color = this.index.colorOf(chip.tag);
      if (color) el.style.setProperty("--tag-everything-color", color);
      el.createSpan({ text: chip.tag });
      if (partial) {
        el.createSpan({ cls: "tag-everything-chip-count", text: `${chip.count}/${total}` });
        el.setAttr("aria-label", "Only some items have this tag. Click to give it to all");
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          chip.count = total;
          this.renderChips();
        });
      }
      const x = el.createSpan({ cls: "tag-everything-chip-remove", attr: { "aria-label": "Remove" } });
      setIcon(x, "x");
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        this.chips = this.chips.filter((c) => c !== chip);
        this.renderChips();
      });
    }
    this.errorEl.setText(error);
    this.renderPreview();
  }

  private edit(): TagEdit {
    const total = this.items.length;
    return {
      added: this.chips.filter((c) => c.count === total && this.initial.get(c.tag) !== total).map((c) => c.tag),
      removed: [...this.initial.keys()].filter((t) => !this.has(t)),
    };
  }

  private renderPreview(): void {
    if (!this.previewEl) return;
    const item = this.items[0] as TFile;
    const { added, removed } = this.edit();
    const desired = ts.mergeEdit(this.index.tagsOf(item.path), added, removed);
    const entry = this.index.get(item.path);
    const plan = ts.planTags(
      { nameTags: ts.parseNameTags(item.name), sideTags: entry.side, frontTags: entry.front },
      desired,
      targetFor(item, this.settings),
    );
    this.previewEl.empty();
    if (!plan.renamed) return;
    try {
      const next = ts.setNameTags(item.name, plan.nameTags);
      this.previewEl.createSpan({ cls: "tag-everything-preview-label", text: "New name: " });
      this.previewEl.createSpan({ text: next });
    } catch (err) {
      this.previewEl.createSpan({ cls: "tag-everything-error", text: (err as Error).message });
    }
  }

  private async save(): Promise<void> {
    if (this.input.value.trim()) this.commitInput();
    if (this.errorEl.getText()) return;
    const edit = this.edit();
    this.close();
    if (edit.added.length || edit.removed.length) await this.onSubmit(edit);
  }
}

export function describe(items: TAbstractFile[]): string {
  if (items.length === 1) return items[0].name;
  const folders = items.filter((i) => i instanceof TFolder).length;
  return `${items.length} items` + (folders ? ` (${folders} folder${folders > 1 ? "s" : ""})` : "");
}
