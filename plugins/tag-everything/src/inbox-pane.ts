import { ButtonComponent, TFile, setIcon } from "obsidian";
import { MAX_SUGGEST_ITEMS } from "./suggest.ts";
import { ageText, inboxPaths } from "./inbox.ts";
import { type RowHost, renderItemRow, wireItemRow } from "./items.ts";
import { GUIDE_FILE } from "./guide.ts";
import { plural } from "./messages.ts";
import { RuleModal } from "./rule-modal.ts";
import { clickable, paintTag } from "./ui.ts";
import type TagEverythingPlugin from "./main.ts";

/** Rows drawn at most: an inbox is meant to be emptied, not scrolled. */
const MAX_INBOX_ROWS = 200;

/**
 * The files of the inbox (settings `inboxDays`, `inboxFolder`, `inboxDismissed`), newest first: listed by this view
 * and by the Inbox node of the TagEverything explorer.
 */
export function inboxFiles(plugin: TagEverythingPlugin): TFile[] {
  const { index, settings, app } = plugin;
  const candidates = app.vault
    .getFiles()
    .filter((f) => f.name !== GUIDE_FILE && !plugin.isExcluded(f))
    .map((f) => ({ path: f.path, ctime: f.stat.ctime, tagged: index.ownTagsOf(f.path).length > 0 }));
  return inboxPaths(candidates, Date.now(), settings.inboxDays, new Set(settings.inboxDismissed), settings.inboxFolder)
    .map((p) => app.vault.getAbstractFileByPath(p))
    .filter((f): f is TFile => f instanceof TFile);
}

/**
 * The inbox, a tab of the tags panel (src/view.ts): files with no tag that arrived in the last days (setting
 * `inboxDays`), in one folder if `inboxFolder` is set, newest first. Each row shows the tags the auto-tag rules would
 * add (click one to leave it out) and four buttons: add them, edit tags, new rule from this file, dismiss. At the top:
 * apply the rules to every file, ask Claude Code, add a rule. A file leaves the inbox as soon as it has a tag. The
 * panel redraws it on every index or vault change.
 */
export class InboxPane {
  /** Rule tags the user left out, per path: not added. */
  private off = new Map<string, Set<string>>();
  private el: HTMLElement | null = null;

  constructor(
    private plugin: TagEverythingPlugin,
    private host: RowHost,
  ) {}

  /** The files of the inbox, newest first (public for the smoke test). */
  files(): TFile[] {
    return inboxFiles(this.plugin);
  }

  /** The rule tags of a file, without those left out. */
  private pending(file: TFile): string[] {
    const off = this.off.get(file.path);
    return this.plugin.ruleTagsOf(file).filter((t) => !off?.has(t));
  }

  /** Adds the rule tags to the files (all of them by default; public for the smoke test). */
  async applyRules(files: readonly TFile[] = this.files()): Promise<void> {
    const map = new Map<TFile, string[]>();
    for (const f of files) {
      const tags = this.pending(f);
      if (tags.length) map.set(f, tags);
    }
    if (map.size) await this.plugin.addTagsEach(map);
  }

  /** The file leaves the inbox without tags (kept in the settings; dismissed files that are gone are dropped). */
  async dismiss(file: TFile): Promise<void> {
    const { settings } = this.plugin;
    const { vault } = this.plugin.app;
    settings.inboxDismissed = [...settings.inboxDismissed.filter((p) => vault.getAbstractFileByPath(p)), file.path];
    await this.plugin.saveSettings();
  }

  /** Draws the inbox into `el` (emptied first). */
  render(host: HTMLElement | null = this.el): void {
    if (!host) return;
    this.el = host;
    const { plugin } = this;
    host.empty();
    const el = host.createDiv({ cls: "tag-everything-inbox" });
    const files = this.files();
    const days = plural(plugin.settings.inboxDays, "day");
    const folder = plugin.settings.inboxFolder;
    const where = folder ? ` in ${folder}` : "";
    const withRules = files.filter((f) => this.pending(f).length);

    const bar = el.createDiv({ cls: "tag-everything-inbox-bar" });
    bar.createDiv({
      cls: "tag-everything-inbox-status",
      text: !plugin.index.ready
        ? "Reading tags…"
        : files.length
          ? `${plural(files.length, "file")} without tags${where} from the last ${days}.`
          : `Inbox zero: every file${where} from the last ${days} has tags.`,
    });
    // The folder matches without case or accents, so an exact lookup that misses may still list files: warn only if none.
    if (folder && !files.length && !this.plugin.app.vault.getFolderByPath(folder)) {
      el.createDiv({ cls: "tag-everything-where", text: `No folder ${folder} in the vault: check the inbox folder in the settings.` });
    }
    const actions = bar.createDiv({ cls: "tag-everything-inbox-actions" });
    if (withRules.length) {
      new ButtonComponent(actions)
        .setButtonText(`Apply rules to ${plural(withRules.length, "file")}`)
        .setCta()
        .onClick(() => void this.applyRules(withRules));
    }
    // Icon and label: a bare icon said too little.
    const labelled = (icon: string, text: string, tooltip: string, run: () => void): void => {
      const b = new ButtonComponent(actions).setButtonText(text).setTooltip(tooltip).onClick(run);
      b.buttonEl.addClass("tag-everything-icon-button");
      const i = createSpan();
      setIcon(i, icon);
      b.buttonEl.prepend(i);
    };
    if (files.length) {
      labelled("sparkles", "Suggest tags", `Suggest tags with Claude Code (the ${Math.min(files.length, MAX_SUGGEST_ITEMS)} newest)`, () => void plugin.suggestTags(files.slice(0, MAX_SUGGEST_ITEMS)));
    }
    labelled("wand-sparkles", "New rule", "New auto-tag rule", () => new RuleModal(this.plugin.app, plugin).open());
    if (folder) labelled("folder-x", "Whole vault", `Stop focusing the inbox on ${folder}`, () => void plugin.focusInbox(""));
    if (!plugin.settings.rules.length) {
      el.createDiv({
        cls: "tag-everything-where",
        text: "Auto-tag rules tag files for you, e.g. every PDF in Bank gets bank. Create one with New rule, or from a file below (its wand).",
      });
    }

    const list = el.createDiv({ cls: "tag-everything-inbox-list" });
    const now = Date.now();
    for (const file of files.slice(0, MAX_INBOX_ROWS)) this.row(list, file, now);
    if (files.length > MAX_INBOX_ROWS) el.createDiv({ cls: "tag-everything-query-more", text: `…and ${plural(files.length - MAX_INBOX_ROWS, "more file")}` });
  }

  private row(list: HTMLElement, file: TFile, now: number): void {
    const { plugin } = this;
    const { row, body } = renderItemRow(list, file, plugin.index, (parent, tag) => {
      const chip = parent.createSpan({ cls: "tag-everything-chip is-small", text: tag });
      paintTag(chip, plugin.index.colorFor(tag));
      return chip;
    });
    row.addClass("tag-everything-inbox-row");
    const age = ageText(now - file.stat.ctime);
    body.createDiv({ cls: "tag-everything-result-path", text: age === "just now" ? "Arrived just now" : `Arrived ${age} ago` });
    const suggested = plugin.ruleTagsOf(file);
    if (suggested.length) {
      const chips = body.createDiv({ cls: "tag-everything-result-tags" });
      chips.createSpan({ cls: "tag-everything-suggest-path", text: "Rules:" });
      const off = this.off.get(file.path) ?? new Set<string>();
      for (const tag of suggested) {
        const chip = chips.createSpan({ cls: "tag-everything-chip is-small is-new" + (off.has(tag) ? "" : " is-selected"), text: tag, attr: { "data-tag": tag } });
        paintTag(chip, plugin.index.colorFor(tag));
        chip.setAttr("aria-label", off.has(tag) ? `Add ${tag} again` : `Leave ${tag} out`);
        clickable(chip, (evt) => {
          evt.stopPropagation();
          if (!off.delete(tag)) off.add(tag);
          this.off.set(file.path, off);
          this.render();
        });
      }
    }
    const buttons = row.createDiv({ cls: "tag-everything-inbox-buttons" });
    const button = (icon: string, label: string, run: () => void): void => {
      const b = buttons.createDiv({ cls: "clickable-icon", attr: { "aria-label": label, "data-action": icon } });
      setIcon(b, icon);
      clickable(b, (evt) => {
        evt.stopPropagation();
        run();
      });
    };
    if (this.pending(file).length) button("check", "Add the rule tags", () => void this.applyRules([file]));
    button("tags", "Edit tags…", () => plugin.editTags([file]));
    button("wand-sparkles", "New rule from this file…", () => new RuleModal(this.plugin.app, plugin, { folder: file.parent?.isRoot() ? "" : file.parent?.path, extensions: file.extension }).open());
    button("x", "Dismiss: no tag needed", () => void this.dismiss(file));
    wireItemRow(this.host, row, file);
  }
}
