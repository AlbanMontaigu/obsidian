import { App, PluginSettingTab, Setting, TFile } from "obsidian";
import type { StorageMode, TagTarget } from "./format.ts";
import { MAX_BADGES, MIN_BADGES, type TagEverythingSettings } from "./config.ts";
import type TagEverythingPlugin from "./main.ts";

export { DEFAULT_SETTINGS, normalizeSettings } from "./config.ts";
export type { TagEverythingSettings } from "./config.ts";

/** Where new tags of `file` go. */
export function targetFor(file: TFile, settings: TagEverythingSettings): TagTarget {
  return file.extension === "md" && settings.noteTagsInFrontmatter ? "frontmatter" : settings.storage;
}

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
      .setName("Note tags in frontmatter")
      .setDesc(
        "Markdown notes: new tags go to the note's tags property, as Obsidian stores them, and the note is not renamed. " +
          "Tags already in the note's name are kept and still read. Off: notes follow the setting above.",
      )
      .addToggle((t) =>
        t.setValue(s.noteTagsInFrontmatter).onChange(async (v) => {
          s.noteTagsInFrontmatter = v;
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

    new Setting(containerEl)
      .setName("Colour tags automatically")
      .setDesc(
        "Each tag gets a colour of the theme picked from its name, always the same, so tags are easy to tell apart. " +
          "Nested tags share their parent's colour. A colour stored in a .ts sidecar wins.",
      )
      .addToggle((t) =>
        t.setValue(s.autoColors).onChange(async (v) => {
          s.autoColors = v;
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
          this.display(); // the badge options below only apply with badges on
        }),
      );

    new Setting(containerEl)
      .setName("Badges for")
      .setDisabled(!s.showBadges)
      .addDropdown((d) =>
        d
          .addOption("all", "All tags")
          .addOption("sidecar", "Tags not in the name only (frontmatter, sidecar, folder)")
          .setValue(s.badgeScope)
          .onChange(async (v) => {
            s.badgeScope = v as TagEverythingSettings["badgeScope"];
            await save();
          }),
      );

    new Setting(containerEl)
      .setName("Maximum badges per item")
      .setDesc("More tags show as +N; hover it to read them.")
      .setDisabled(!s.showBadges)
      .addSlider((sl) =>
        sl
          .setLimits(MIN_BADGES, MAX_BADGES, 1)
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
