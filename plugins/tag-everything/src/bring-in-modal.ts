import { App, ButtonComponent, FileSystemAdapter, Modal, Setting } from "obsidian";
import { type BringInFolder, cleanSource, isInside } from "./bring-in.ts";
import { FolderSuggest } from "./dialogs.ts";
import { cleanFolder, deleteRule, saveRule } from "./inbox.ts";
import { PLUGIN_NAME } from "./messages.ts";
import type TagEverythingPlugin from "./main.ts";

/** `fs.promises.stat`, enough to tell a folder. */
type Stat = (path: string) => Promise<{ isDirectory(): boolean }>;

/**
 * Adds or edits an outside folder whose new files are brought into the vault (src/bring-in.ts): its path on this
 * computer, the vault folder they go to, the extensions wanted. Saved in the settings (`bringIn`), then the watcher
 * restarts; `onSaved` runs after (the settings list redraws). A new folder, or a folder whose path changed, only
 * brings in what arrives from now on.
 */
export class BringInModal extends Modal {
  private fields!: Record<"source" | "target" | "extensions", HTMLInputElement>;
  private previewEl!: HTMLElement;
  private saveButton: ButtonComponent | null = null;
  /** The last check of the outside path: a folder of this computer, outside the vault? */
  private problem: string | null = "";

  constructor(
    app: App,
    private plugin: TagEverythingPlugin,
    private draft: Partial<BringInFolder> = {},
    private onSaved: () => void = () => undefined,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, draft } = this;
    this.modalEl.addClass("tag-everything-dialog", "tag-everything-bring-in-modal");
    this.setTitle(`${PLUGIN_NAME}: ${draft.id ? "edit" : "new"} outside folder`);
    contentEl.createDiv({
      cls: "tag-everything-where",
      text: "Files arriving in this folder of your computer are moved into the vault, where they wait in the inbox (and get their auto-tag rules if Tag new files with the rules automatically is on). The files already there stay.",
    });
    const field = (name: string, desc: string, value: string, placeholder: string): HTMLInputElement => {
      let input!: HTMLInputElement;
      new Setting(contentEl)
        .setName(name)
        .setDesc(desc)
        .addText((t) => {
          input = t.setValue(value).setPlaceholder(placeholder).inputEl;
          input.spellcheck = false;
          input.addEventListener("input", () => void this.refresh());
        });
      return input;
    };
    this.fields = {
      source: field("Outside folder", "Its full path on this computer.", draft.source ?? "", "C:\\Users\\me\\Downloads"),
      target: field("Into the vault folder", "Created if needed. Empty: the vault root.", draft.target ?? "Inbox", "Inbox"),
      extensions: field("Extensions", "Only these. Empty: any file (downloads in progress are always left).", draft.extensions ?? "", "pdf jpg png docx"),
    };
    new FolderSuggest(this.app, this.fields.target);
    this.previewEl = contentEl.createDiv({ cls: "tag-everything-rule-preview" });
    const buttons = new Setting(contentEl);
    if (draft.id) buttons.addButton((b) => b.setButtonText("Remove").setWarning().onClick(() => void this.remove()));
    buttons
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        this.saveButton = b.setButtonText("Save").setCta().onClick(() => void this.save());
      });
    void this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Checks the outside path (it is read from the disk, so the answer comes later), then says what will happen. */
  private async refresh(): Promise<void> {
    const source = cleanSource(this.fields.source.value);
    this.saveButton?.setDisabled(true);
    const problem = await this.check(source);
    if (cleanSource(this.fields.source.value) !== source) return; // typed on meanwhile: that check answers
    this.problem = problem;
    this.saveButton?.setDisabled(!!problem);
    this.previewEl.toggleClass("tag-everything-error", !!problem);
    const target = cleanFolder(this.fields.target.value);
    this.previewEl.setText(problem ?? `Files arriving in ${source} from now on are moved to ${target || "the vault root"}.`);
  }

  /** Why `source` can't be watched, or null. */
  private async check(source: string): Promise<string | null> {
    if (!source) return "Type the full path of a folder of this computer.";
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return "The vault is not on this computer's disk.";
    if (!/^([a-zA-Z]:[\\/]|[\\/])/.test(source)) return "Type the full path, e.g. C:\\Users\\me\\Downloads.";
    if (isInside(source, adapter.getBasePath())) return "This folder is in the vault: pick one outside it.";
    try {
      const stat = (window as unknown as { require: (id: string) => { promises: { stat: Stat } } }).require("fs").promises.stat;
      if (!(await stat(source)).isDirectory()) return "This is a file, not a folder.";
    } catch {
      return "No such folder on this computer.";
    }
    return null;
  }

  /** Saves the folder in the settings and restarts the watcher (public for the smoke test). */
  async save(): Promise<void> {
    await this.refresh();
    if (this.problem !== null) return;
    const { settings } = this.plugin;
    const source = cleanSource(this.fields.source.value);
    const old = settings.bringIn.find((f) => f.id === this.draft.id);
    // A new path starts from now: the files already in that folder stay there.
    const since = old && old.source === source ? old.since : Date.now();
    settings.bringIn = saveRule(settings.bringIn, { id: this.draft.id, source, target: cleanFolder(this.fields.target.value), extensions: this.fields.extensions.value.trim(), since }, "b");
    await this.saved();
  }

  private async remove(): Promise<void> {
    if (!this.draft.id) return;
    this.plugin.settings.bringIn = deleteRule(this.plugin.settings.bringIn, this.draft.id);
    await this.saved();
  }

  private async saved(): Promise<void> {
    try {
      await this.plugin.saveSettings();
    } catch (err) {
      console.error("[tag-everything] saving the outside folders failed", err);
    }
    this.plugin.bringIn.restart();
    this.close();
    this.onSaved();
  }
}
