import { App, ButtonComponent, Modal, Notice, Setting, TAbstractFile, TFile, TFolder, Vault } from "obsidian";
import { PLUGIN_NAME, claudeError, claudeTook, plural } from "./messages.ts";
import { type Suggestion, type SuggestInput, MAX_SUGGEST_ITEMS, cleanSuggestions, commonFolder, parseClaudeOutput, relativeTo, suggestPrompt } from "./suggest.ts";
import { GUIDE_FILE } from "./guide.ts";
import { clickable, paintTag } from "./ui.ts";
import type TagEverythingPlugin from "./main.ts";

/** What to ask Claude Code about: the items, and the folder it works in (its working directory). */
export interface SuggestRequest {
  folder: TFolder;
  items: TAbstractFile[];
  /** Items left out because there were too many. */
  skipped: number;
}

/**
 * Opens the Claude Code suggestions for a selection. A folder alone: the folder and the files under it (untagged
 * ones first, at most MAX_SUGGEST_ITEMS), Claude Code working in it. A file, or several items: those, Claude Code
 * working in their closest common folder. Items excluded from TagEverything are left out.
 */
export function openSuggestions(plugin: TagEverythingPlugin, selection: TAbstractFile[]): TagSuggestModal | null {
  const { app, index } = plugin;
  const { vault } = app;
  let folder: TFolder;
  let items: TAbstractFile[];
  if (selection.length === 1 && selection[0] instanceof TFolder) {
    folder = selection[0];
    const files: TFile[] = [];
    Vault.recurseChildren(folder, (f) => {
      if (f instanceof TFile && f.name !== GUIDE_FILE && !plugin.isExcluded(f)) files.push(f);
    });
    const tagged = (f: TFile): number => Number(index.ownTagsOf(f.path).length > 0);
    files.sort((a, b) => tagged(a) - tagged(b) || a.path.localeCompare(b.path));
    items = [...(folder.isRoot() || plugin.isExcluded(folder) ? [] : [folder]), ...files];
  } else {
    items = selection.filter((i) => plugin.taggable(i));
    const path = commonFolder(items.map((i) => i.path));
    const common = path ? vault.getAbstractFileByPath(path) : vault.getRoot();
    folder = common instanceof TFolder ? common : vault.getRoot();
  }
  if (!items.length) {
    new Notice(`${PLUGIN_NAME}: nothing to tag here.`);
    return null;
  }
  const modal = new TagSuggestModal(app, plugin, {
    folder,
    items: items.slice(0, MAX_SUGGEST_ITEMS),
    skipped: Math.max(0, items.length - MAX_SUGGEST_ITEMS),
  });
  modal.open();
  return modal;
}

interface Row {
  item: TAbstractFile;
  chips: { tag: string; el: HTMLElement }[];
}

/**
 * "Suggest tags with Claude Code": runs Claude Code on the items (src/suggest.ts builds the prompt, src/claude.ts
 * runs it), then lists the tags it suggests per item, each one a chip to switch off. Add writes the chips left on
 * through `plugin.addTagsEach` (the usual write path). Closing the dialog while Claude Code runs stops it.
 */
export class TagSuggestModal extends Modal {
  private abort = new AbortController();
  private rows: Row[] = [];
  private addButton: ButtonComponent | null = null;
  /** Resolves once the answer is shown (or the run failed); for the smoke test. */
  done: Promise<void> = Promise.resolve();

  constructor(
    app: App,
    private plugin: TagEverythingPlugin,
    private request: SuggestRequest,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tag-everything-dialog", "tag-everything-suggest-modal");
    this.setTitle(`${PLUGIN_NAME}: suggest tags with Claude Code`);
    const { folder, items, skipped } = this.request;
    const where = folder.isRoot() ? "the vault root" : folder.path;
    this.contentEl.createDiv({
      cls: "tag-everything-suggest-status",
      text: `Claude Code is reading ${plural(items.length, "item")} in ${where}…` +
        (skipped ? ` (${skipped} more left out: run it again on a subfolder or a selection)` : ""),
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
    this.done = this.run();
  }

  onClose(): void {
    this.abort.abort(); // stops Claude Code if it still runs
    this.contentEl.empty();
  }

  private async run(): Promise<void> {
    const { plugin, request } = this;
    const input: SuggestInput = {
      folder: request.folder.isRoot() ? "" : request.folder.path,
      items: request.items.map((item) => ({
        rel: relativeTo(request.folder.isRoot() ? "" : request.folder.path, item.path),
        isFolder: item instanceof TFolder,
        tags: plugin.index.ownTagsOf(item.path),
      })),
      dictionary: plugin.index.counts(undefined, true),
      tagRule: plugin.settings.tagRule,
      stopWords: plugin.settings.stopWords,
      lowercase: plugin.settings.lowercase,
    };
    try {
      const stdout = await plugin.runClaude(request.folder, suggestPrompt(input), this.abort.signal);
      const answer = parseClaudeOutput(stdout);
      const suggestions = cleanSuggestions(answer.items, input, plugin.rule);
      if (this.abort.signal.aborted) return;
      this.showResult(suggestions, answer.durationMs, answer.costUsd);
    } catch (err) {
      if (this.abort.signal.aborted) return; // closed by the user
      console.error("[tag-everything] Claude Code suggestion failed", err);
      this.showError(err as Error);
    }
  }

  private showError(err: Error): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createDiv({ cls: "tag-everything-error tag-everything-suggest-status", text: claudeError(err, "suggest tags") });
    new Setting(contentEl).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
  }

  private showResult(suggestions: Suggestion[], durationMs: number | null, costUsd: number | null): void {
    const { contentEl } = this;
    contentEl.empty();
    const total = suggestions.reduce((n, s) => n + s.tags.length, 0);
    const took = claudeTook(durationMs, costUsd);
    contentEl.createDiv({
      cls: "tag-everything-suggest-status",
      text: total
        ? `${plural(total, "tag")} suggested${took ? ` (${took})` : ""}. Click a tag to leave it out; dashed = new tag, not used in the vault yet.`
        : `Claude Code suggests no new tag${took ? ` (${took})` : ""}.`,
    });
    const list = contentEl.createDiv({ cls: "tag-everything-suggest-list" });
    suggestions.forEach((s, i) => this.rows.push(this.renderRow(list, this.request.items[i], s)));
    new Setting(contentEl)
      .setDesc("The tags are added where new tags go (settings); nothing is removed.")
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        this.addButton = b.setCta().onClick(() => void this.apply());
      });
    this.refresh();
  }

  private renderRow(list: HTMLElement, item: TAbstractFile, s: Suggestion): Row {
    const el = list.createDiv({ cls: "tag-everything-suggest-row" });
    const head = el.createDiv({ cls: "tag-everything-suggest-item" });
    head.createSpan({ cls: "tag-everything-suggest-name", text: item instanceof TFolder ? `${item.name}/` : item.name });
    if (s.rel !== item.name) head.createSpan({ cls: "tag-everything-suggest-path", text: s.rel === "." ? "this folder" : s.rel });
    for (const tag of this.plugin.index.ownTagsOf(item.path)) {
      const chip = head.createSpan({ cls: "tag-everything-chip is-small", text: tag });
      paintTag(chip, this.plugin.index.colorFor(tag));
    }
    const tagsEl = el.createDiv({ cls: "tag-everything-suggest-tags" });
    tagsEl.createSpan({ cls: "tag-everything-suggest-path", text: "Add:" });
    const chips = s.tags.map((tag) => {
      const chip = tagsEl.createSpan({ cls: "tag-everything-chip is-selected", text: tag, attr: { "aria-pressed": "true", "data-tag": tag } });
      if (s.fresh.has(tag)) {
        chip.addClass("is-new");
        chip.setAttr("title", "New tag: no item of the vault has it yet");
      }
      paintTag(chip, this.plugin.index.colorFor(tag));
      clickable(chip, () => {
        const on = !chip.hasClass("is-selected");
        chip.toggleClass("is-selected", on);
        chip.setAttr("aria-pressed", String(on));
        this.refresh();
      });
      return { tag, el: chip };
    });
    if (!chips.length) tagsEl.createSpan({ cls: "tag-everything-suggest-none", text: "no new tag" });
    return { item, chips };
  }

  /** The tags left on, per item (items without any are left out). */
  chosen(): Map<TAbstractFile, string[]> {
    const out = new Map<TAbstractFile, string[]>();
    for (const row of this.rows) {
      const tags = row.chips.filter((c) => c.el.hasClass("is-selected")).map((c) => c.tag);
      if (tags.length) out.set(row.item, tags);
    }
    return out;
  }

  private refresh(): void {
    const n = [...this.chosen().values()].reduce((sum, t) => sum + t.length, 0);
    this.addButton?.setButtonText(n ? `Add ${plural(n, "tag")}` : "Add").setDisabled(!n);
  }

  async apply(): Promise<void> {
    const chosen = this.chosen();
    if (!chosen.size) return;
    this.close();
    try {
      const failed = await this.plugin.addTagsEach(chosen);
      // Failures have their own notice; a batch of several items has its summary.
      if (!failed && chosen.size === 1) new Notice(`${PLUGIN_NAME}: tags added to ${[...chosen.keys()][0].name}.`);
    } catch (err) {
      console.error("[tag-everything] adding the suggested tags failed", err);
      new Notice(`${PLUGIN_NAME}: adding the suggested tags failed; details in the developer console.`);
    }
  }
}
