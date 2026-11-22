// UI gallery: opens every view and dialog of the plugin and saves a screenshot of each (dist/tag-everything-*.png),
// to review how they look. Not a test: run it after a UI change with `npm run smoke -- tag-everything --script gallery`
// and look at the images. Claude Code is faked (no cost, no login).

const file = (p) => app.vault.getAbstractFileByPath(p);
const closeModals = async () => {
  for (let i = 0; i < 8 && document.querySelector(".modal-container"); i++) {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    await sleep(150);
    document.querySelector(".modal-container .modal-close-button")?.click();
    await sleep(150);
  }
};
const waitFor = async (cond, ms = 3000) => {
  for (let t = 0; t < ms && !cond(); t += 100) await sleep(100);
};
await waitFor(() => plugin.index.ready, 10000);

// Panel: groups (one with a formula, one in a section), then a search in the Selection tab.
const view = await plugin.openView();
const g1 = await view.createGroup("Clients", ["client", "shared"]);
const g2 = await view.createGroup("Formula");
await view.setGroupFormula(g2, "(shared OR B27) AND NOT final");
await view.createSection("Work", ["client"], [g1]);
view.showAll();
// The tag count range on (the gallery's tags are used a few times, not 10 to 100): "used [2] to [∞] times".
plugin.settings.tagRangeMin = 2;
plugin.settings.tagRangeMax = 0;
plugin.settings.tagRangeOn = true;
await plugin.saveSettings();
await sleep(300);
await snap("panel-all");
view.selectOnly("md"); // on every note of the gallery vault: results and tags to narrow them
await sleep(300);
await snap("panel-selection");
view.selectGroup(g2);
await sleep(300);
await snap("panel-group-search");
view.showAll(); // the group searching, as All shows it
await sleep(300);
await snap("panel-group-active");
document.querySelector(".tag-everything-view-formula")?.click();
await sleep(300);
await snap("dialog-group-edit");
await closeModals();
view.selectGroup(g2); // stop
view.selectOnly("md");
await sleep(200);
document.querySelector(".tag-everything-view-formula")?.click();
await sleep(300);
await snap("dialog-search-formula");
await closeModals();
document.querySelector(".tag-everything-view-save-group")?.click();
await sleep(300);
await snap("dialog-group-new");
await closeModals();
view.showAll();
await sleep(200);
document.querySelector(".tag-everything-section-add")?.click();
await sleep(300);
await snap("dialog-name");
await closeModals();

// Tag editor (one file, then several).
plugin.editTags([file("report.md")]);
await sleep(400);
await snap("dialog-edit-tags");
await closeModals();
plugin.editTags([file("report.md"), file("Index.md"), file("Docs")]);
await sleep(400);
await snap("dialog-edit-tags-many");
await closeModals();

// Tag maintenance: check names, rename / merge (picker, then the dialog), review.
const fix = await plugin.checkTagNames();
await sleep(400);
await snap("dialog-check-names");
fix?.close?.();
await closeModals();
app.commands.executeCommandById("tag-everything:rename-tag");
await sleep(400);
await snap("dialog-rename-picker");
await closeModals();
plugin.renameTag("client");
await sleep(400);
await snap("dialog-rename");
await closeModals();
plugin.runClaude = async (_folder, _prompt, _signal, task) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output: task?.tools === ""
      ? { groups: [{ tags: ["client", "shared"], into: "client", reason: "synonyms" }] }
      : { items: [{ path: ".", tags: ["client", "finance"] }, { path: "Alpha/budget[B27 INC].md", tags: ["finance"] }] },
    total_cost_usd: 0.01,
    duration_ms: 2000,
  });
const rv = await plugin.reviewTags();
await sleep(600);
await snap("dialog-review");
rv?.close?.();
await closeModals();
await app.vault.createFolder("Bills");
for (const n of ["a[invoice edf]", "b[invoice]", "c[invoice]", "d[invoice orange]", "e[invoice]", "f[invoice]", "g[edf]", "h[invoices]"]) await app.vault.create(`Bills/${n}.pdf`, "");
const cs = await plugin.checkConsistency();
await sleep(400);
await snap("dialog-consistency");
cs?.close?.();
await closeModals();
await app.vault.delete(file("Bills"), true);

// Claude Code suggestions on a folder.
const sg = plugin.suggestTags([file("Projects")]);
await sg?.done;
await sleep(400);
await snap("dialog-suggest");
await closeModals();

// The panel's Tools tab.
await plugin.openTools();
await sleep(500);
await snap("view-tools");

// Explorer: its Tags tab, then its Inbox tab and a rule from a row's ⋮ menu.
const explorer = await plugin.openExplorer();
explorer?.showTab("tags");
await sleep(500);
await snap("view-explorer");
await plugin.openInbox();
await sleep(500);
await snap("view-explorer-inbox");
document.querySelector(".tag-everything-inbox-row [data-action=menu]")?.click();
[...document.querySelectorAll(".menu .menu-item")].find((m) => m.textContent.startsWith("New rule from this file"))?.click();
await sleep(400);
if (document.querySelector(".tag-everything-rule-modal")) await snap("dialog-rule");
await closeModals();
explorer?.showTab("tags");

// Settings: top, then each section.
app.setting.open();
app.setting.openTabById("tag-everything");
await sleep(500);
await snap("settings-top", "window");
const tab = app.setting.pluginTabs.find((t) => t.id === "tag-everything");
const headings = [...tab.containerEl.querySelectorAll(".setting-item-heading, h2, h3")];
for (const [i, h] of headings.entries()) {
  h.scrollIntoView({ block: "start" });
  await sleep(250);
  await snap(`settings-${i + 1}-${h.textContent.trim().toLowerCase().slice(0, 20)}`, "window");
}
app.setting.close();

check("gallery: every dialog closed between screens", !document.querySelector(".modal-container"));
