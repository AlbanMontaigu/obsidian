import { App, PluginSettingTab, Setting } from "obsidian";
import type { StorageMode } from "./format.ts";
import type TagEverythingPlugin from "./main.ts";

export interface TagEverythingSettings {
  /** Where new file tags go. Folder tags always go to `<folder>/.ts/tsm.json`. */
  storage: StorageMode;
  lowercase: boolean;
  showBadges: boolean;
  /** "sidecar": hide badges for tags already readable in the file name. */
  badgeScope: "all" | "sidecar";
  maxBadges: number;
  /** Move `.ts/<name>.json` and `.ts/<name>.jpg` along when a file is renamed or moved in Obsidian. */
  followRenames: boolean;
}

export const DEFAULT_SETTINGS: TagEverythingSettings = {
  storage: "filename",
  lowercase: false,
  showBadges: true,
  badgeScope: "all",
  maxBadges: 4,
  followRenames: true,
};

export class TagEverythingSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: TagEverythingPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async (): Promise<void> => {
      await this.plugin.saveSettings();
    };

    new Setting(containerEl)
      .setName("Store file tags in")
      .setDesc(
        "File name: report[tax receipt].pdf, visible in any file manager and app. " +
          "Sidecar: .ts/report.pdf.json, the file keeps its name (the file is never renamed). " +
          "Folder tags always go to the folder's .ts/tsm.json.",
      )
      .addDropdown((d) =>
        d
          .addOption("filename", "File name")
          .addOption("sidecar", "Sidecar (.ts folder)")
          .setValue(s.storage)
          .onChange(async (v) => {
            s.storage = v as StorageMode;
            await save();
          }),
      );

    new Setting(containerEl)
      .setName("Lower-case new tags")
      .setDesc("Existing tags are left as they are.")
      .addToggle((t) =>
        t.setValue(s.lowercase).onChange(async (v) => {
          s.lowercase = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Move .ts metadata with renamed files")
      .setDesc("When a file is renamed or moved in Obsidian, move its .ts sidecar and thumbnail along with it.")
      .addToggle((t) =>
        t.setValue(s.followRenames).onChange(async (v) => {
          s.followRenames = v;
          await save();
        }),
      );

    new Setting(containerEl).setName("File explorer").setHeading();

    new Setting(containerEl)
      .setName("Show tag badges")
      .setDesc("Adds tag chips next to names in the file explorer. Relies on the explorer's markup, which Obsidian may change.")
      .addToggle((t) =>
        t.setValue(s.showBadges).onChange(async (v) => {
          s.showBadges = v;
          await save();
        }),
      );

    new Setting(containerEl)
      .setName("Badges for")
      .addDropdown((d) =>
        d
          .addOption("all", "All tags")
          .addOption("sidecar", "Sidecar and folder tags only (name tags are already visible)")
          .setValue(s.badgeScope)
          .onChange(async (v) => {
            s.badgeScope = v as TagEverythingSettings["badgeScope"];
            await save();
          }),
      );

    new Setting(containerEl)
      .setName("Maximum badges per item")
      .addSlider((sl) =>
        sl
          .setLimits(1, 10, 1)
          .setValue(s.maxBadges)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.maxBadges = v;
            await save();
          }),
      );

    const unsupported = (this.app.vault as unknown as { getConfig?: (k: string) => unknown }).getConfig?.("showUnsupportedFiles");
    if (unsupported === false) {
      new Setting(containerEl)
        .setName("PDFs, Office files and other non-note files are hidden in the file explorer")
        .setDesc(
          "To right-click them there, turn on Settings → Files and links → Detect all file extensions. " +
            "Until then they still appear in the File tags panel, which can edit their tags too.",
        );
    }
  }
}
