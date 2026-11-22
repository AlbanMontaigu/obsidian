import { App, ButtonComponent, Modal, Notice, Setting, TFile, TFolder } from "obsidian";
import { type Finding, findInconsistencies } from "./consistency.ts";
import { baseOf } from "./format.ts";
import { GUIDE_FILE } from "./guide.ts";
import { PLUGIN_NAME, plural } from "./messages.ts";
import { ruleMessage } from "./naming.ts";
import { paintTag } from "./ui.ts";
import type TagEverythingPlugin from "./main.ts";

/** Findings listed at most: past that, the folder is better fixed by an auto-tag rule. */
const MAX_ROWS = 500;

/**
 * Re-reads every tag, then opens the consistency check on the files below `folder` (the root: the whole vault),
 * excluded files and AI assistant guides left out.
 */
export async function openConsistency(plugin: TagEverythingPlugin, folder: TFolder): Promise<ConsistencyModal> {
  await plugin.index.rebuild();
  const below = folder.isRoot() ? "" : `${folder.path}/`;
  const files = plugin.app.vault
    .getFiles()
    .filter((f) => f.path.startsWith(below) && f.name !== GUIDE_FILE && !plugin.isExcluded(f))
    .map((f) => ({ path: f.path, tags: plugin.index.ownTagsOf(f.path) }));
  const modal = new ConsistencyModal(plugin.app, plugin, folder.isRoot() ? "" : folder.path, findInconsistencies(files));
  modal.open();
  return modal;
}

interface FindingRow {
  finding: Finding;
  checkbox: HTMLInputElement;
}

/**
 * "Check tag consistency": the files missing a tag their folder's files nearly all carry (src/consistency.ts), one
 * row per file and tag, grouped by folder. Nothing is ticked: each is a guess. Apply adds the ticked tags, and
 * replaces the look-alike a file carries instead (`factures` -> `facture`), through `plugin.editEach`.
 */
export class ConsistencyModal extends Modal {
  private rows: FindingRow[] = [];
  private applyButton: ButtonComponent | null = null;

  constructor(
    app: App,
    private plugin: TagEverythingPlugin,
    /** The folder checked ("" = the whole vault). */
    private folder: string,
    private findings: readonly Finding[],
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, findings } = this;
    this.modalEl.addClass("tag-everything-dialog", "tag-everything-fix-modal", "tag-everything-consistency-modal");
    this.setTitle(`${PLUGIN_NAME}: tag consistency${this.folder ? ` of ${this.folder}` : ""}`);
    contentEl.createDiv({
      cls: "tag-everything-where",
      text:
        "When nearly all the files of a folder (or all its files of one type) carry a tag, the few without it are listed: " +
        "forgotten, misspelled, or a real exception. Tick those to fix; nothing changes until you apply.",
    });
    const list = contentEl.createDiv({ cls: "tag-everything-fix-list" });
    if (!findings.length) list.createDiv({ cls: "tag-everything-fix-summary", text: "Every file carries the tags of its folder: nothing stands out." });
    let folder: string | null = null;
    for (const f of findings.slice(0, MAX_ROWS)) {
      if (f.folder !== folder) {
        folder = f.folder;
        const n = new Set(findings.filter((x) => x.folder === f.folder).map((x) => x.path)).size;
        list.createDiv({ cls: "tag-everything-consistency-folder", text: `${f.folder || "Vault root"} · ${plural(n, "file")}` });
      }
      this.rows.push(this.renderRow(list, f));
    }
    if (findings.length > MAX_ROWS) {
      list.createDiv({ cls: "tag-everything-fix-summary", text: `…and ${findings.length - MAX_ROWS} more: an auto-tag rule on the folder may fix them at once.` });
    }

    new Setting(contentEl)
      .setDesc("Files whose name holds a changed tag are renamed (links follow).")
      .addButton((b) => b.setButtonText("Tick all").onClick(() => this.tickAll()))
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        this.applyButton = b.setCta().onClick(() => void this.apply());
      });
    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderRow(list: HTMLElement, f: Finding): FindingRow {
    const { plugin } = this;
    const el = list.createDiv({ cls: "tag-everything-fix-row", attr: { "data-path": f.path, "data-tag": f.tag } });
    const checkbox = el.createEl("input", { type: "checkbox", attr: { "aria-label": `Fix ${f.path}` } });
    const from = el.createDiv({ cls: "tag-everything-fix-from" });
    from.createSpan({ cls: "tag-everything-consistency-name", text: baseOf(f.path), attr: { title: f.path } });
    const own = plugin.index.ownTagsOf(f.path);
    if (!own.length) from.createSpan({ cls: "tag-everything-fix-problem", text: "no tag" });
    for (const t of own) this.chip(from, t);
    const group = f.ext ? `${f.ext.toUpperCase()} files` : "files";
    const why = f.replaces.length ? `${f.replaces.join(", ")} looks like a misspelling: ` : "";
    from.createDiv({ cls: "tag-everything-fix-problem", text: `${why}${f.carriers} of the ${f.size} ${group} here carry ${f.tag}` });
    el.createSpan({ cls: "tag-everything-fix-arrow", text: "→" });
    const to = el.createDiv({ cls: "tag-everything-fix-to" });
    this.chip(to, f.tag);
    if (f.replaces.length) to.createSpan({ cls: "tag-everything-fix-problem", text: ` instead of ${f.replaces.join(", ")}` });
    const broken = plugin.rule ? ruleMessage(f.tag, plugin.rule) : null;
    if (broken) {
      checkbox.disabled = true;
      to.createDiv({ cls: "tag-everything-error", text: `${broken}. Fix it first with Check tag names.` });
    }
    checkbox.addEventListener("change", () => this.refresh());
    return { finding: f, checkbox };
  }

  private chip(parent: HTMLElement, tag: string): HTMLElement {
    const chip = parent.createSpan({ cls: "tag-everything-chip is-small", text: tag, attr: { "data-tag": tag } });
    paintTag(chip, this.plugin.index.colorFor(tag));
    return chip;
  }

  private tickAll(): void {
    for (const r of this.rows) if (!r.checkbox.disabled) r.checkbox.checked = true;
    this.refresh();
  }

  /** The ticked rows as one edit per file. */
  private edits(): Map<TFile, { added: string[]; removed: string[] }> {
    const out = new Map<TFile, { added: string[]; removed: string[] }>();
    for (const { finding: f, checkbox } of this.rows) {
      if (!checkbox.checked) continue;
      const file = this.app.vault.getFileByPath(f.path);
      if (!file) continue; // moved or deleted since the check
      const edit = out.get(file) ?? { added: [], removed: [] };
      edit.added.push(f.tag);
      edit.removed.push(...f.replaces.filter((t) => !edit.removed.includes(t)));
      out.set(file, edit);
    }
    return out;
  }

  private refresh(): void {
    const n = this.edits().size;
    this.applyButton?.setButtonText(n ? `Fix ${plural(n, "file")}` : "Fix").setDisabled(!n);
  }

  /** Applies the ticked rows (public for the smoke test). */
  async apply(): Promise<void> {
    const edits = this.edits();
    if (!edits.size) return;
    this.close();
    try {
      const failed = await this.plugin.editEach(edits);
      if (!failed) new Notice(`${PLUGIN_NAME}: ${plural(edits.size, "file")} fixed.`);
    } catch (err) {
      console.error("[tag-everything] fixing tag consistency failed", err);
      new Notice(`${PLUGIN_NAME}: fixing the tags failed; details in the developer console.`);
    }
  }
}
