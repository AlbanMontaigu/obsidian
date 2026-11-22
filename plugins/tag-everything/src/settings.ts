import { App, PluginSettingTab, SettingDefinitionItem, SettingDefinitionRender, TFile } from "obsidian";
import type { TagTarget } from "./format.ts";
import { DEFAULT_STOP_WORDS } from "./naming.ts";
import { DEFAULT_SETTINGS, normalizeSettings, type TagEverythingSettings } from "./config.ts";
import { deleteRule, describeConditions, describeRule } from "./inbox.ts";
import { RuleModal } from "./rule-modal.ts";
import { describeBringIn } from "./bring-in.ts";
import { BringInModal } from "./bring-in-modal.ts";
import type TagEverythingPlugin from "./main.ts";

export { DEFAULT_SETTINGS, normalizeSettings } from "./config.ts";
export type { TagEverythingSettings } from "./config.ts";

/** Where new tags of `file` go. */
export function targetFor(file: TFile, settings: TagEverythingSettings): TagTarget {
  return file.extension === "md" && settings.noteTagsInFrontmatter ? "frontmatter" : settings.storage;
}

/** Settings edited elsewhere (panel, inbox, rule dialog), never by a control of this tab. */
const PANEL_KEYS: readonly string[] = ["groups", "tabs", "rules", "inboxDismissed", "excluded", "excludeRules", "bringIn"];
type ControlKey = Exclude<keyof TagEverythingSettings, "groups" | "tabs" | "rules" | "inboxDismissed" | "excluded" | "excludeRules" | "bringIn">;

function setKey<K extends ControlKey>(settings: TagEverythingSettings, key: K, value: TagEverythingSettings[K]): void {
  settings[key] = value;
}

/**
 * A row with a labelled button on the right, like the other rows' controls (a declarative `action` row shows its name
 * as a link instead, which read as text rather than something to click).
 */
function buttonRow(row: { name: string; desc: string; aliases?: string[]; visible?: () => boolean }, label: string, run: () => void): SettingDefinitionRender {
  return { ...row, render: (setting) => void setting.addButton((b) => b.setButtonText(label).onClick(run)) };
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
    // Declarative rows take no class: styles.css finds the liaison words row (the tab's only textarea) through this one.
    this.containerEl.addClass("tag-everything-settings");
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
        heading: "Tags panel",
        items: [
          {
            name: "Only tags used a number of times",
            desc: "The panel's All tab and the root of the TagEverything explorer show only the tags used between the two numbers below, to keep to what matters. Both have the same numbers and a See all switch. Tags in the search, open ones in the explorer, and every tag while you filter by name or formula, stay shown.",
            aliases: ["range", "count", "occurrences", "slider", "filter", "minimum", "maximum"],
            control: { type: "toggle", key: "tagRangeOn" },
          },
          {
            name: "Used at least",
            desc: "Fewest files and folders carrying a tag shown.",
            aliases: ["range", "minimum"],
            control: { type: "number", key: "tagRangeMin", min: 1, placeholder: "10", disabled: () => !s().tagRangeOn },
          },
          {
            name: "Used at most",
            desc: "Most files and folders carrying a tag shown; 0: no limit.",
            aliases: ["range", "maximum"],
            control: { type: "number", key: "tagRangeMax", min: 0, placeholder: "100", disabled: () => !s().tagRangeOn },
          },
        ],
      },
      {
        type: "group",
        heading: "File explorer",
        items: [
          {
            name: "Show tag badges",
            desc: "In the file explorer, the extension before the name and the number of tags after it; hover the number to list the tags (relies on its markup, which Obsidian may change).",
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
            name: "PDFs, Office files and other non-note files are hidden in the file explorer",
            desc: "Turn on Files and links → Detect all file extensions to right-click them there; the TagEverything explorer and panel already show and tag them.",
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
        heading: "Inbox",
        items: [
          buttonRow(
            { name: "Open the inbox", desc: "The files without tags that arrived lately, with the tags your rules would add.", aliases: ["untagged", "new files", "auto-tag"] },
            "Open",
            () => void this.plugin.openInbox(),
          ),
          {
            name: "Days in the inbox",
            desc: "The inbox lists the files without tags created in the vault in the last this many days.",
            control: { type: "number", key: "inboxDays", min: 1, max: 365, placeholder: "30" },
          },
          {
            name: "Inbox folder",
            desc: "Focus the inbox on one folder (its subfolders included), e.g. Downloads/Scans. Empty: the whole vault. Auto-tag rules still apply everywhere.",
            aliases: ["focus", "folder", "scope"],
            control: { type: "text", key: "inboxFolder", placeholder: "Whole vault" },
          },
          {
            name: "Tag new files with the rules automatically",
            desc: "A file created in the vault (download, scan, copy) gets the tags of the rules it matches at once, without going through the inbox. A PDF or Office file is renamed when its tags go in the file name.",
            aliases: ["auto-tag", "automatic"],
            control: { type: "toggle", key: "autoApplyRules" },
          },
          buttonRow(
            {
              name: "Show dismissed files again",
              desc: "Files you dismissed from the inbox (no tag needed) come back while they have no tag.",
              visible: () => this.plugin.settings.inboxDismissed.length > 0,
            },
            "Show again",
            () => void this.undismiss(),
          ),
        ],
      },
      {
        type: "list",
        heading: "Auto-tag rules",
        emptyState: "No rule yet. Add one with +, or from a file of the inbox.",
        addItem: { name: "Add a rule", action: () => new RuleModal(this.app, this.plugin, {}, () => this.update()).open() },
        onDelete: (i: number) => void this.removeRule(i),
        items: this.plugin.settings.rules.map((rule) => ({
          name: describeRule(rule),
          aliases: ["auto-tag", "rule"],
          action: () => new RuleModal(this.app, this.plugin, rule, () => this.update()).open(),
        })),
      },
      {
        type: "list",
        heading: "Bring in files from outside the vault",
        emptyState: "No outside folder. Add your Downloads folder with +: the files arriving there are moved into the vault and wait in the inbox.",
        addItem: { name: "Add an outside folder", action: () => new BringInModal(this.app, this.plugin, {}, () => this.update()).open() },
        onDelete: (i: number) => void this.removeBringIn(i),
        items: this.plugin.settings.bringIn.map((folder) => ({
          name: describeBringIn(folder),
          aliases: ["downloads", "import", "watch", "outside", "scan"],
          action: () => new BringInModal(this.app, this.plugin, folder, () => this.update()).open(),
        })),
      },
      {
        type: "list",
        heading: "Excluded from the tag engine",
        emptyState: "Nothing excluded. Right-click a file or folder → TagEverything → Exclude from the tag engine: it is ignored everywhere, its tags stay in place.",
        onDelete: (i: number) => void this.includeAgain(i),
        items: this.plugin.settings.excluded.map((path) => ({ name: path, aliases: ["exclude", "ignore"] })),
      },
      {
        type: "list",
        heading: "Exclusion rules",
        emptyState: "No exclusion rule. The files a rule matches (folder, words of the name, extension) are ignored everywhere.",
        addItem: { name: "Add an exclusion rule", action: () => new RuleModal(this.app, this.plugin, {}, () => this.update(), "exclude").open() },
        onDelete: (i: number) => void this.removeExcludeRule(i),
        items: this.plugin.settings.excludeRules.map((rule) => ({
          name: describeConditions(rule),
          aliases: ["exclude", "ignore", "rule"],
          action: () => new RuleModal(this.app, this.plugin, rule, () => this.update(), "exclude").open(),
        })),
      },
      {
        type: "group",
        heading: "Tag maintenance",
        items: [
          // The actions are in the panel's Tools tab (root CLAUDE.md: settings hold options); this row leads there.
          buttonRow(
            {
              name: "Tag tools",
              desc: "Re-read all tags, apply the auto-tag rules, check tag names, review and rename tags: in the Tools tab (wrench) of the tags panel.",
              aliases: ["reindex", "rebuild", "re-read", "refresh", "review", "check", "naming rule", "fix tags", "merge", "rename", "apply rules"],
            },
            "Open",
            () => void this.plugin.openTools(),
          ),
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
    await this.save();
  }

  private async removeRule(i: number): Promise<void> {
    const rule = this.plugin.settings.rules[i];
    if (!rule) return;
    this.plugin.settings.rules = deleteRule(this.plugin.settings.rules, rule.id);
    await this.save();
    this.update();
  }

  private async removeBringIn(i: number): Promise<void> {
    const folder = this.plugin.settings.bringIn[i];
    if (!folder) return;
    this.plugin.settings.bringIn = deleteRule(this.plugin.settings.bringIn, folder.id);
    await this.save();
    this.plugin.bringIn.restart();
    this.update();
  }

  private async includeAgain(i: number): Promise<void> {
    const path = this.plugin.settings.excluded[i];
    if (path === undefined) return;
    await this.plugin.setExcluded([path], false);
    this.update();
  }

  private async removeExcludeRule(i: number): Promise<void> {
    const rule = this.plugin.settings.excludeRules[i];
    if (!rule) return;
    this.plugin.settings.excludeRules = deleteRule(this.plugin.settings.excludeRules, rule.id);
    await this.plugin.exclusionsChanged();
    this.update();
  }

  private async undismiss(): Promise<void> {
    this.plugin.settings.inboxDismissed = [];
    await this.save();
    this.update();
  }

  private async save(): Promise<void> {
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
