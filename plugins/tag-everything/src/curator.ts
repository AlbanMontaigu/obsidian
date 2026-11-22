import { App, ButtonComponent, FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
import { FormulaTagSuggest } from "./dialogs.ts";
import { PLUGIN_NAME, claudeError, claudeTook, plural } from "./messages.ts";
import { parseReplacement } from "./naming.ts";
import { readClaudeResult } from "./suggest.ts";
import { type TagCluster, SYNONYM_TASK, cleanSynonyms, mergeMapping, rareTags, similarTags, synonymPrompt } from "./taxonomy.ts";
import { onEnter, paintTag } from "./ui.ts";
import type TagEverythingPlugin from "./main.ts";

// The tag curator's dialogs: rename or merge one tag everywhere, pick a tag to do it, and the tag review (look-alikes,
// Claude Code's synonyms, tags used once). Every change goes through `plugin.replaceTags`, the vault-wide engine of
// "Check tag names": a tag is rewritten where it is (name, frontmatter, sidecar), renames go through Obsidian.

/** Rewrites the vault, then says what happened (failures have their own notice). */
async function applyMapping(plugin: TagEverythingPlugin, mapping: Map<string, string[]>, done: (items: number) => string): Promise<void> {
  try {
    const { items, failed } = await plugin.replaceTags(mapping);
    if (!failed) new Notice(`${PLUGIN_NAME}: ${done(items)}`);
  } catch (err) {
    console.error("[tag-everything] changing tags failed", err);
    new Notice(`${PLUGIN_NAME}: changing the tags failed; details in the developer console.`);
  }
}

/** A tag chip with how many items carry it. */
function countedChip(plugin: TagEverythingPlugin, parent: HTMLElement, tag: string, count: number): void {
  const wrap = parent.createSpan({ cls: "tag-everything-counted" }); // the count never wraps away from its tag
  const chip = wrap.createSpan({ cls: "tag-everything-chip is-small", text: tag, attr: { "data-tag": tag } });
  paintTag(chip, plugin.index.colorFor(tag));
  wrap.createSpan({ cls: "tag-everything-fix-count", text: `×${count}` });
}

/**
 * "Rename or merge tag": one tag becomes another everywhere. Typing an existing tag merges into it (an item carrying
 * both keeps one), several words split it, an empty box removes it. The dialog says which before anything changes.
 */
export class RenameTagModal extends Modal {
  private input!: HTMLInputElement;
  private hint!: HTMLElement;
  private button: ButtonComponent | null = null;

  constructor(
    app: App,
    private plugin: TagEverythingPlugin,
    private tag: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, plugin, tag } = this;
    this.modalEl.addClass("tag-everything-rename-modal");
    this.setTitle(`${PLUGIN_NAME}: rename or merge a tag`);
    const counts = plugin.index.counts(undefined, true);
    const head = contentEl.createDiv({ cls: "tag-everything-rename-head" });
    countedChip(plugin, head, tag, counts.get(tag) ?? 0);
    head.createSpan({ text: " becomes:" });
    this.input = contentEl.createEl("input", { type: "text", cls: "tag-everything-group-input", value: tag, attr: { spellcheck: "false" } });
    new FormulaTagSuggest(this.app, this.input, () => plugin.index.ranked().filter((t) => counts.has(t) && t !== tag), (t) => counts.get(t) ?? 0);
    this.hint = contentEl.createDiv({ cls: "tag-everything-rename-hint" });
    contentEl.createDiv({
      cls: "tag-everything-where",
      text: "Files whose name holds the tag are renamed (links follow). Tag groups and bookmark tabs follow too.",
    });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        this.button = b.setCta().onClick(() => void this.apply());
      });
    this.input.addEventListener("input", () => this.refresh());
    onEnter(this.input, () => void this.apply());
    this.refresh();
    window.setTimeout(() => this.input.select(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** What the box means: the new tags, the button's label and the sentence saying what will happen; null when nothing to do. */
  private plan(): { tags: string[]; label: string; text: string } | { error: string } {
    const { plugin, tag } = this;
    const counts = plugin.index.counts(undefined, true);
    const on = plural(counts.get(tag) ?? 0, "item");
    const r = parseReplacement(this.input.value, plugin.rule);
    if ("error" in r) return r;
    const tags = r.tags;
    if (tags.length === 1 && tags[0] === tag) return { error: "Type the new name, or an existing tag to merge into." };
    if (!tags.length) return { tags, label: "Remove", text: `"${tag}" is removed from its ${on}.` };
    const existing = tags.filter((t) => t !== tag && counts.has(t));
    if (tags.length > 1) return { tags, label: "Split", text: `"${tag}" becomes ${tags.map((t) => `"${t}"`).join(" and ")} on its ${on}.` };
    if (existing.length) {
      return { tags, label: "Merge", text: `"${tag}" is merged into "${tags[0]}" (already on ${plural(counts.get(tags[0]) ?? 0, "item")}): its ${on} get "${tags[0]}", an item carrying both keeps one.` };
    }
    return { tags, label: "Rename", text: `"${tag}" becomes "${tags[0]}" on its ${on}.` };
  }

  private refresh(): void {
    const p = this.plan();
    this.hint.setText("error" in p ? p.error : p.text);
    this.hint.toggleClass("tag-everything-error", "error" in p);
    this.button?.setButtonText("error" in p ? "Rename" : p.label).setDisabled("error" in p);
  }

  /** Applies what the box says (public for the smoke test). */
  async apply(): Promise<void> {
    const p = this.plan();
    if ("error" in p) return;
    this.close();
    const { tag } = this;
    const what = !p.tags.length ? "removed" : p.label === "Merge" ? `merged into "${p.tags[0]}"` : `renamed to ${p.tags.map((t) => `"${t}"`).join(" ")}`;
    await applyMapping(this.plugin, new Map([[tag, p.tags]]), (items) => `"${tag}" ${what} on ${plural(items, "item")}.`);
  }
}

/** The command's tag picker: the vault's tags, most used first; picking one opens the rename dialog. */
export class TagPickerModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private plugin: TagEverythingPlugin,
  ) {
    super(app);
    this.setPlaceholder("Tag to rename or merge…");
  }

  getItems(): string[] {
    const own = this.plugin.index.counts(undefined, true);
    return this.plugin.index.ranked().filter((t) => own.has(t));
  }

  getItemText(tag: string): string {
    return tag;
  }

  onChooseItem(tag: string): void {
    this.plugin.renameTag(tag);
  }
}

interface ReviewRow {
  from: string[];
  checkbox: HTMLInputElement;
  input: HTMLInputElement;
  errorEl: HTMLElement;
}

/** Tags used once listed in the review, at most (each is looked up on every item). */
const MAX_RARE_ROWS = 300;

/**
 * "Review tags": the tags that probably mean the same thing, found locally (look-alikes) or by Claude Code (synonyms,
 * on demand: it reads the tag list only), and the tags used on one item. Each row: tick it, edit the tag to keep
 * (several: spaces; empty: removed), then Apply rewrites the vault through `plugin.replaceTags` in one pass.
 */
export class TagReviewModal extends Modal {
  private rows: ReviewRow[] = [];
  private applyButton: ButtonComponent | null = null;
  private footerError!: HTMLElement;
  private synonymsEl!: HTMLElement;
  private abort = new AbortController();
  /** Resolves once Claude Code's synonyms are shown (or it failed); for the smoke test. */
  synonyms: Promise<void> = Promise.resolve();

  constructor(
    app: App,
    private plugin: TagEverythingPlugin,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, plugin } = this;
    this.modalEl.addClass("tag-everything-fix-modal", "tag-everything-review-modal");
    this.setTitle(`${PLUGIN_NAME}: review tags`);
    const counts = plugin.index.counts(undefined, true);
    contentEl.createDiv({
      cls: "tag-everything-where",
      text: "One idea, one tag. Tick a change, edit the tag to keep if needed (several: separate with spaces; empty: the tag is removed), then apply.",
    });

    const clusters = similarTags(counts);
    contentEl.createEl("h4", { text: "Look-alike tags" });
    const list = contentEl.createDiv({ cls: "tag-everything-fix-list" });
    if (!clusters.length) list.createDiv({ cls: "tag-everything-fix-summary", text: `No look-alike tags among ${plural(counts.size, "tag")}.` });
    for (const c of clusters) this.rows.push(this.renderRow(list, c.tags, c.into, c.reason, c.sure));

    contentEl.createEl("h4", { text: "Synonyms" });
    this.synonymsEl = contentEl.createDiv({ cls: "tag-everything-fix-list" });
    this.synonymButton(counts, clusters);

    const grouped = new Set(clusters.flatMap((c) => c.tags));
    const rare = rareTags(counts).filter((t) => !grouped.has(t));
    if (rare.length) {
      const details = contentEl.createEl("details", { cls: "tag-everything-review-rare" });
      details.createEl("summary", { text: `Used on one item only (${rare.length})` });
      const rareList = details.createDiv({ cls: "tag-everything-fix-list" });
      for (const tag of rare.slice(0, MAX_RARE_ROWS)) {
        const path = plugin.index.paths().find((p) => plugin.index.ownTagsOf(p).includes(tag));
        this.rows.push(this.renderRow(rareList, [tag], "", path ? `on ${path}` : "", false));
      }
    }

    this.footerError = contentEl.createDiv({ cls: "tag-everything-error" });
    new Setting(contentEl)
      .setDesc("Files whose name holds a changed tag are renamed (links follow). Tag groups and bookmark tabs follow too.")
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        this.applyButton = b.setCta().onClick(() => void this.apply());
      });
    this.refresh();
  }

  onClose(): void {
    this.abort.abort(); // stops Claude Code if it still runs
    this.contentEl.empty();
  }

  private renderRow(list: HTMLElement, from: string[], into: string, why: string, checked: boolean): ReviewRow {
    const counts = this.plugin.index.counts(undefined, true);
    const el = list.createDiv({ cls: "tag-everything-fix-row" });
    const checkbox = el.createEl("input", { type: "checkbox", attr: { "aria-label": `Change ${from.join(", ")}` } });
    checkbox.checked = checked;
    const fromEl = el.createDiv({ cls: "tag-everything-fix-from" });
    for (const t of from) countedChip(this.plugin, fromEl, t, counts.get(t) ?? 0);
    if (why) fromEl.createDiv({ cls: "tag-everything-fix-problem", text: why });
    el.createSpan({ cls: "tag-everything-fix-arrow", text: "→" });
    const to = el.createDiv({ cls: "tag-everything-fix-to" });
    const input = to.createEl("input", {
      type: "text",
      cls: "tag-everything-fix-input",
      value: into,
      attr: { placeholder: "(the tag is removed)", spellcheck: "false", "data-tags": from.join(" ") },
    });
    const errorEl = to.createDiv({ cls: "tag-everything-error" });
    checkbox.addEventListener("change", () => this.refresh());
    input.addEventListener("input", () => {
      checkbox.checked = true;
      this.refresh();
    });
    return { from, checkbox, input, errorEl };
  }

  private synonymButton(counts: ReadonlyMap<string, number>, local: readonly TagCluster[]): void {
    new Setting(this.synonymsEl)
      .setDesc("Claude Code reads your tag list (not your files) and groups the tags that mean the same thing: banque and bancaire, invoice and facture.")
      .addButton((b) => b.setButtonText("Find synonyms with Claude Code").onClick(() => (this.synonyms = this.findSynonyms(counts, local))));
  }

  /** Asks Claude Code for synonym groups and adds them as rows (unticked); those the look-alikes already hold are skipped. */
  private async findSynonyms(counts: ReadonlyMap<string, number>, local: readonly TagCluster[]): Promise<void> {
    const { plugin } = this;
    this.synonymsEl.empty();
    const status = this.synonymsEl.createDiv({ cls: "tag-everything-suggest-status", text: `Claude Code is reading ${plural(counts.size, "tag")}…` });
    try {
      const { settings } = plugin;
      const prompt = synonymPrompt(counts, settings);
      const stdout = await plugin.runClaude(this.app.vault.getRoot(), prompt, this.abort.signal, SYNONYM_TASK);
      const result = readClaudeResult(stdout);
      if (this.abort.signal.aborted) return;
      const seen = new Set(local.map((c) => [...c.tags].sort().join("\u001f")));
      const groups = cleanSynonyms(result.answer, counts, plugin.rule, settings.lowercase).filter((g) => !seen.has([...g.tags].sort().join("\u001f")));
      const took = claudeTook(result.durationMs, result.costUsd);
      status.setText(`${groups.length ? `${plural(groups.length, "group")} of synonyms found` : "No synonyms found"}${took ? ` (${took})` : ""}. Tick the ones to merge.`);
      for (const g of groups) this.rows.push(this.renderRow(this.synonymsEl, g.tags, g.into, g.reason, false));
      this.refresh();
    } catch (err) {
      if (this.abort.signal.aborted) return; // closed by the user
      console.error("[tag-everything] Claude Code synonyms failed", err);
      status.setText(claudeError(err as Error, "find synonyms"));
      status.addClass("tag-everything-error");
      this.synonymButton(counts, local); // try again
    }
  }

  /** The ticked rows as one rename map, or why not; every row's own error shown under it. */
  private mapping(): { mapping: Map<string, string[]> } | { error: string } {
    const picked = [];
    let invalid = false;
    for (const row of this.rows) {
      const r = parseReplacement(row.input.value, this.plugin.rule);
      const error = row.checkbox.checked && "error" in r ? r.error : "";
      row.errorEl.setText(error);
      row.input.toggleClass("is-invalid", !!error);
      if (error) invalid = true;
      else if (row.checkbox.checked && "tags" in r) picked.push({ from: row.from, into: r.tags });
    }
    if (invalid) return { error: "" }; // shown on its row
    return mergeMapping(picked);
  }

  private refresh(): void {
    const m = this.mapping();
    this.footerError.setText("error" in m ? m.error : "");
    const n = "mapping" in m ? m.mapping.size : 0;
    this.applyButton?.setButtonText(n ? `Change ${plural(n, "tag")}` : "Change").setDisabled(!n);
  }

  /** Applies the ticked rows (public for the smoke test). */
  async apply(): Promise<void> {
    const m = this.mapping();
    if (!("mapping" in m) || !m.mapping.size) return;
    this.close();
    await applyMapping(this.plugin, m.mapping, (items) => `${plural(m.mapping.size, "tag")} changed on ${plural(items, "item")}.`);
  }
}
