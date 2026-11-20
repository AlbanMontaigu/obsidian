// In-app smoke test, run by `npm run smoke -- tag-everything` inside a throwaway Obsidian opened on
// tests/fixtures/vault. Available: app, plugin (this plugin's instance), check(name, cond, detail), sleep(ms),
// expectError(regex) for console errors the test provokes on purpose, fakeMenu() to test menu items.
// Contract: docs/testing.md at the repo root.

const vault = app.vault;
const adapter = vault.adapter;
const file = (p) => vault.getAbstractFileByPath(p);
const readJson = async (p) => JSON.parse(await adapter.read(p));
const waitFor = async (cond, ms = 5000) => {
  for (let t = 0; t < ms && !cond(); t += 100) await sleep(100);
  return cond();
};
const fmTags = (p) => app.metadataCache.getFileCache(file(p))?.frontmatter?.tags;

// The metadata cache of a fresh vault is still being built when the plugin loads.
await waitFor(() => app.metadataCache.getFileCache(file("Notes/plan[gamma].md"))?.frontmatter);
await plugin.index.rebuild();

// Sections up to "UI" exercise the name / sidecar engine on notes: frontmatter storage off for them.
check("note tags go to frontmatter by default", plugin.settings.noteTagsInFrontmatter === true);
plugin.settings.noteTagsInFrontmatter = false;

// ---- context menus: single item and multi-selection
const single = fakeMenu();
app.workspace.trigger("file-menu", single, file("report.md"), "file-explorer");
check("file-menu has Edit tags", single.titles().includes("Edit tags"), single.titles().join(" | "));
const multi = fakeMenu();
app.workspace.trigger("files-menu", multi, [file("report.md"), file("Docs")], "file-explorer");
check("files-menu has bulk edit", multi.titles().includes("Edit tags of 2 items"), multi.titles().join(" | "));
single.click("Edit tags");
await sleep(300);
check("menu item opens the editor", !!document.querySelector(".tag-everything-modal"));
document.querySelector(".tag-everything-modal")?.querySelector(".modal-close-button, .modal-header-button")?.click(); // 1.15 calls the close button .modal-header-button
await sleep(200);
check("editor closes", !document.querySelector(".tag-everything-modal"));
check("command registered", !!app.commands.commands["tag-everything:edit-active-file-tags"]);

// ---- index: name tags, file sidecar, folder tsm.json
check("name tags indexed", plugin.index.tagsOf("Projects/Alpha/budget[B27 INC].md").join() === "B27,INC");
check("bracket group mid-name indexed", plugin.index.tagsOf("Projects/Alpha/meeting - [IMAC] SteerCo.md").join() === "IMAC");
check("file sidecar indexed", plugin.index.tagsOf("Docs/spec.md").join() === "draft");
check("folder tsm.json indexed", plugin.index.tagsOf("Projects/Alpha").join() === "client");
check("tag colour read from sidecar", plugin.index.colorOf("client") === "#2D8282", plugin.index.colorOf("client"));

// ---- add a tag to a plain file (filename mode): renamed, link in Index.md updated
plugin.settings.storage = "filename";
await plugin.applyTags([file("report.md")], { added: ["tax", "receipt"], removed: [] });
await sleep(800);
check("file renamed with tags", !!file("report[tax receipt].md") && !file("report.md"));
const index = await vault.read(file("Index.md"));
check("link in Index.md updated", index.includes("[[report[tax receipt]]]") || index.includes("report[tax receipt]"), index.split("\n")[2]);

// ---- remove the tags again: original name back
await plugin.applyTags([file("report[tax receipt].md")], { added: [], removed: ["tax", "receipt"] });
await sleep(500);
check("tags removed, name restored", !!file("report.md"));

// ---- sidecar mode: no rename, sidecar written, other fields kept
plugin.settings.storage = "sidecar";
await plugin.applyTags([file("Docs/spec.md")], { added: ["final"], removed: ["draft"] });
const spec = await readJson("Docs/.ts/spec.md.json");
check("sidecar mode keeps the name", !!file("Docs/spec.md"));
check("sidecar tags replaced", spec.tags.map((t) => t.title).join() === "final", JSON.stringify(spec.tags));
check("sidecar keeps other fields", spec.description === "keep me" && spec.id === "f00000000000000000000000000000b2");
plugin.settings.storage = "filename";

// ---- folder: tags go to tsm.json, the folder is never renamed
await plugin.applyTags([file("Projects/Alpha")], { added: ["2026"], removed: [] });
const tsm = await readJson("Projects/Alpha/.ts/tsm.json");
check("folder not renamed", !!file("Projects/Alpha"));
check("folder tags in tsm.json", tsm.tags.map((t) => t.title).join() === "client,2026", JSON.stringify(tsm.tags));
check("folder tsm.json keeps fields and colour", tsm.perspective === "grid" && tsm.tags[0].color === "#2D8282");

// ---- moving a file in Obsidian takes its sidecar along
await app.fileManager.renameFile(file("Docs/spec.md"), "Projects/spec.md");
await sleep(800);
check("sidecar moved with the file", (await adapter.exists("Projects/.ts/spec.md.json")) && !(await adapter.exists("Docs/.ts/spec.md.json")));
check("index follows the move", plugin.index.tagsOf("Projects/spec.md").join() === "final");

// ---- multi-item edit
await plugin.applyTags([file("Index.md"), file("Projects/spec.md")], { added: ["shared"], removed: [] });
await sleep(500);
check("multi edit renamed the note", !!file("Index[shared].md"));
// filename mode moves sidecar tags into the name, and empties the sidecar
check("filename mode moved sidecar tags into the name", !!file("Projects/spec[final shared].md"));
check("sidecar emptied after the move", (await readJson("Projects/.ts/spec[final shared].md.json")).tags.length === 0);

// ---- invalid name is refused, nothing changes
expectError(/The name would be \d+ characters long/);
let refused = false;
try {
  await plugin.applyTags([file("Projects/Alpha/budget[B27 INC].md")], { added: ["x".repeat(260)], removed: [] });
  refused = !!file("Projects/Alpha/budget[B27 INC].md");
} catch {
  refused = true;
}
check("over-long name refused, file untouched", refused);

// ---- notes: frontmatter tags (default setting), merged with name tags
plugin.settings.noteTagsInFrontmatter = true;
plugin.settings.storage = "filename";
check("frontmatter + name tags merged in the index", plugin.index.tagsOf("Notes/plan[gamma].md").join() === "gamma,alpha,beta", plugin.index.tagsOf("Notes/plan[gamma].md").join());

await plugin.applyTags([file("Notes/plan[gamma].md")], { added: ["delta", "proj/alpha"], removed: [] });
await waitFor(() => (fmTags("Notes/plan[gamma].md") ?? []).includes("delta"));
check("adding a note tag does not rename", !!file("Notes/plan[gamma].md"));
check("note tag written to frontmatter, spelling kept", JSON.stringify(fmTags("Notes/plan[gamma].md")) === '["alpha","#beta","delta","proj/alpha"]', JSON.stringify(fmTags("Notes/plan[gamma].md")));
const planText = await vault.read(file("Notes/plan[gamma].md"));
check("other properties and body kept", planText.includes("title: Plan") && planText.trimEnd().endsWith("# Plan"), planText);

await plugin.applyTags([file("Notes/plan[gamma].md")], { added: [], removed: ["gamma", "beta"] });
await waitFor(() => !!file("Notes/plan.md") && !(fmTags("Notes/plan.md") ?? []).some((t) => t.includes("beta")));
check("removing a name tag renames, frontmatter tag removed", !!file("Notes/plan.md") && JSON.stringify(fmTags("Notes/plan.md")) === '["alpha","delta","proj/alpha"]', JSON.stringify(fmTags("Notes/plan.md")));
check("index follows the note", plugin.index.tagsOf("Notes/plan.md").join() === "alpha,delta,proj/alpha", plugin.index.tagsOf("Notes/plan.md").join());

await plugin.applyTags([file("report.md")], { added: ["fresh"], removed: [] });
await waitFor(() => (fmTags("report.md") ?? []).includes("fresh"));
const reportText = await vault.read(file("report.md"));
check("plain note gets a frontmatter block", !!file("report.md") && reportText.startsWith("---\n") && reportText.includes("# Report"), reportText);

await plugin.applyTags([file("Notes/old.md")], { added: ["new"], removed: [] });
await waitFor(() => (fmTags("Notes/old.md") ?? []).includes("new"));
check("note sidecar tags move into the frontmatter", JSON.stringify(fmTags("Notes/old.md")) === '["legacy","new"]', JSON.stringify(fmTags("Notes/old.md")));
check("note sidecar emptied, its fields kept", (await readJson("Notes/.ts/old.md.json")).tags.length === 0 && (await readJson("Notes/.ts/old.md.json")).id === "f00000000000000000000000000000c3");

await vault.process(file("report.md"), (text) => text.replace("- fresh", "- fresh\n  - typed"));
check("frontmatter edited outside the plugin shows up live", await waitFor(() => plugin.index.tagsOf("report.md").includes("typed")), plugin.index.tagsOf("report.md").join());

expectError(/tagging failed\s+path=Notes\/broken\.md/);
const brokenBefore = await vault.read(file("Notes/broken.md"));
await plugin.applyTags([file("Notes/broken.md")], { added: ["x"], removed: [] });
check("invalid YAML frontmatter refused, note untouched", (await vault.read(file("Notes/broken.md"))) === brokenBefore);

// ---- non-note files still use the storage setting; a nested note tag cannot go in a file name
await plugin.applyTags([file("Docs/scan.pdf")], { added: ["paper"], removed: [] });
await sleep(500);
check("pdf still tagged in its name", !!file("Docs/scan[paper].pdf"));
expectError(/tagging failed\s+path=Docs\/scan\[paper\]\.pdf/);
await plugin.applyTags([file("Docs/scan[paper].pdf")], { added: ["proj/alpha"], removed: [] });
await sleep(300);
check("nested tag refused in a file name", !!file("Docs/scan[paper].pdf"));

// ---- robustness: edits during a rebuild, queued edits, an item gone since the editor opened
let scanning = plugin.index.rebuild(); // not awaited: the edit lands while the sidecars are being read
plugin.index.setSide("Index[shared].md", ["during-scan"]);
await scanning;
check("rebuild: a tag edit made during the scan is kept", plugin.index.tagsOf("Index[shared].md").includes("during-scan"), plugin.index.tagsOf("Index[shared].md").join());
plugin.index.setSide("Index[shared].md", []);
scanning = plugin.index.rebuild();
await app.fileManager.renameFile(file("Projects/Alpha"), "Projects/Alpha2");
await scanning;
check("rebuild: a folder renamed during the scan keeps its tags", plugin.index.tagsOf("Projects/Alpha2").join() === "client,2026", plugin.index.paths().filter((p) => p.startsWith("Projects/Alpha")).join(" | "));
await app.fileManager.renameFile(file("Projects/Alpha2"), "Projects/Alpha");
await sleep(300);
check("rebuild: and back", plugin.index.tagsOf("Projects/Alpha").join() === "client,2026" && plugin.index.tagsOf("Projects/Alpha/budget[B27 INC].md").join() === "B27,INC");

await Promise.all([
  plugin.applyTags([file("Docs/scan[paper].pdf")], { added: ["q1"], removed: [] }),
  plugin.applyTags([file("Docs/scan[paper].pdf")], { added: ["q2"], removed: [] }),
]);
check("two edits at once are queued, neither is lost", !!file("Docs/scan[paper q1 q2].pdf"), vault.getFiles().map((f) => f.path).filter((p) => p.startsWith("Docs/")).join(" | "));
await plugin.applyTags([file("Docs/scan[paper q1 q2].pdf")], { added: [], removed: ["q1", "q2"] });
check("and undone", !!file("Docs/scan[paper].pdf"));

plugin.settings.storage = "sidecar";
const gone = await vault.create("Gone.pdf", "x");
await vault.delete(gone, true);
expectError(/tagging failed\s+path=Gone\.pdf/);
await plugin.applyTags([gone], { added: ["x"], removed: [] });
check("an item deleted while the editor was open is refused, no sidecar written", !file("Gone.pdf") && !(await adapter.exists(".ts/Gone.pdf.json")));
plugin.settings.storage = "filename";

// ---- editor: an invalid word stays in the box; once fixed, Save works
plugin.editTags([file("report.md")]);
await sleep(300);
const ed = document.querySelector(".tag-everything-modal");
const edInput = ed.querySelector("input.tag-everything-input");
edInput.value = "kept a:b ";
edInput.dispatchEvent(new Event("input"));
const edChips = () => [...ed.querySelectorAll(".tag-everything-chip")].map((c) => c.firstChild.textContent);
check(
  "editor: an invalid word stays in the box with its error",
  edInput.value === "a:b" && /cannot contain/.test(ed.querySelector(".tag-everything-error").textContent) && edChips().includes("kept"),
  JSON.stringify({ value: edInput.value, chips: edChips() }),
);
ed.querySelector(".mod-cta").click();
await sleep(200);
check("editor: Save with an invalid word left keeps the dialog open", !!document.querySelector(".tag-everything-modal"));
edInput.value = "";
ed.querySelector(".mod-cta").click();
check("editor: once fixed, Save closes and applies", (await waitFor(() => plugin.index.tagsOf("report.md").includes("kept"))) && !document.querySelector(".tag-everything-modal"));
await plugin.applyTags([file("report.md")], { added: [], removed: ["kept"] });

// ---- UI: panel opens and lists the tags; explorer badges appear
const view = await plugin.openView();
await sleep(500);
check("panel opens", !!view && document.querySelectorAll(".tag-everything-view .tag-everything-chip").length >= 5);
// tag cloud: most used bigger than least used, within bounds (floor = normal chip size, ceiling = 1.4x)
const cloud = [...document.querySelectorAll(".tag-everything-view-tags > .tag-everything-chip")].map((el) => ({
  n: Number(el.querySelector(".tag-everything-chip-count")?.textContent),
  px: parseFloat(getComputedStyle(el).fontSize),
}));
const big = cloud.reduce((a, b) => (b.n > a.n ? b : a));
const small = cloud.reduce((a, b) => (b.n < a.n ? b : a));
const base = parseFloat(getComputedStyle(document.body).getPropertyValue("--font-ui-small"));
check(
  "cloud: most used tag bigger, sizes bounded",
  big.n > small.n && big.px > small.px && Math.abs(small.px - base) < 0.5 && big.px <= base * 1.4 + 0.5,
  JSON.stringify({ big, small, base }),
);
// tag colours: varied automatic colours, the sidecar colour wins, the setting turns them off
const cloudColors = () =>
  [...document.querySelectorAll(".tag-everything-view-tags > .tag-everything-chip")].map((el) => [
    el.firstChild.textContent,
    el.style.getPropertyValue("--tag-everything-color"),
  ]);
const auto = new Map(cloudColors());
check("cloud: tags get varied colours", new Set(auto.values()).size >= 4 && [...auto.values()].every(Boolean), JSON.stringify([...auto]));
check("cloud: sidecar colour wins over the automatic one", auto.get("client") === "#2D8282", auto.get("client"));
check("cloud: nested tags share their root colour", auto.get("proj/alpha") === plugin.index.colorFor("proj"), auto.get("proj/alpha"));
plugin.settings.autoColors = false;
await plugin.saveSettings();
await sleep(300);
const plain = new Map(cloudColors());
check("cloud: automatic colours can be turned off", plain.get("client") === "#2D8282" && plain.get("B27") === "", JSON.stringify([...plain]));
plugin.settings.autoColors = true;
await plugin.saveSettings();
await sleep(300);
view.selectOnly("client");
await sleep(300);
check("panel filters by tag", document.querySelectorAll(".tag-everything-result").length === 1);
plugin.badges.refresh();
await sleep(300);
check("explorer badges rendered", document.querySelectorAll(".nav-files-container .tag-everything-badge").length > 0);
const badgeWrap = document.querySelector(".nav-files-container .tag-everything-badges");
plugin.badges.refresh();
check("badges: a refresh with nothing changed keeps the same elements", !!badgeWrap?.isConnected);
const settingTab = app.setting?.pluginTabs?.find((t) => t.id === "tag-everything");
if (settingTab) {
  // Declarative tab (getSettingDefinitions): its rows are indexed for Obsidian's settings search.
  const walk = (d) => (d.items ? d.items.flatMap(walk) : [d.name]);
  const names = (settingTab.settingItems ?? []).flatMap(walk);
  check("settings: declarative rows, indexed for settings search", names.includes("Store file tags in") && names.includes("Maximum badges per item"), JSON.stringify(names));
  check("settings: tab has an icon", settingTab.icon === "tags", String(settingTab.icon));
  // Through the real dialog: the badges toggle disables / enables the two badge options and is saved.
  app.setting.open();
  app.setting.openTabById("tag-everything");
  await sleep(300);
  const el = settingTab.containerEl;
  const row = (name) => [...el.querySelectorAll(".setting-item")].find((i) => i.querySelector(".setting-item-name")?.textContent === name);
  const disabledCount = () => el.querySelectorAll(".setting-item.is-disabled").length;
  const toggle = row("Show tag badges")?.querySelector(".checkbox-container");
  check("settings: rendered in the settings dialog", !!toggle && !!row("Store file tags in") && disabledCount() === 0, String(disabledCount()));
  toggle?.click();
  await sleep(300);
  const off = disabledCount();
  const saved = (await plugin.loadData())?.showBadges;
  toggle?.click();
  await sleep(300);
  check("settings: badge options disabled while badges are off", off === 2 && saved === false, `disabled=${off} saved=${saved}`);
  check("settings: enabled again, setting saved", plugin.settings.showBadges === true && disabledCount() === 0 && (await plugin.loadData())?.showBadges === true);
  app.setting.close();
} else check("settings: tab found", false);

// ---- tag groups in the panel: create, drag tags in, fold, select = search over the group's tags
const panel = () => document.querySelector(".tag-everything-view");
const groupEl = (name) =>
  [...panel().querySelectorAll(".tag-everything-group")].find((g) => g.querySelector(".tag-everything-group-name")?.textContent === name);
const results = () => panel().querySelectorAll(".tag-everything-result").length;
const dragTag = (chipEl, target) => {
  const dt = new DataTransfer();
  chipEl.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
  const over = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt });
  target.dispatchEvent(over);
  target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  return over.defaultPrevented; // the target accepted the drag
};
const cloudChip = (tag) => [...panel().querySelectorAll(".tag-everything-view-tags > .tag-everything-chip")].find((el) => el.firstChild.textContent === tag);

panel().querySelector(".tag-everything-view-clear")?.click();
await sleep(100);
check("groups: empty state shown", plugin.settings.groups.length === 0 && !!panel().querySelector(".tag-everything-groups-head"));
panel().querySelector(".tag-everything-group-add").click();
await sleep(300);
const nameModal = document.querySelector(".tag-everything-group-modal");
nameModal.querySelector(".mod-cta").click(); // empty name
await sleep(200);
check("groups: an empty name is refused, the dialog stays", !!document.querySelector(".tag-everything-group-modal") && /name/.test(nameModal.querySelector(".tag-everything-error").textContent));
nameModal.querySelector("input").value = "  Shared docs ";
nameModal.querySelector(".mod-cta").click();
await sleep(300);
check("groups: + creates a group from its name", !document.querySelector(".tag-everything-group-modal") && !!groupEl("Shared docs"), JSON.stringify(plugin.settings.groups));
check("groups: dropping a tag adds it", dragTag(cloudChip("shared"), groupEl("Shared docs")) && dragTag(cloudChip("final"), groupEl("Shared docs")));
await sleep(200);
check("groups: group lists its tags", [...groupEl("Shared docs").querySelectorAll(".tag-everything-group-tags .tag-everything-chip")].map((c) => c.firstChild.textContent).join() === "shared,final");
await view.createGroup("Clients", ["client"]);
dragTag(cloudChip("shared"), groupEl("Clients"));
await sleep(200);
check("groups: a tag can be in several groups", plugin.settings.groups.filter((g) => g.tags.includes("shared")).length === 2, JSON.stringify(plugin.settings.groups));
check("groups: a non-tag drag is refused", !(() => {
  const over = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
  groupEl("Clients").dispatchEvent(over);
  return over.defaultPrevented;
})());
groupEl("Clients").querySelectorAll(".tag-everything-group-tags .tag-everything-chip-remove")[1].click(); // remove "shared"
await sleep(200);
check("groups: × removes a tag from the group only", plugin.settings.groups[1].tags.join() === "client" && plugin.index.counts().has("shared"));
groupEl("Clients").querySelector(".tag-everything-group-fold").click();
await sleep(300);
check("groups: fold hides the tags", groupEl("Clients").classList.contains("is-collapsed") && !groupEl("Clients").querySelector(".tag-everything-group-tags"));
const saved = JSON.parse(await adapter.read(`${app.vault.configDir}/plugins/tag-everything/data.json`));
check("groups: saved in data.json, fold state too", saved.groups?.length === 2 && saved.groups[1].collapsed === true, JSON.stringify(saved.groups));

groupEl("Shared docs").querySelector(".tag-everything-group-header").click();
await sleep(200);
check("groups: selecting a group searches all its tags (AND)", groupEl("Shared docs").classList.contains("is-active") && results() === 1, String(results()));
const offChip = [...panel().querySelectorAll(".tag-everything-view-selected .tag-everything-chip")].find((c) => c.firstChild.textContent === "final");
offChip.click();
await sleep(200);
const offNow = [...panel().querySelectorAll(".tag-everything-view-selected .tag-everything-chip")].find((c) => c.firstChild.textContent === "final");
check("groups: a group tag can be switched off in the search", offNow?.classList.contains("is-off") && results() === 2, String(results()));
offNow.click();
await sleep(200);
check("groups: and on again", results() === 1, String(results()));
groupEl("Shared docs").querySelector(".tag-everything-group-header").click();
await sleep(200);
check("groups: clicking the active group clears the search", results() === 0 && !panel().querySelector(".tag-everything-group.is-active"));
// ---- group formulas: (A OR B) AND (C OR D), through the group menu and the formula dialog
const formulaId = await view.createGroup("Formula", ["shared"]);
await sleep(200);
groupEl("Formula").querySelector(".tag-everything-group-header").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1000, clientY: 300 }));
await sleep(200);
const formulaItem = [...document.querySelectorAll(".menu .menu-item")].find((m) => /formula/i.test(m.textContent));
check("formula: group menu offers it", !!formulaItem, [...document.querySelectorAll(".menu .menu-item")].map((m) => m.textContent).join(" | "));
check("groups: the group menu starts with Search with this group", /^Search with this group/.test(document.querySelector(".menu .menu-item")?.textContent ?? ""));
formulaItem?.click();
await sleep(300);
const fModal = document.querySelector(".tag-everything-formula-modal");
const fInput = fModal?.querySelector("input");
check("formula: dialog starts from the group's tags", fInput?.value === "shared", fInput?.value);
fInput.value = "(shared ou b27";
fInput.dispatchEvent(new Event("input"));
await sleep(100);
check("formula: syntax error shown live", /not closed/.test(fModal.querySelector(".tag-everything-error").textContent), fModal.querySelector(".tag-everything-error").textContent);
fModal.querySelector(".mod-cta").click();
await sleep(200);
check("formula: invalid formula not saved, dialog stays", !!document.querySelector(".tag-everything-formula-modal") && !plugin.settings.groups.find((g) => g.id === formulaId).formula);
fInput.value = "(shared ou b27) et (final OU INC)";
fInput.dispatchEvent(new Event("input"));
await sleep(100);
const fPreview = fModal.querySelector(".tag-everything-formula-preview").textContent;
check("formula: preview in canonical form, with the vault's spelling and the count", fPreview.includes("(shared OR B27) AND (final OR INC)") && fPreview.includes("2 items"), fPreview);
fModal.querySelector(".mod-cta").click();
await sleep(300);
const fGroup = () => plugin.settings.groups.find((g) => g.id === formulaId);
check("formula: saved, tags = the formula's", !document.querySelector(".tag-everything-formula-modal") && fGroup().formula === "(shared OR B27) AND (final OR INC)" && fGroup().tags.join() === "shared,B27,final,INC", JSON.stringify(fGroup()));
const ops = [...groupEl("Formula").querySelectorAll(".tag-everything-group-tags .tag-everything-op")].map((o) => o.textContent).join(" ");
check("formula: drawn in the group with its operators", ops === "( OR ) AND ( OR )", ops);
check("formula: group count follows the formula", groupEl("Formula").querySelector(".tag-everything-group-header .tag-everything-chip-count").textContent === "2");
groupEl("Formula").querySelector(".tag-everything-group-header").click();
await sleep(200);
const resultNames = () => [...panel().querySelectorAll(".tag-everything-result-name")].map((e) => e.textContent).sort().join(" | ");
check("formula: selecting the group runs it", resultNames() === "budget[B27 INC].md | spec[final shared].md", resultNames());
const barChip = (tag) => [...panel().querySelectorAll(".tag-everything-view-selected .tag-everything-chip")].find((c) => c.firstChild.textContent === tag);
check("formula: the search bar shows the formula", panel().querySelectorAll(".tag-everything-view-selected .tag-everything-op").length === 7);
barChip("final").click();
await sleep(200);
check("formula: a switched-off tag drops out of its OR", resultNames() === "budget[B27 INC].md" && barChip("final").classList.contains("is-off"), resultNames());
barChip("INC").click();
await sleep(200);
check("formula: a whole OR switched off drops out of the AND", results() === 3, resultNames());
await view.setGroupFormula(formulaId, "shared AND NOT final");
await sleep(200);
check("formula: NOT", fGroup().formula === "shared AND NOT final" && groupEl("Formula").querySelector(".tag-everything-group-header .tag-everything-chip-count").textContent === "1");
panel().querySelector(".tag-everything-view-clear").click(); // the cloud only shows the tags of the current results
await sleep(100);
dragTag(cloudChip("IMAC"), groupEl("Formula"));
await sleep(200);
check("formula: a dropped tag is added with AND", fGroup().formula === "shared AND NOT final AND IMAC", fGroup().formula);
groupEl("Formula").querySelectorAll(".tag-everything-group-tags .tag-everything-chip-remove")[1].click(); // final
await sleep(200);
check("formula: × takes the tag out of the formula", fGroup().formula === "shared AND IMAC", fGroup().formula);
const groupChipEl = (group, tag) => [...groupEl(group).querySelectorAll(".tag-everything-group-tags .tag-everything-chip")].find((c) => c.firstChild.textContent === tag);
groupChipEl("Formula", "IMAC").querySelector(".tag-everything-chip-not").click();
await sleep(200);
check("NOT: the chip's NOT button negates it in the formula", fGroup().formula === "shared AND NOT IMAC" && groupChipEl("Formula", "IMAC").classList.contains("is-negated"), fGroup().formula);
groupChipEl("Formula", "IMAC").querySelector(".tag-everything-chip-not").click();
await sleep(200);
check("NOT: and back", fGroup().formula === "shared AND IMAC", fGroup().formula);
groupChipEl("Shared docs", "final").querySelector(".tag-everything-chip-not").click();
await sleep(200);
const sharedDocs = plugin.settings.groups.find((g) => g.name === "Shared docs");
check("NOT: a group without formula gets one", sharedDocs.formula === "shared AND NOT final" && sharedDocs.tags.join() === "shared,final", JSON.stringify(sharedDocs));

// NOT in a plain search: right-click a tag of the cloud → Exclude; + then saves the search as a group
panel().querySelector(".tag-everything-view-clear")?.click();
await sleep(100);
cloudChip("shared").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1000, clientY: 300 }));
await sleep(200);
[...document.querySelectorAll(".menu .menu-item")].find((m) => /Exclude this tag/.test(m.textContent))?.click();
await sleep(200);
const withoutShared = plugin.index.paths().filter((p) => !plugin.index.hasTag(p, "shared")).length;
const notOps = [...panel().querySelectorAll(".tag-everything-view-selected .tag-everything-op")].map((o) => o.textContent).join();
check("NOT: excluding a cloud tag lists the items without it", withoutShared > 0 && results() === withoutShared && notOps === "NOT" && !!panel().querySelector(".tag-everything-view-selected .tag-everything-chip.is-negated") && !cloudChip("shared"), `${results()} vs ${withoutShared}`);
check("NOT: excluded tags are in the panel's saved state", view.getState().excluded?.join() === "shared");
panel().querySelector(".tag-everything-group-add").click();
await sleep(300);
document.querySelector(".tag-everything-group-modal input").value = "Not shared";
document.querySelector(".tag-everything-group-modal .mod-cta").click();
await sleep(300);
check("NOT: + saves the search as a group formula", plugin.settings.groups.find((g) => g.name === "Not shared")?.formula === "NOT shared", JSON.stringify(plugin.settings.groups.at(-1)));

// ---- panel usability: filter + Enter, keyboard, saved state, group search button, results
panel().querySelector(".tag-everything-view-clear")?.click();
await sleep(100);
const searchBox = panel().querySelector(".tag-everything-view-search");
searchBox.value = "clie";
searchBox.dispatchEvent(new Event("input"));
searchBox.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
await sleep(200);
check("panel: Enter in the filter selects the first matching tag", view.getState().selected?.join() === "client" && searchBox.value === "" && results() === 1, JSON.stringify(view.getState()));
const row = panel().querySelector(".tag-everything-result");
check("panel: results are draggable and focusable", row?.draggable === true && row.tabIndex === 0);
check("panel: page preview source registered", !!app.workspace.hoverLinkSources?.["tag-everything-view"]);
const savedState = view.getState();
panel().querySelector(".tag-everything-view-clear").click();
await sleep(100);
await view.setState(savedState, { history: false });
check("panel: selection restored from its saved state", results() === 1 && view.getState().selected.join() === "client");
panel().querySelector(".tag-everything-view-clear").click();
await sleep(100);
const keyChip = cloudChip("client");
keyChip.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
await sleep(200);
check("panel: tags work from the keyboard", keyChip.tabIndex === 0 && view.getState().selected?.join() === "client");
panel().querySelector(".tag-everything-view-clear").click();
await sleep(100);
const searchLabel = () => groupEl("Formula").querySelector(".tag-everything-group-search-label")?.textContent;
check("groups: the search button is labelled", searchLabel() === "Search", searchLabel());
groupEl("Formula").querySelector(".tag-everything-group-search").click();
await sleep(200);
check("groups: the search button runs the group", groupEl("Formula").classList.contains("is-active") && !!panel().querySelector(".tag-everything-view-selected-group") && searchLabel() === "Stop");
groupEl("Formula").querySelector(".tag-everything-group-search").click();
await sleep(200);
check("groups: and clears it", !panel().querySelector(".tag-everything-group.is-active"));

// left for the screenshot: a formula group search with a NOT and one tag switched off
await view.setGroupFormula(formulaId, "(shared OR B27) AND (final OR INC) AND NOT IMAC");
view.selectGroup(formulaId);
await sleep(100);
barChip("final").click();
await sleep(200);

// ---- edit modal on a note with name + frontmatter tags
await plugin.applyTags([file("Projects/Alpha/budget[B27 INC].md")], { added: ["q3"], removed: [] });
await waitFor(() => plugin.index.tagsOf("Projects/Alpha/budget[B27 INC].md").includes("q3"));
plugin.editTags([file("Projects/Alpha/budget[B27 INC].md")]);
await sleep(400);
check("edit modal shows merged chips", document.querySelectorAll(".tag-everything-modal .tag-everything-chip").length === 3);
const wheres = [...document.querySelectorAll(".tag-everything-modal .tag-everything-where")].map((e) => e.textContent);
check("edit modal says note tags go to frontmatter", wheres.length === 1 && wheres[0].includes("frontmatter"), JSON.stringify(wheres));
document.querySelector(".tag-everything-modal")?.querySelector(".modal-close-button, .modal-header-button")?.click();

// Screenshot: the panel with its groups and a group search, one of its tags switched off.
document.querySelectorAll(".notice").forEach((n) => n.remove()); // the refusals provoked above
await sleep(300);
