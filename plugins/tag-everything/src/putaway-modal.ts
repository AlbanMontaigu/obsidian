import { App, ButtonComponent, Modal, Setting, TAbstractFile, TFile, TFolder } from "obsidian";
import { type FolderHabit, destinationsFor, folderHabits, habitIndex } from "./putaway.ts";
import { GUIDE_FILE } from "./guide.ts";
import { PLUGIN_NAME, plural } from "./messages.ts";
import { paintTag } from "./ui.ts";
import type TagEverythingPlugin from "./main.ts";

/** Files listed at most: a bigger batch is better done folder by folder. */
const MAX_ROWS = 300;

/**
 * Where each file of the items (a folder: every file below it) could go, best first; only the files with somewhere to
 * go. Folders' habits come from the tagged files of the whole vault; the inbox folder and the landing folders of brought-in files are
 * never a destination (files only pass through them).
 */
export function putAwayPlan(plugin: TagEverythingPlugin, items: readonly TAbstractFile[]): Map<TFile, FolderHabit[]> {
  const { index, settings } = plugin;
  const files = new Set<TFile>();
  const visit = (item: TAbstractFile): void => {
    if (item instanceof TFolder) return item.children.forEach(visit);
    if (item instanceof TFile && item.name !== GUIDE_FILE && !plugin.isExcluded(item) && index.ownTagsOf(item.path).length) files.add(item);
  };
  items.forEach(visit);
  const out = new Map<TFile, FolderHabit[]>();
  if (!files.size) return out;
  // The tagged files only (excluded ones are not in the index): in a vault tagged bit by bit, a folder's untagged files
  // say nothing of its habits. A folder's own tags are not a habit of its parent.
  const { vault } = plugin.app;
  const tagged = index
    .paths()
    .map((path) => ({ path, tags: index.ownTagsOf(path) }))
    .filter((f) => f.tags.length && vault.getFileByPath(f.path));
  const habits = habitIndex(folderHabits(tagged), [settings.inboxFolder, ...settings.bringIn.map((b) => b.target)]);
  for (const file of files) {
    const to = destinationsFor(file.path, index.ownTagsOf(file.path), habits);
    if (to.length) out.set(file, to);
  }
  return out;
}

/** Opens the put-away dialog on the items' files that have a destination. */
export function openPutAway(plugin: TagEverythingPlugin, items: readonly TAbstractFile[]): PutAwayModal {
  const modal = new PutAwayModal(plugin.app, plugin, putAwayPlan(plugin, items));
  modal.open();
  return modal;
}

interface PutAwayRow {
  file: TFile;
  checkbox: HTMLInputElement;
  select: HTMLSelectElement;
}

/**
 * "Put away": each file with the folder its tags belong in (src/putaway.ts), ticked; another of the candidate folders
 * can be picked, or the file unticked. Move moves the ticked files through `plugin.moveFiles` (links follow, never
 * over a file).
 */
export class PutAwayModal extends Modal {
  private rows: PutAwayRow[] = [];
  private moveButton: ButtonComponent | null = null;

  constructor(
    app: App,
    private plugin: TagEverythingPlugin,
    private plan: ReadonlyMap<TFile, readonly FolderHabit[]>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, plan } = this;
    this.modalEl.addClass("tag-everything-dialog", "tag-everything-fix-modal", "tag-everything-putaway-modal");
    this.setTitle(`${PLUGIN_NAME}: put away`);
    contentEl.createDiv({
      cls: "tag-everything-where",
      text: "Each file goes to the folder whose files usually carry the same tags. Pick another folder, or untick a file to leave it where it is.",
    });
    const list = contentEl.createDiv({ cls: "tag-everything-fix-list" });
    if (!plan.size) {
      list.createDiv({
        cls: "tag-everything-fix-summary",
        text: "No folder of the vault fits these files: no folder's files usually carry the tags they carry. Tag them first, or move one by hand to start a folder.",
      });
    }
    for (const [file, to] of [...plan].slice(0, MAX_ROWS)) this.rows.push(this.renderRow(list, file, to));
    if (plan.size > MAX_ROWS) list.createDiv({ cls: "tag-everything-fix-summary", text: `…and ${plan.size - MAX_ROWS} more: put them away afterwards.` });
    new Setting(contentEl)
      .setDesc("Links to the files follow them.")
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        this.moveButton = b.setCta().onClick(() => void this.apply());
      });
    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderRow(list: HTMLElement, file: TFile, to: readonly FolderHabit[]): PutAwayRow {
    const el = list.createDiv({ cls: "tag-everything-fix-row", attr: { "data-path": file.path } });
    const checkbox = el.createEl("input", { type: "checkbox", attr: { "aria-label": `Put away ${file.name}` } });
    checkbox.checked = true;
    const from = el.createDiv({ cls: "tag-everything-fix-from" });
    from.createSpan({ cls: "tag-everything-consistency-name", text: file.name, attr: { title: file.path } });
    for (const t of this.plugin.index.ownTagsOf(file.path)) {
      const chip = from.createSpan({ cls: "tag-everything-chip is-small", text: t, attr: { "data-tag": t } });
      paintTag(chip, this.plugin.index.colorFor(t));
    }
    from.createDiv({ cls: "tag-everything-fix-problem", text: `In ${file.parent?.isRoot() ? "the vault root" : file.parent?.path}` });
    el.createSpan({ cls: "tag-everything-fix-arrow", text: "→" });
    const dest = el.createDiv({ cls: "tag-everything-fix-to" });
    const select = dest.createEl("select", { cls: "dropdown", attr: { "aria-label": `Folder for ${file.name}` } });
    for (const h of to) select.createEl("option", { value: h.folder, text: h.folder });
    const why = dest.createDiv({ cls: "tag-everything-fix-problem" });
    const explain = (): void => {
      const h = to.find((x) => x.folder === select.value);
      why.setText(h ? `Its ${plural(h.size, "file")} usually carry ${h.tags.join(", ")}` : "");
    };
    explain();
    select.addEventListener("change", explain);
    checkbox.addEventListener("change", () => this.refresh());
    return { file, checkbox, select };
  }

  /** The ticked files and their folders. */
  private moves(): Map<TFile, string> {
    return new Map(this.rows.filter((r) => r.checkbox.checked).map((r) => [r.file, r.select.value]));
  }

  private refresh(): void {
    const n = this.moves().size;
    this.moveButton?.setButtonText(n ? `Move ${plural(n, "file")}` : "Move").setDisabled(!n);
  }

  /** Moves the ticked files (public for the smoke test). */
  async apply(): Promise<number> {
    const moves = this.moves();
    if (!moves.size) return 0;
    this.close();
    return this.plugin.moveFiles(moves);
  }
}
