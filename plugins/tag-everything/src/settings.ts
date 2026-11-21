import { App, PluginSettingTab, SettingDefinitionItem, TFile } from "obsidian";
import type { TagTarget } from "./format.ts";
import { DEFAULT_STOP_WORDS } from "./naming.ts";
import { DEFAULT_SETTINGS, MAX_BADGES, MIN_BADGES, normalizeSettings, type TagEverythingSettings } from "./config.ts";
import type TagEverythingPlugin from "./main.ts";

export { DEFAULT_SETTINGS, normalizeSettings } from "./config.ts";
export type { TagEverythingSettings } from "./config.ts";

/** Where new tags of `file` go. */
export function targetFor(file: TFile, settings: TagEverythingSettings): TagTarget {
  return file.extension === "md" && settings.noteTagsInFrontmatter ? "frontmatter" : settings.storage;
}

/** Settings edited in the TagEverything panel, never by a control of this tab. */
const PANEL_KEYS: readonly string[] = ["groups", "tabs"];
type ControlKey = Exclude<keyof TagEverythingSettings, "groups" | "tabs">;

function setKey<K extends ControlKey>(settings: TagEverythingSettings, key: K, value: TagEverythingSettings[K]): void {
  settings[key] = value;
}

/**
 * Declarative settings tab (Obsidian 1.13+): the rows come from `getSettingDefinitions()`, so they show up in
 * Obsidian's settings search. Writes go through `setControlValue`, which repairs the value and saves.
 */
export class TagEverythingSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: TagEverythingPlugin,
  ) {
    super(app, plugin);
    this.icon = "tags";
  }

  getSettingDefinitions(): SettingDefinitionItem<ControlKey>[] {
    const s = (): TagEverythingSettings => this.plugin.settings;
    const badgesOff = (): boolean => !s().showBadges;
    return [
      {
        name: "Store file tags in",
        desc: "File name: report[tax receipt].pdf. Sidecar: .ts/report.pdf.json, the file keeps its name.",
        aliases: ["storage", "sidecar", "file name"],
        control: { type: "dropdown", key: "storage", options: { filename: "File name", sidecar: "Sidecar (.ts folder)" } },
      },
      {
        name: "Note tags in frontmatter",
        desc: "New tags of a Markdown note go to its tags property and the note is not renamed.",
        control: { type: "toggle", key: "noteTagsInFrontmatter" },
      },
      {
        name: "Tag naming rule",
        desc: "New tags must be lower-case single words: no space, - or _ (two tags instead), no liaison word. Existing tags: Check and fix tag names, below.",
        aliases: ["normalise", "normalize", "lower case", "liaison words", "stop words"],
        control: { type: "toggle", key: "tagRule" },
      },
      {
        name: "Liaison words",
        desc: "Words never used as tags while the naming rule is on. Empty the box to get the default list back.",
        aliases: ["stop words"],
        control: { type: "textarea", key: "stopWords", rows: 4, placeholder: DEFAULT_STOP_WORDS, disabled: () => !s().tagRule },
      },
      {
        name: "Lower-case new tags",
        desc: "Existing tags are left as they are. Always on while the naming rule is on.",
        control: { type: "toggle", key: "lowercase", disabled: () => s().tagRule },
      },
      {
        name: "Move .ts metadata with renamed files",
        desc: "A file renamed or moved in Obsidian takes its .ts sidecar and thumbnail along.",
        control: { type: "toggle", key: "followRenames" },
      },
      {
        name: "File extension as a tag",
        desc: "Every file also carries its extension (pdf, md…) as a tag, shown before its name in the file explorer. Read from the name, never written.",
        aliases: ["extension", "file type"],
        control: { type: "toggle", key: "extensionTags" },
      },
      {
        name: "Colour tags automatically",
        desc: "Each tag gets a theme colour picked from its name; a colour stored in a .ts sidecar wins.",
        aliases: ["color"],
        control: { type: "toggle", key: "autoColors" },
      },
      {
        type: "group",
        heading: "File explorer",
        items: [
          {
            name: "Show tag badges",
            desc: "Tag chips next to names in the file explorer (relies on its markup, which Obsidian may change).",
            control: { type: "toggle", key: "showBadges" },
          },
          {
            name: "Badges for",
            control: {
              type: "dropdown",
              key: "badgeScope",
              options: { all: "All tags", sidecar: "Tags not in the name only (frontmatter, sidecar, folder)" },
              disabled: badgesOff,
            },
          },
          {
            name: "Maximum badges per item",
            desc: "More tags show as +N; hover it to read them.",
            control: { type: "slider", key: "maxBadges", min: MIN_BADGES, max: MAX_BADGES, step: 1, disabled: badgesOff },
          },
          {
            name: "PDFs, Office files and other non-note files are hidden in the file explorer",
            desc: "Turn on Files and links → Detect all file extensions to right-click them there; the TagEverything panel already edits them.",
            searchable: false,
            visible: () => this.detectAllExtensions() === false,
          },
        ],
      },
      {
        type: "group",
        heading: "Claude Code",
        items: [
          {
            name: "Claude Code program",
            desc: "Used by Suggest tags with Claude Code. Empty: claude on the PATH, then ~/.local/bin. Otherwise the full path of claude.exe.",
            aliases: ["claude", "ai", "suggest tags", "path"],
            control: { type: "text", key: "claudeCommand", placeholder: "claude" },
          },
          {
            name: "Model",
            desc: "The model that suggests tags: sonnet or haiku cost less than the default for many files. Empty: Claude Code's default.",
            aliases: ["claude", "ai", "suggest tags"],
            control: { type: "text", key: "claudeModel", placeholder: "default" },
          },
        ],
      },
      {
        type: "group",
        heading: "Tag maintenance",
        items: [
          {
            name: "Check and fix tag names",
            desc: "Re-reads every tag, then lists those breaking the naming rule with a fix you can edit; nothing changes until you click Fix.",
            aliases: ["normalise", "normalize", "naming rule", "fix tags"],
            action: () => void this.plugin.checkTagNames(),
          },
          {
            name: "Re-read all tags",
            desc: "Rebuilds the tag index, e.g. after tags were edited outside Obsidian.",
            aliases: ["reindex", "rebuild", "refresh", "index"],
            action: () => void this.plugin.reindex(),
          },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as ControlKey];
  }

  /** Repairs the value like data.json is repaired at load (wrong type or out of range → default), then saves. */
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!(key in DEFAULT_SETTINGS) || PANEL_KEYS.includes(key)) return;
    const k = key as ControlKey;
    const settings = this.plugin.settings;
    setKey(settings, k, normalizeSettings({ ...settings, [k]: value })[k]);
    this.refreshDomState(); // the badge options are disabled while badges are off
    try {
      await this.plugin.saveSettings();
    } catch (err) {
      console.error("[tag-everything] saving the settings failed", err);
    }
  }

  /** Obsidian's "Detect all file extensions" option; undefined if the internal getter is missing. */
  private detectAllExtensions(): unknown {
    return (this.app.vault as unknown as { getConfig?: (k: string) => unknown }).getConfig?.("showUnsupportedFiles");
  }
}
