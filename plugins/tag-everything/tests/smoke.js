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

// Extension tags are on by default; off until their own section below, so the exact tag lists checked here stay short.
check("extension tags on by default", plugin.settings.extensionTags === true && plugin.index.tagsOf("Docs/scan.pdf")[0] === "pdf", plugin.index.tagsOf("Docs/scan.pdf").join());
plugin.settings.extensionTags = false;
plugin.index.setExtensionTags(false);
check("extension tags off: none left", !plugin.index.tagsOf("Docs/scan.pdf").includes("pdf") && !plugin.index.counts().has("md"));

// Sections up to "UI" exercise the name / sidecar engine on notes: frontmatter storage off for them.
check("note tags go to frontmatter by default", plugin.settings.noteTagsInFrontmatter === true);
plugin.settings.noteTagsInFrontmatter = false;

// ---- context menus: single item and multi-selection
// Every item of the plugin sits in one "TagEverything" submenu, so the user sees where it comes from.
const fileMenu = fakeMenu();
app.workspace.trigger("file-menu", fileMenu, file("report.md"), "file-explorer");
const single = fileMenu.sub("TagEverything");
check("file-menu: one TagEverything submenu, nothing else", fileMenu.titles().filter((t) => /tag|guide/i.test(t)).join() === "TagEverything", fileMenu.titles().join(" | "));
check("file-menu: Edit tags and Claude Code suggestions in the submenu, no guide for a file", single?.titles().join() === "Edit tags,Suggest tags with Claude Code", single?.titles().join(" | "));
// The submenu is an internal API (MenuItem.setSubmenu): in the real explorer menu, the plugin's entry must be the
// "TagEverything" submenu, not the flat fallback ("TagEverything: Edit tags").
const explorerItem = app.workspace.getLeavesOfType("file-explorer")[0]?.view.fileItems?.["report.md"]?.selfEl;
explorerItem?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }));
await sleep(300);
const realTitles = [...document.querySelectorAll(".menu .menu-item-title")].map((t) => t.textContent);
check("file-menu: the real menu has the TagEverything submenu", realTitles.includes("TagEverything") && !realTitles.some((t) => t.startsWith("TagEverything:")), realTitles.join(" | "));
document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
document.querySelectorAll(".menu").forEach((m) => m.remove());
const multiMenu = fakeMenu();
app.workspace.trigger("files-menu", multiMenu, [file("report.md"), file("Docs")], "file-explorer");
check("files-menu has bulk edit and suggestions in the submenu", multiMenu.sub("TagEverything")?.titles().join() === "Edit tags of 2 items,Suggest tags with Claude Code", multiMenu.titles().join(" | "));
single.click("Edit tags");
await sleep(300);
check("menu item opens the editor", !!document.querySelector(".tag-everything-modal"));
check("editor title names the plugin", document.querySelector(".tag-everything-modal .modal-title")?.textContent === "TagEverything: report.md", document.querySelector(".tag-everything-modal .modal-title")?.textContent);
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

plugin.settings.tagRule = false; // a nested tag breaks the naming rule (`/` splits like `-`): planted without it
await plugin.applyTags([file("Notes/plan[gamma].md")], { added: ["delta", "proj/alpha"], removed: [] });
plugin.settings.tagRule = true;
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
plugin.settings.tagRule = false; // refused by the format itself, not only by the rule
await plugin.applyTags([file("Docs/scan[paper].pdf")], { added: ["proj/alpha"], removed: [] });
await sleep(300);
plugin.settings.tagRule = true;
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

// ---- naming rule in the editor: lower-cased, a compound refused with its fix in the box, liaison word left out
plugin.editTags([file("report.md")]);
await sleep(300);
const rd = document.querySelector(".tag-everything-modal");
const rdInput = rd.querySelector("input.tag-everything-input");
const rdChips = () => [...rd.querySelectorAll(".tag-everything-chip")].map((c) => c.firstChild.textContent);
rdInput.value = "Urgent Tax-Receipt de ";
rdInput.dispatchEvent(new Event("input"));
const rdError = rd.querySelector(".tag-everything-error").textContent;
check(
  "rule: editor lower-cases, puts the fix of a compound in the box, leaves a liaison word out",
  rdChips().includes("urgent") && !rdChips().includes("Urgent") && rdInput.value === "tax receipt" && /one word per tag/.test(rdError) && /liaison word/.test(rdError),
  JSON.stringify({ chips: rdChips(), value: rdInput.value, rdError }),
);
rdInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
check("rule: Enter accepts the fix as two tags", rdChips().includes("tax") && rdChips().includes("receipt") && rdInput.value === "", JSON.stringify(rdChips()));
rdInput.value = "Other_Thing";
rd.querySelector(".mod-cta").click();
await sleep(200);
check("rule: Save with a compound in the box refuses it and shows the fix", !!document.querySelector(".tag-everything-modal") && rdInput.value === "other thing", rdInput.value);
rd.querySelector(".modal-close-button, .modal-header-button")?.click();
await sleep(200);
const beforeRefused = plugin.index.tagsOf("report.md").join();
await plugin.applyTags([file("report.md")], { added: ["Tax-Receipt"], removed: [] });
check(
  "rule: applyTags refuses a new tag breaking it, nothing written",
  plugin.index.tagsOf("report.md").join() === beforeRefused && [...document.querySelectorAll(".notice")].some((n) => /lower-case single words/.test(n.textContent)),
  plugin.index.tagsOf("report.md").join(),
);

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
// One round pill per tagged row (a visible one) with the number of its tags; hovering it lists them, one per line.
const explorerItems = Object.entries(app.workspace.getLeavesOfType("file-explorer")[0]?.view.fileItems ?? {});
const [pillPath, pillItem] = explorerItems.find(([, i]) => i.selfEl?.querySelector(":scope > .tag-everything-count")?.getClientRects().length) ?? [];
const pill = pillItem?.selfEl.querySelector(":scope > .tag-everything-count");
const pillTags = pillPath ? plugin.index.ownTagsOf(pillPath) : [];
check("badges: a pill with the number of tags, no chip per tag", !!pill && pill.textContent === String(pillTags.length) && !pillItem.selfEl.querySelector(":scope > .tag-everything-badges") && parseFloat(getComputedStyle(pill).borderRadius) >= pill.getBoundingClientRect().height / 2, `${pillPath} ${pill?.textContent} ${pillTags}`);
pill?.dispatchEvent(new MouseEvent("mouseenter"));
const pillList = document.body.querySelector(":scope > .tag-everything-badge-list");
const listChips = [...(pillList?.querySelectorAll(".tag-everything-badge") ?? [])];
const tops = listChips.map((c) => c.getBoundingClientRect().top);
check("badges: hovering the pill lists its tags, one per line", listChips.map((c) => c.textContent).join() === pillTags.join() && tops.every((t, i) => i === 0 || t > tops[i - 1]) && pillList.getBoundingClientRect().width > 0, pillList?.outerHTML.slice(0, 300));
pill?.dispatchEvent(new MouseEvent("mouseleave"));
pillList?.dispatchEvent(new MouseEvent("mouseenter"));
await sleep(300);
const stays = !!pillList?.isConnected;
pillList?.dispatchEvent(new MouseEvent("mouseleave"));
await sleep(300);
check("badges: the list stays while the mouse is on it, closes after", stays && !document.querySelector(".tag-everything-badge-list"));
const badgeWrap = document.querySelector(".nav-files-container .tag-everything-count");
plugin.badges.refresh();
check("badges: a refresh with nothing changed keeps the same elements", !!badgeWrap?.isConnected);
const settingTab = app.setting?.pluginTabs?.find((t) => t.id === "tag-everything");
if (settingTab) {
  // Declarative tab (getSettingDefinitions): its rows are indexed for Obsidian's settings search.
  const walk = (d) => (d.items ? d.items.flatMap(walk) : [d.name]);
  const names = (settingTab.settingItems ?? []).flatMap(walk);
  check("settings: declarative rows, indexed for settings search", names.includes("Store file tags in") && names.includes("Badges for") && names.includes("Claude Code program") && names.includes("Model"), JSON.stringify(names));
  check("settings: tab has an icon", settingTab.icon === "tags", String(settingTab.icon));
  // Through the real dialog: the badges toggle disables / enables the badge option and is saved.
  app.setting.open();
  app.setting.openTabById("tag-everything");
  await sleep(300);
  const el = settingTab.containerEl;
  const row = (name) => [...el.querySelectorAll(".setting-item")].find((i) => i.querySelector(".setting-item-name")?.textContent === name);
  const disabledCount = () => el.querySelectorAll(".setting-item.is-disabled").length;
  const toggle = row("Show tag badges")?.querySelector(".checkbox-container");
  // The naming rule is on by default: "Lower-case new tags" is implied, so disabled (1 row).
  const isDisabled = (name) => !!row(name)?.classList.contains("is-disabled");
  check("settings: rendered in the settings dialog", !!toggle && !!row("Store file tags in") && disabledCount() === 1 && isDisabled("Lower-case new tags"), String(disabledCount()));
  const ruleToggle = row("Tag naming rule")?.querySelector(".checkbox-container");
  check("settings: naming rule on by default, liaison words editable", plugin.settings.tagRule === true && !!row("Liaison words")?.querySelector("textarea") && !isDisabled("Liaison words"));
  ruleToggle?.click();
  await sleep(300);
  const ruleOff = { liaison: isDisabled("Liaison words"), lower: isDisabled("Lower-case new tags"), saved: (await plugin.loadData())?.tagRule, rule: plugin.rule };
  ruleToggle?.click();
  await sleep(300);
  check("settings: naming rule off disables the liaison words, frees lower-case, is saved", ruleOff.liaison && !ruleOff.lower && ruleOff.saved === false && ruleOff.rule === null, JSON.stringify(ruleOff));
  check("settings: naming rule back on", plugin.settings.tagRule === true && plugin.rule !== null && isDisabled("Lower-case new tags"));
  toggle?.click();
  await sleep(300);
  const off = disabledCount();
  const saved = (await plugin.loadData())?.showBadges;
  toggle?.click();
  await sleep(300);
  check("settings: badge option disabled while badges are off", off === 2 && saved === false, `disabled=${off} saved=${saved}`);
  check("settings: enabled again, setting saved", plugin.settings.showBadges === true && disabledCount() === 1 && (await plugin.loadData())?.showBadges === true);
  // Tag maintenance: the vault check and the re-read are buttons of the settings too. Settings have their own
  // window in Obsidian 1.15: the notice and the dialog open there.
  check("settings: tag maintenance rows indexed", names.includes("Check and fix tag names") && names.includes("Re-read all tags"), JSON.stringify(names));
  const setDoc = el.ownerDocument;
  const setNotice = () => [...setDoc.querySelectorAll(".notice")].some((n) => /tagged item/.test(n.textContent));
  row("Re-read all tags")?.click();
  await waitFor(setNotice, 5000);
  check("settings: Re-read all tags re-reads and says how many items", setNotice());
  row("Check and fix tag names")?.click();
  await waitFor(() => !!setDoc.querySelector(".tag-everything-fix-modal"), 5000);
  const fromSettings = setDoc.querySelector(".tag-everything-fix-modal");
  check("settings: Check and fix tag names opens the check", !!fromSettings && /follow the rule|break the rule/.test(fromSettings.textContent), fromSettings?.textContent.slice(0, 120));
  fromSettings?.querySelector(".modal-close-button, .modal-header-button")?.click();
  await sleep(200);
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

// ---- bookmark tabs: create one, bookmark tags and a group (drop, menu), the tab shows only them, saved
const tabEl = (name) => [...panel().querySelectorAll(".tag-everything-tab")].find((t) => t.textContent === name);
const shownGroups = () => [...panel().querySelectorAll(".tag-everything-group-name")].map((e) => e.textContent).join();
const shownTags = () => [...panel().querySelectorAll(".tag-everything-view-tags > .tag-everything-chip")].map((e) => e.firstChild.textContent).sort().join();
const workTab = () => plugin.settings.tabs.find((t) => t.name === "Work");
check("tabs: All comes first and is active", panel().querySelector(".tag-everything-tab") === tabEl("All") && tabEl("All").classList.contains("is-active"));
panel().querySelector(".tag-everything-tab-add").click();
await sleep(300);
document.querySelector(".tag-everything-group-modal input").value = " Work ";
document.querySelector(".tag-everything-group-modal .mod-cta").click();
await sleep(300);
check("tabs: + creates a named tab and shows it, empty", tabEl("Work")?.classList.contains("is-active") && shownGroups() === "" && shownTags() === "", `${shownGroups()} / ${shownTags()}`);
tabEl("All").click();
await sleep(100);
const dropped = dragTag(cloudChip("client"), tabEl("Work")) && dragTag(groupEl("Formula").querySelector(".tag-everything-group-header"), tabEl("Work"));
await sleep(200);
cloudChip("final").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1000, clientY: 300 }));
await sleep(200);
[...document.querySelectorAll(".menu .menu-item")].find((m) => m.textContent === 'Bookmark in the tab "Work"')?.click();
await sleep(200);
check("tabs: tags and groups bookmarked by drop and by menu", dropped && workTab()?.tags.join() === "client,final" && workTab().groups.join() === formulaId, JSON.stringify(workTab()));
check("tabs: All still shows everything", shownGroups().split(",").length === plugin.settings.groups.length && shownTags().split(",").length > 2);
tabEl("Work").click();
await sleep(200);
check("tabs: a tab shows only its bookmarks", shownGroups() === "Formula" && shownTags() === "client,final", `${shownGroups()} / ${shownTags()}`);
check("tabs: saved in data.json, shown tab in the panel state", (await plugin.loadData())?.tabs?.[0]?.tags?.length === 2 && view.getState().tab === workTab().id);
const tempId = await view.createGroup("Temp");
await sleep(200);
const tempBookmarked = workTab().groups.includes(tempId);
groupEl("Temp").querySelector(".tag-everything-group-header").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1000, clientY: 300 }));
await sleep(200);
[...document.querySelectorAll(".menu .menu-item")].find((m) => /^Delete group/.test(m.textContent))?.click();
await sleep(200);
check("tabs: a group created in a tab is bookmarked there; deleted, it leaves the tab", tempBookmarked && !workTab().groups.includes(tempId) && shownGroups() === "Formula", JSON.stringify(workTab()));

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
await sleep(200);

// ---- Check tag names: the vault-wide engine lists the tags breaking the rule and fixes them where they are
plugin.settings.tagRule = false; // to plant tags breaking the rule, as an older version (or another app) would
await plugin.applyTags([file("Docs/scan[paper].pdf")], { added: ["Tax-Receipt"], removed: [] });
await plugin.applyTags([file("report.md")], { added: ["plan_de_charge", "de"], removed: [] });
await waitFor(() => plugin.index.tagsOf("report.md").includes("de"));
plugin.settings.tagRule = true;
// a folder tag written outside Obsidian (no vault event: the index doesn't know it yet); the check re-reads first
await adapter.write("Notes/.ts/tsm.json", JSON.stringify({ tags: [{ title: "Hors_Ligne", type: "sidecar" }] }));
const knownBefore = plugin.index.tagsOf("Notes").includes("Hors_Ligne");
await plugin.checkTagNames();
await sleep(300);
const fxEl = document.querySelector(".tag-everything-fix-modal");
const fxRow = (tag) => [...(fxEl?.querySelectorAll(".tag-everything-fix-row") ?? [])].find((r) => r.querySelector(".tag-everything-fix-input")?.dataset.tag === tag);
const fxTags = [...(fxEl?.querySelectorAll(".tag-everything-fix-input") ?? [])].map((i) => i.dataset.tag);
const fxVal = (tag) => fxRow(tag)?.querySelector(".tag-everything-fix-input").value;
check("fix: the check re-reads tags edited outside Obsidian", !knownBefore && fxTags.includes("Hors_Ligne") && fxVal("Hors_Ligne") === "hors ligne", JSON.stringify(fxTags));
check(
  "fix: the dialog lists exactly the tags breaking the rule",
  ["B27", "INC", "IMAC", "Tax-Receipt", "plan_de_charge", "de", "Hors_Ligne", "proj/alpha"].every((t) => fxTags.includes(t)) && !fxTags.includes("paper"),
  JSON.stringify(fxTags),
);
check(
  "fix: suggestions (split on - _ /, lower-case, liaison word removed)",
  fxVal("Tax-Receipt") === "tax receipt" && fxVal("B27") === "b27" && fxVal("plan_de_charge") === "plan charge" && fxVal("de") === "" && fxVal("proj/alpha") === "proj alpha",
  JSON.stringify(fxTags.map((t) => [t, fxVal(t)])),
);
const fxBtn = fxEl.querySelector("button.mod-cta");
const incInput = fxRow("INC").querySelector(".tag-everything-fix-input");
incInput.value = "Inc";
incInput.dispatchEvent(new Event("input"));
check("fix: an edited fix breaking the rule is flagged, Fix disabled", fxBtn.disabled && /lower-case/.test(fxRow("INC").querySelector(".tag-everything-error").textContent));
incInput.value = "inc";
incInput.dispatchEvent(new Event("input"));
fxRow("plan_de_charge").querySelector("input[type=checkbox]").click(); // left as it is
check("fix: Fix enabled again, counts the checked tags", !fxBtn.disabled && /^Fix \d+ tags$/.test(fxBtn.textContent), fxBtn.textContent);
fxBtn.click();
await waitFor(() => !!file("Projects/Alpha/budget[b27 inc].md") && !!file("Docs/scan[paper tax receipt].pdf") && !(fmTags("report.md") ?? []).includes("de") && !(fmTags("Notes/plan.md") ?? []).includes("proj/alpha"), 8000);
await sleep(300);
check(
  "fix: name tags rewritten in the name (case-only rename too)",
  !!file("Projects/Alpha/budget[b27 inc].md") && !file("Projects/Alpha/budget[B27 INC].md") && !!file("Projects/Alpha/meeting - [imac] SteerCo.md"),
  vault.getFiles().map((f) => f.path).filter((p) => p.startsWith("Projects")).join(" | "),
);
check("fix: compound split where it was", !!file("Docs/scan[paper tax receipt].pdf"), plugin.index.tagsOf("Docs/scan[paper tax receipt].pdf").join());
check("fix: liaison-word tag removed, unchecked tag left alone", JSON.stringify(fmTags("report.md")).includes("plan_de_charge") && !(fmTags("report.md") ?? []).includes("de"), JSON.stringify(fmTags("report.md")));
check("fix: a nested tag split in the frontmatter, a part already there not repeated", JSON.stringify(fmTags("Notes/plan.md")) === '["alpha","delta","proj"]', JSON.stringify(fmTags("Notes/plan.md")));
check("fix: a folder's sidecar tag fixed in its sidecar", (await readJson("Notes/.ts/tsm.json")).tags.map((t) => t.title).join() === "hors,ligne", await adapter.read("Notes/.ts/tsm.json"));
check("fix: other tags of the fixed note kept", plugin.index.tagsOf("Projects/Alpha/budget[b27 inc].md").join() === "b27,inc,q3", plugin.index.tagsOf("Projects/Alpha/budget[b27 inc].md").join());
check("fix: the group formula follows", fGroup().formula === "(shared OR b27) AND (final OR inc) AND NOT imac", fGroup().formula);
check("fix: saved in data.json", (await plugin.loadData()).groups.find((g) => g.id === formulaId)?.formula === fGroup().formula);
check("fix: the panel's search follows", resultNames() === "budget[b27 inc].md", resultNames());
const fx2 = await plugin.checkTagNames();
await sleep(300);
const left = [...document.querySelectorAll(".tag-everything-fix-modal .tag-everything-fix-input")].map((i) => i.dataset.tag);
check("fix: checking again lists only what was left", left.join() === "plan_de_charge", left.join());
fx2.close();
await plugin.applyTags([file("report.md")], { added: [], removed: ["plan_de_charge"] });
check("command: Check tag names registered", !!app.commands.commands["tag-everything:check-tag-names"]);

// ---- AI assistant guide: CLAUDE.md written from a folder's menu or at the root, an existing one never overwritten
const folderMenu = fakeMenu();
app.workspace.trigger("file-menu", folderMenu, file("Projects"), "file-explorer");
const guideMenu = folderMenu.sub("TagEverything");
check("guide: folder submenu has Edit tags, suggestions and the guide", guideMenu?.titles().join() === "Edit tags,Suggest tags with Claude Code,Write AI assistant guide", guideMenu?.titles().join(" | "));
guideMenu.click("Write AI assistant guide");
await waitFor(() => !!file("Projects/CLAUDE.md"));
const guideText = file("Projects/CLAUDE.md") ? await vault.read(file("Projects/CLAUDE.md")) : "";
check("guide: written with the folder's tags", /## Tags used in `Projects`[^\n]*\n\n[^\n]*`client` 1/.test(guideText) && guideText.includes("## Most used tags in the vault"), guideText.slice(-300));
await vault.modify(file("Projects/CLAUDE.md"), "mine");
document.querySelectorAll(".notice").forEach((n) => n.remove());
check("guide: an existing guide is skipped", (await plugin.writeGuide(file("Projects"))) === null && (await vault.read(file("Projects/CLAUDE.md"))) === "mine");
check("branding: notices start with TagEverything:", [...document.querySelectorAll(".notice")].some((n) => n.textContent.startsWith("TagEverything: Projects/CLAUDE.md already exists")));
check("branding: the panel is named TagEverything", app.workspace.getLeavesOfType("tag-everything-view")[0]?.view.getDisplayText() === "TagEverything");
await vault.create("Docs/claude.md", "lower-case");
check("guide: skipped whatever the case of the name", (await plugin.writeGuide(file("Docs"))) === null && !file("Docs/CLAUDE.md"));
check("command: guide at the root registered", !!app.commands.commands["tag-everything:write-guide-root"]);
app.commands.executeCommandById("tag-everything:write-guide-root");
await waitFor(() => !!file("CLAUDE.md"));
const rootGuide = file("CLAUDE.md") ? await vault.read(file("CLAUDE.md")) : "";
check("guide: root guide has no folder section", rootGuide.startsWith("# Tags in this vault") && !rootGuide.includes("## Tags used in"), rootGuide.slice(0, 80));
for (const p of ["Projects/CLAUDE.md", "Docs/claude.md", "CLAUDE.md"]) if (file(p)) await vault.delete(file(p));

// ---- Suggest tags with Claude Code: the prompt (folder, items, dictionary), the review dialog, the tags added.
// Claude Code itself is faked (cost, login, non-deterministic); the real spawn is run once with a missing program.
const realRunClaude = plugin.runClaude;
let asked = null;
const answerJson = (items) => JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { items }, total_cost_usd: 0.03, duration_ms: 4200 });
const budgetPath = "Projects/Alpha/budget[b27 inc].md";
const meetingPath = "Projects/Alpha/meeting - [imac] SteerCo.md";
plugin.runClaude = async (folder, prompt) => {
  asked = { folder: folder.path, prompt };
  return answerJson([
    { path: ".", tags: ["client", "Customer-Work"] },
    { path: "Alpha/budget[b27 inc].md", tags: ["finance", "b27"] },
    { path: "./Alpha/meeting - [imac] SteerCo.md", tags: ["meeting"] },
    { path: "made-up.md", tags: ["ghost"] },
  ]);
};
const sgMenu = fakeMenu();
app.workspace.trigger("file-menu", sgMenu, file("Projects"), "file-explorer");
sgMenu.sub("TagEverything").click("Suggest tags with Claude Code");
await waitFor(() => document.querySelectorAll(".tag-everything-suggest-row").length > 0);
const sgEl = document.querySelector(".tag-everything-suggest-modal");
check("suggest: dialog titled with the plugin's name", sgEl?.querySelector(".modal-title")?.textContent === "TagEverything: suggest tags with Claude Code");
check("suggest: Claude Code works in the folder", asked?.folder === "Projects", asked?.folder);
check(
  "suggest: the prompt lists the folder and its files with their tags, and the vault's tags",
  asked?.prompt.includes("- `.` (a folder: this one): no tag yet") && asked.prompt.includes("- `Alpha/budget[b27 inc].md`: b27, inc, q3") &&
    asked.prompt.includes("`Alpha/meeting - [imac] SteerCo.md`") && /Existing tags in the vault[^\n]*\n[^\n]*`client` \d/.test(asked.prompt) && asked.prompt.includes("ONE lower-case word"),
  asked?.prompt,
);
const sgChips = (i) => [...(sgEl.querySelectorAll(".tag-everything-suggest-row")[i]?.querySelectorAll(".tag-everything-suggest-tags .tag-everything-chip") ?? [])];
const sgChip = (tag) => sgEl.querySelector(`.tag-everything-suggest-tags .tag-everything-chip[data-tag="${tag}"]`);
const sgRows = [...sgEl.querySelectorAll(".tag-everything-suggest-row")];
check("suggest: one row per item, made-up paths ignored", sgRows.length === 4 && !sgChip("ghost") && sgRows[3].textContent.includes("no new tag"), sgRows.map((r) => r.textContent).join(" | "));
check(
  "suggest: tags the item has dropped, compound split by the rule",
  sgChips(0).map((c) => c.dataset.tag).join() === "client,customer,work" && sgChips(1).map((c) => c.dataset.tag).join() === "finance",
  [0, 1, 2].map((i) => sgChips(i).map((c) => c.dataset.tag).join()).join(" | "),
);
check("suggest: new tags marked, cost and time shown", sgChip("customer")?.hasClass("is-new") && /4 s, API cost \$0\.03/.test(sgEl.querySelector(".tag-everything-suggest-status")?.textContent));
const sgAdd = sgEl.querySelector("button.mod-cta");
check("suggest: Add counts the tags", sgAdd?.textContent === "Add 5 tags", sgAdd?.textContent);
sgChip("work").click();
check("suggest: a clicked tag is left out", !sgChip("work").hasClass("is-selected") && sgAdd.textContent === "Add 4 tags", sgAdd.textContent);
sgAdd.click();
await waitFor(() => plugin.index.ownTagsOf(meetingPath).includes("meeting") && plugin.index.ownTagsOf("Projects").includes("customer"));
check(
  "suggest: the chosen tags added to each item, nothing removed, the left-out one not added",
  plugin.index.ownTagsOf("Projects").join() === "client,customer" && plugin.index.ownTagsOf(budgetPath).join() === "b27,inc,q3,finance" && plugin.index.ownTagsOf(meetingPath).includes("meeting") && plugin.index.counts(undefined, true).get("work") === undefined,
  `${plugin.index.ownTagsOf("Projects")} | ${plugin.index.ownTagsOf(budgetPath)} | ${plugin.index.ownTagsOf(meetingPath)}`,
);
check("suggest: a note's tag went to its frontmatter, the note not renamed", (fmTags(budgetPath) ?? []).includes("finance") && !!file(budgetPath), JSON.stringify(fmTags(budgetPath)));
// A selection: Claude Code works in the closest common folder.
plugin.runClaude = async (folder, prompt) => {
  asked = { folder: folder.path, prompt };
  return "Invalid API key · Please run /login";
};
expectError(/Claude Code suggestion failed/);
const sgSel = plugin.suggestTags([file(budgetPath), file(meetingPath)]);
await sgSel.done;
check("suggest: a selection works in its common folder, only the selected items listed", asked?.folder === "Projects/Alpha" && asked.prompt.includes("- `budget[b27 inc].md`") && !asked.prompt.includes("(a folder"), asked?.prompt.split("Items")[1]);
check("suggest: an answer that is not JSON shows the error", /did not answer in JSON: Invalid API key/.test(document.querySelector(".tag-everything-suggest-modal")?.textContent), document.querySelector(".tag-everything-suggest-modal")?.textContent);
sgSel.close();
// Closing the dialog while Claude Code runs stops it.
let sgSignal = null;
plugin.runClaude = (_folder, _prompt, signal) => {
  sgSignal = signal;
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled"))));
};
const sgRun = plugin.suggestTags([file("report.md")]);
await sleep(100);
check("suggest: a running dialog says what Claude Code reads", /Claude Code is reading 1 item in the vault root/.test(document.querySelector(".tag-everything-suggest-modal")?.textContent ?? ""));
sgRun.close();
await sgRun.done;
check("suggest: closing the dialog cancels Claude Code", sgSignal?.aborted === true);
// The real runner, with a program that does not exist: the node modules and the vault path work, the user is told.
plugin.runClaude = realRunClaude;
plugin.settings.claudeCommand = "no-such-claude-program";
const sgMissing = plugin.suggestTags([file("report.md")]);
await sgMissing.done;
check("suggest: a missing Claude Code program is explained", /Claude Code was not found.*settings/.test(document.querySelector(".tag-everything-suggest-modal")?.textContent ?? ""), document.querySelector(".tag-everything-suggest-modal")?.textContent);
sgMissing.close();
plugin.settings.claudeCommand = "";
check("command: suggest tags for the current file registered", !!app.commands.commands["tag-everything:suggest-tags-active-file"]);
document.querySelectorAll(".notice").forEach((n) => n.remove());

// ---- query blocks: a `tag-everything` code block lists, live, the items matching its formula
const FENCE = "```";
const b27Count = () => plugin.index.paths().filter((p) => plugin.index.hasTag(p, "b27")).length;
await vault.create("Queries.md", `# Queries\n\n${FENCE}tag-everything\n// my B27 files\nB27 AND NOT gone\nsort: modified\nlimit: 1\nbogus: x\n${FENCE}\n\n${FENCE}tag-everything\nb27 AND\n${FENCE}\n`);
const qLeaf = app.workspace.getLeaf(true);
await qLeaf.openFile(file("Queries.md"));
await qLeaf.setViewState({ type: "markdown", state: { file: "Queries.md", mode: "preview" } });
await waitFor(() => qLeaf.view.containerEl.querySelectorAll(".tag-everything-query").length === 2);
const qBlocks = () => [...qLeaf.view.containerEl.querySelectorAll(".tag-everything-query")];
const qText = (i) => qBlocks()[i]?.textContent ?? "";
const qHead = (i) => [...(qBlocks()[i]?.querySelectorAll(".tag-everything-query-head .tag-everything-chip") ?? [])];
check("query: two blocks rendered in reading view", qBlocks().length === 2);
check(
  "query: the formula as chips, vault spelling, NOT struck, an unknown tag faded",
  qHead(0).map((c) => c.dataset.tag).join() === "b27,gone" && qHead(0)[1].hasClass("is-negated") && qHead(0)[1].hasClass("is-missing"),
  qHead(0).map((c) => c.outerHTML).join(" "),
);
const n27 = b27Count();
check("query: counts the matches, shows `limit` rows, then how many more", qText(0).includes(`${n27} item`) && qBlocks()[0].querySelectorAll(".tag-everything-result").length === 1 && (n27 < 2 || /and \d+ more item/.test(qText(0))), qText(0));
check("query: unknown tags and bad options are named", /No item carries gone/.test(qText(0)) && /"bogus:" is not an option/.test(qText(0)), qText(0));
check("query: a syntax error is explained with the syntax", /TagEverything query: /.test(qText(1)) && /Options on their own line/.test(qText(1)), qText(1));
await plugin.applyTags([file("report.md")], { added: ["b27"], removed: [] });
await waitFor(() => qText(0).includes(`${n27 + 1} item`));
check("query: follows the vault live (a tag added elsewhere)", qText(0).includes(`${n27 + 1} item`), qText(0));
const qRowPath = qBlocks()[0].querySelector(".tag-everything-result")?.dataset.path;
qBlocks()[0].querySelector(".tag-everything-result")?.click();
await sleep(300);
check("query: clicking a row opens the item", !!qRowPath && app.workspace.getActiveFile()?.path === qRowPath, qRowPath);
await app.workspace.revealLeaf(qLeaf);
await qLeaf.openFile(file("Queries.md"));
await qLeaf.setViewState({ type: "markdown", state: { file: "Queries.md", mode: "preview" } });
await waitFor(() => qBlocks().length === 2);
const qPanel = app.workspace.getLeavesOfType("tag-everything-view")[0]?.view;
const qPanelState = qPanel?.getState(); // the group search set up for the screenshot, put back below
qHead(0)[0]?.click();
await sleep(400);
check("query: clicking a chip shows the tag in the panel", qPanel?.selected?.join() === "b27", qPanel?.selected?.join());
await qPanel?.setState(qPanelState, { history: false });
await plugin.applyTags([file(app.vault.getFiles().find((f) => f.basename.startsWith("report")).path)], { added: [], removed: ["b27"] });
// the command: the selected text becomes the block's formula
await vault.create("Insert.md", "tax");
await qLeaf.openFile(file("Insert.md"));
await qLeaf.setViewState({ type: "markdown", state: { file: "Insert.md", mode: "source" } });
await sleep(200);
const qEditor = qLeaf.view.editor;
qEditor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 3 });
plugin.insertQuery(qEditor);
check("query: Insert a tag query block wraps the selection", qEditor.getValue() === `${FENCE}tag-everything\ntax\n${FENCE}\n` && qEditor.getCursor().line === 1, JSON.stringify(qEditor.getValue()));
check("command: insert a tag query block registered", !!app.commands.commands["tag-everything:insert-query"]);
qLeaf.detach();
await sleep(300); // closing the editor saves the note: delete it after
await vault.delete(file("Insert.md"));
await vault.delete(file("Queries.md"));

// ---- tag curator: rename / merge one tag everywhere, then the review (look-alikes, Claude Code's synonyms, used once)
await vault.createFolder("Taxo");
await vault.create("Taxo/one[factures].pdf", "");
await vault.create("Taxo/two[facture].pdf", "");
await vault.create("Taxo/three.md", "---\ntags: [facturé, banque]\n---\n");
await vault.create("Taxo/four.md", "---\ntags: [bancaire]\n---\n");
await vault.create("Taxo/five[reciept].pdf", "");
await vault.create("Taxo/six[receipt].pdf", "");
await waitFor(() => plugin.index.ownTagsOf("Taxo/four.md").length && plugin.index.ownTagsOf("Taxo/three.md").length);
const rn = plugin.renameTag("bancaire");
const rnEl = document.querySelector(".tag-everything-rename-modal");
const rnInput = rnEl?.querySelector("input");
const rnButton = rnEl?.querySelector("button.mod-cta");
const rnType = (text) => {
  rnInput.value = text;
  rnInput.dispatchEvent(new Event("input"));
};
check("rename: dialog titled with the plugin's name, the tag preselected", rnEl?.querySelector(".modal-title")?.textContent === "TagEverything: rename or merge a tag" && rnInput?.value === "bancaire");
rnType("Bank-Account");
check("rename: a name breaking the naming rule is refused", rnButton?.disabled && /one word|use "bank account"/.test(rnEl.querySelector(".tag-everything-rename-hint")?.textContent), rnEl?.querySelector(".tag-everything-rename-hint")?.textContent);
rnType("banque");
check("rename: an existing tag means merge, said before anything changes", rnButton?.textContent === "Merge" && /merged into "banque"/.test(rnEl.querySelector(".tag-everything-rename-hint")?.textContent), rnEl?.querySelector(".tag-everything-rename-hint")?.textContent);
await rn.apply();
await waitFor(() => !plugin.index.counts(undefined, true).has("bancaire") && JSON.stringify(fmTags("Taxo/four.md")) === '["banque"]');
check("rename: merged everywhere (a note's frontmatter)", JSON.stringify(fmTags("Taxo/four.md")) === '["banque"]' && !plugin.index.counts().has("bancaire"), JSON.stringify(fmTags("Taxo/four.md")));
check("command: rename or merge a tag registered", !!app.commands.commands["tag-everything:rename-tag"]);

let synAsked = null;
plugin.runClaude = async (folder, prompt, _signal, task) => {
  synAsked = { folder: folder.path, prompt, tools: task?.tools };
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: { groups: [{ tags: ["banque", "finance"], into: "finance", reason: "synonyms" }] }, total_cost_usd: 0.01, duration_ms: 2000 });
};
const rv = await plugin.reviewTags();
const rvEl = document.querySelector(".tag-everything-review-modal");
const rvRow = (tags) => [...rvEl.querySelectorAll(".tag-everything-fix-row")].find((r) => r.querySelector("input[type=text]")?.dataset.tags === tags);
const facture = rvRow("facture facturé factures"); // equal use: the shorter first, then by name
check("review: a look-alike group (plural, accent) merged into one, ticked", facture?.querySelector("input[type=text]").value === "facture" && facture.querySelector("input[type=checkbox]").checked, [...rvEl.querySelectorAll(".tag-everything-fix-row input[type=text]")].map((i) => i.dataset.tags).join(" | "));
const receipt = rvRow("receipt reciept");
check("review: a typo is offered, not ticked", !!receipt && !receipt.querySelector("input[type=checkbox]").checked);
check("review: tags used once listed apart", /Used on one item only/.test(rvEl.querySelector(".tag-everything-review-rare summary")?.textContent ?? ""));
[...rvEl.querySelectorAll("button")].find((b) => b.textContent === "Find synonyms with Claude Code")?.click();
await rv.synonyms;
check("review: Claude Code gets the tag list, no tool, in the vault root", synAsked?.folder === "/" && Array.isArray(synAsked.tools) && synAsked.tools.length === 0 && synAsked.prompt.includes("`banque` 2"), JSON.stringify(synAsked?.tools) + synAsked?.prompt.slice(0, 200));
const syn = rvRow("finance banque") ?? rvRow("banque finance");
check("review: Claude Code's synonyms added, not ticked, with the cost", !!syn && !syn.querySelector("input[type=checkbox]").checked && /1 group of synonyms found \(2 s, API cost \$0\.01\)/.test(rvEl.textContent), rvEl.querySelector(".tag-everything-suggest-status")?.textContent);
for (const row of [receipt, syn]) {
  const box = row.querySelector("input[type=checkbox]");
  box.checked = true;
  box.dispatchEvent(new Event("change"));
}
const rvApply = rvEl.querySelector("button.mod-cta");
check("review: Change counts the tags that change", rvApply?.textContent === "Change 4 tags" && !rvApply.disabled, rvApply?.textContent);
await rv.apply();
await waitFor(() => !!file("Taxo/one[facture].pdf") && !!file("Taxo/five[receipt].pdf") && (fmTags("Taxo/three.md") ?? []).includes("finance"));
check(
  "review: applied where each tag is (names renamed, frontmatter rewritten)",
  !!file("Taxo/one[facture].pdf") && !!file("Taxo/five[receipt].pdf") && JSON.stringify(fmTags("Taxo/three.md")) === '["facture","finance"]' && !plugin.index.counts().has("banque"),
  JSON.stringify(fmTags("Taxo/three.md")),
);
plugin.runClaude = realRunClaude;
check("command: review tags registered", !!app.commands.commands["tag-everything:review-tags"]);
await vault.delete(file("Taxo"), true);

// ---- inbox: files without tags that arrived lately, auto-tag rules (from a file), applied, dismissed, on arrival
await vault.createFolder("Inbox");
await vault.create("Inbox/Facture EDF.pdf", "");
await vault.create("Inbox/photo.jpg", "");
const inbox = await plugin.openInbox();
await sleep(300);
const ibEl = inbox?.contentEl;
const ibRow = (path) => ibEl?.querySelector(`.tag-everything-inbox-row[data-path="${path}"]`);
check("inbox: opens, lists the new untagged files, newest first", !!ibRow("Inbox/Facture EDF.pdf") && !!ibRow("Inbox/photo.jpg") && inbox.files().slice(0, 2).every((f) => f.path.startsWith("Inbox/")), inbox?.files().slice(0, 4).map((f) => f.path).join());
check("inbox: no rule yet: says what rules do", /Auto-tag rules tag files for you/.test(ibEl?.textContent ?? ""));
ibRow("Inbox/Facture EDF.pdf")?.querySelector('[data-action="wand-sparkles"]')?.click();
await sleep(200);
const ruleEl = document.querySelector(".tag-everything-rule-modal");
const ruleInputs = [...(ruleEl?.querySelectorAll("input") ?? [])];
check("rule: from a file, prefilled with its folder and extension", ruleInputs[0]?.value === "Inbox" && ruleInputs[2]?.value === "pdf", ruleInputs.map((i) => i.value).join("|"));
ruleInputs[1].value = "facture";
ruleInputs[3].value = "energie facture";
ruleInputs[3].dispatchEvent(new Event("input"));
check("rule: live preview of what it matches", /In Inbox · name has facture · pdf → energie facture\. Matches 1 file of the vault, 1 without tags/.test(ruleEl.querySelector(".tag-everything-rule-preview")?.textContent), ruleEl.querySelector(".tag-everything-rule-preview")?.textContent);
ruleEl.querySelector("button.mod-cta").click();
await sleep(400);
check("rule: saved to data.json", (await plugin.loadData())?.rules?.[0]?.tags?.join() === "energie,facture", JSON.stringify((await plugin.loadData())?.rules));
const ibChip = (tag) => ibRow("Inbox/Facture EDF.pdf")?.querySelector(`.tag-everything-chip[data-tag="${tag}"]`);
check("inbox: the row shows the rule's tags", ibChip("energie")?.hasClass("is-selected") && !!ibChip("facture"));
ibChip("facture").click();
await sleep(300);
check("inbox: a rule tag clicked is left out", !ibChip("facture")?.hasClass("is-selected"));
ibRow("Inbox/Facture EDF.pdf")?.querySelector('[data-action="check"]')?.click();
await waitFor(() => !!file("Inbox/Facture EDF[energie].pdf"));
await sleep(300);
check("inbox: ✓ adds the rule tags left on, the file leaves the inbox", !!file("Inbox/Facture EDF[energie].pdf") && !ibRow("Inbox/Facture EDF[energie].pdf"));
ibRow("Inbox/photo.jpg")?.querySelector('[data-action="x"]')?.click();
await sleep(400);
check("inbox: dismissed, saved", !ibRow("Inbox/photo.jpg") && (await plugin.loadData())?.inboxDismissed?.includes("Inbox/photo.jpg"));
const ruleDefs = settingTab?.getSettingDefinitions().find((d) => d.heading === "Auto-tag rules");
check("settings: the rules listed, with add and delete", ruleDefs?.type === "list" && ruleDefs.items?.[0]?.name === "In Inbox · name has facture · pdf → energie facture" && !!ruleDefs.addItem && !!ruleDefs.onDelete, ruleDefs?.items?.map((i) => i.name).join());
plugin.settings.autoApplyRules = true;
await vault.create("Inbox/Facture GDF.pdf", "");
await waitFor(() => !!file("Inbox/Facture GDF[energie facture].pdf"), 6000);
check("inbox: with the setting on, a new file gets its rule tags on arrival", !!file("Inbox/Facture GDF[energie facture].pdf"), vault.getFiles().filter((f) => f.path.startsWith("Inbox/")).map((f) => f.path).join());
check("command: open the inbox registered", !!app.commands.commands["tag-everything:open-inbox"]);
plugin.settings.autoApplyRules = false;
plugin.settings.rules = [];
plugin.settings.inboxDismissed = [];
await plugin.saveSettings();
inbox?.leaf.detach();
await vault.delete(file("Inbox"), true);
document.querySelectorAll(".notice").forEach((n) => n.remove());

// ---- extension tags: read from the name, first in the item's tags, before its name in the explorer, never edited
plugin.settings.extensionTags = true;
await plugin.saveSettings();
await sleep(300);
const pdfPath = vault.getFiles().find((f) => f.extension === "pdf")?.path;
check("ext: a file's extension is its first tag", plugin.index.tagsOf(pdfPath)[0] === "pdf" && plugin.index.tagsOf("report.md")[0] === "md", `${plugin.index.tagsOf(pdfPath)} / ${plugin.index.tagsOf("report.md")}`);
check("ext: counted for every file, not for folders", plugin.index.counts().get("md") === vault.getMarkdownFiles().length && !plugin.index.get("Projects/Alpha").ext.length);
check("ext: not an own tag (never written, never fixed)", !plugin.index.ownTagsOf("report.md").includes("md") && !plugin.index.counts(undefined, true).has("md"));
check("ext: saved in data.json", (await plugin.loadData())?.extensionTags === true);
plugin.editTags([file("report.md")]);
await sleep(300);
const extChips = [...document.querySelectorAll(".tag-everything-modal .tag-everything-chip")].map((c) => c.firstChild?.textContent);
check("ext: not in the tag editor", extChips.length > 0 && !extChips.includes("md"), extChips.join());
document.querySelector(".tag-everything-modal .modal-close-button, .tag-everything-modal .modal-header-button")?.click();
await sleep(200);
// The PDF sits in a collapsed folder: reveal it, its row is only in the page once shown.
app.workspace.getLeavesOfType("file-explorer")[0]?.view.revealInFolder?.(file(pdfPath));
await sleep(300);
plugin.badges.refresh();
await sleep(300);
const rowOf = (p) => app.workspace.getLeavesOfType("file-explorer")[0]?.view.fileItems?.[p]?.selfEl;
const pdfRow = rowOf(pdfPath);
const extChip = pdfRow?.querySelector(":scope > .tag-everything-ext");
const pdfName = pdfRow?.querySelector(".nav-file-title-content");
check(
  "ext: explorer chip before the file name",
  extChip?.textContent === "pdf" && pdfRow.firstElementChild === extChip && !!pdfName && extChip.getBoundingClientRect().width > 0 && extChip.getBoundingClientRect().right <= pdfName.getBoundingClientRect().left,
  pdfRow?.innerHTML.slice(0, 300),
);
check("ext: note rows get theirs", rowOf("report.md")?.querySelector(":scope > .tag-everything-ext")?.textContent === "md");
const obsidianLabel = pdfRow?.querySelector(":scope > .nav-file-tag");
check("ext: Obsidian's own extension label hidden on the row", !!obsidianLabel && getComputedStyle(obsidianLabel).display === "none", obsidianLabel?.outerHTML);
// Panel results: the extension chip in place of the file icon, the other tags below without it.
const resultRow = (name) => [...panel().querySelectorAll(".tag-everything-result")].find((r) => r.querySelector(".tag-everything-result-name")?.textContent === name);
const rowChips = (r) => [...(r?.querySelectorAll(".tag-everything-result-tags .tag-everything-chip") ?? [])].map((c) => c.dataset.tag).join();
const reportTags = plugin.index.ownTagsOf("report.md");
const panelState = view.getState(); // the group search set up for the screenshot, put back below
await plugin.showTag(reportTags[0]);
await sleep(300);
const reportResult = resultRow("report.md");
check(
  "ext: panel result shows the extension chip instead of the icon, the other tags below",
  reportResult?.firstElementChild?.matches(".tag-everything-result-ext") && reportResult.firstElementChild.textContent === "md" && !reportResult.querySelector(".tag-everything-result-icon") && rowChips(reportResult) === reportTags.join(),
  reportResult?.innerHTML.slice(0, 400),
);
await plugin.showTag("pdf");
await sleep(300);
const pdfResult = resultRow(pdfPath.split("/").pop());
check("ext: panel result of the PDF: pdf chip first, not repeated below", pdfResult?.firstElementChild?.textContent === "pdf" && !rowChips(pdfResult).split(",").includes("pdf"), pdfResult?.innerHTML.slice(0, 400));
await plugin.showTag(reportTags[0]);
plugin.settings.extensionTags = false;
await plugin.saveSettings();
await sleep(300);
check(
  "ext: turned off, gone from the index, the explorer and the panel (file icon back)",
  !plugin.index.tagsOf(pdfPath).includes("pdf") && !document.querySelector(".nav-files-container .tag-everything-ext") && getComputedStyle(obsidianLabel).display !== "none" &&
    !!resultRow("report.md")?.querySelector(".tag-everything-result-icon") && !panel().querySelector(".tag-everything-result-ext"),
);
plugin.settings.extensionTags = true;
await plugin.saveSettings();
await view.setState(panelState, { history: false });
await sleep(300);

// ---- TagEverything explorer: a tree of tags. Every file can show (even those the core explorer hides); inside a tag,
// only the tags telling its files apart are branches, a file alone under a tag shows directly; a file row is its
// extension chip, its name and the tag-count pill.
check("explorer: command and page-preview source registered", !!app.commands.commands["tag-everything:open-explorer"] && !!app.workspace.hoverLinkSources?.["tag-everything-explorer"]);
vault.setConfig("showUnsupportedFiles", false); // as in the owner's vault: the core explorer hides Office files
const docx = await vault.createBinary("Docs/board[kpi q1].docx", new ArrayBuffer(4));
const sales = await vault.createBinary("Docs/sales[kpi q1].xlsx", new ArrayBuffer(4));
const forecast = await vault.createBinary("Docs/forecast[kpi q2].xlsx", new ArrayBuffer(4));
await waitFor(() => plugin.index.tagsOf(forecast.path).includes("kpi"));
const explorer = await plugin.openExplorer();
await sleep(300);
const exEl = explorer?.contentEl;
check(
  "explorer: opens in the left sidebar, named after the plugin, no folder mode",
  !!explorer && explorer.leaf.getRoot() === app.workspace.leftSplit && explorer.getDisplayText() === "TagEverything explorer" && !exEl.querySelector(".tag-everything-explorer-mode"),
);
const exTabIcon = document.querySelector('.workspace-tab-header[data-type="tag-everything-explorer"] svg');
check("explorer: its own tag-tree icon on the sidebar tab", exTabIcon?.querySelectorAll("path").length === 4 && exTabIcon.getBoundingClientRect().width > 0, exTabIcon?.outerHTML.slice(0, 200));
exEl.querySelector(".tag-everything-explorer-collapse").click();
await sleep(100);
const exKey = (r) => r.dataset.tag ?? r.dataset.path;
const exTop = () => [...exEl.querySelectorAll(".tag-everything-explorer-tree > .tree-item > .tree-item-self")].map(exKey);
const tagRow = (...trail) => [...exEl.querySelectorAll(".tag-everything-explorer-row.is-tag")].find((r) => r.dataset.trail === trail.join("\u001f"));
// a tag row's children (Obsidian's tree classes: .tree-item > .tree-item-self + .tree-item-children); null when closed
const childrenOf = (row) => {
  const box = row?.parentElement.querySelector(":scope > .tree-item-children");
  return box ? [...box.querySelectorAll(":scope > .tree-item > .tree-item-self")].map(exKey).join() : null;
};
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const ownTags = [...plugin.index.counts(undefined, true).keys()].sort(byName);
check("explorer: the root lists every stored tag by name, no extension tag, no file", exTop().join() === ownTags.join() && !exTop().includes("md"), exTop().join(" | "));
// the formula box: autocompletes the tag being typed, a picked tag becomes a chip with a ×; the tree then holds only
// the matching items
const exSearch = exEl.querySelector(".tag-everything-explorer-input");
const exType = async (text) => {
  exSearch.focus();
  exSearch.value = text;
  exSearch.setSelectionRange(text.length, text.length);
  exSearch.dispatchEvent(new Event("input"));
  await sleep(150);
};
const exKey2 = async (key) => {
  exSearch.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await sleep(100);
};
const exStatus = () => exEl.querySelector(".tag-everything-explorer-status")?.textContent ?? "";
// the box as read: chips by tag (negated ones as !tag) and the operators between them
const exChips = () =>
  [...exEl.querySelectorAll(".tag-everything-explorer-search .tag-everything-formula > *")]
    .map((el) => (el.dataset.tag ? (el.hasClass("is-negated") ? "!" : "") + el.dataset.tag : el.textContent))
    .filter((t) => t !== "NOT")
    .join(" ");
const rootFor = (match) => [...plugin.index.counts(plugin.index.paths().filter(match), true).keys()].sort(byName);
const has = (t) => (p) => plugin.index.hasTag(p, t);
await exType("KP");
const exSuggested = [...document.querySelectorAll(".suggestion-container .tag-everything-suggestion")];
check("explorer: the formula box suggests the tags containing what is typed", exSuggested.map((el) => el.firstChild.textContent).join() === "kpi", exSuggested.map((el) => el.textContent).join(" | "));
check("explorer: a tag still being typed is left out, the whole tree stays", exTop().join() === ownTags.join() && exStatus().includes("No item carries KP"), exStatus());
(exSuggested[0]?.closest(".suggestion-item") ?? exSuggested[0])?.click();
await sleep(150);
const nKpi = plugin.index.paths().filter(has("kpi")).length;
check(
  "explorer: a picked suggestion becomes a chip in the box; the tree holds only the items carrying it",
  exChips() === "kpi" && exSearch.value === "" && exTop().join() === rootFor(has("kpi")).join() && exStatus() === `${nKpi === 1 ? "1 item matches" : `${nKpi} items match`} kpi`,
  `[${exChips()}] "${exSearch.value}" / ${exTop().join(" | ")} / ${exStatus()}`,
);
await exKey2("Enter");
check("explorer: Enter opens the tags the formula requires", childrenOf(tagRow("kpi")) === `q1,${forecast.path}`, childrenOf(tagRow("kpi")));
await exType("AND");
check("explorer: a syntax error is said, the chips' search stays", exTop().join() === rootFor(has("kpi")).join() && exStatus().includes("missing") && exEl.querySelector(".tag-everything-explorer-status").hasClass("mod-warning"), exStatus());
await exType("OR shared");
await exKey2("Enter");
const kpiOrShared = (p) => has("kpi")(p) || has("shared")(p);
check("explorer: text typed after the chips joins them (OR), Enter turns it into chips", exChips() === "kpi OR shared" && exSearch.value === "" && exTop().join() === rootFor(kpiOrShared).join(), `[${exChips()}] / ${exTop().join(" | ")}`);
exEl.querySelector('.tag-everything-explorer-search .tag-everything-chip[data-tag="kpi"] .tag-everything-chip-remove')?.click();
await sleep(100);
check("explorer: a chip's × removes its tag from the search", exChips() === "shared" && exTop().join() === rootFor(has("shared")).join() && exStatus().endsWith("match shared"), `[${exChips()}] / ${exStatus()}`);
await exKey2("Escape");
await exType("shared et non final");
await exKey2("Enter");
const sharedNotFinal = (p) => has("shared")(p) && !has("final")(p);
check(
  "explorer: a formula with NOT (French words too): chips, NOT struck, only the matching items",
  exChips() === "shared AND !final" && exTop().length > 0 && exTop().join() === rootFor(sharedNotFinal).join() && exStatus().endsWith("shared AND NOT final"),
  `[${exChips()}] / ${exTop().join(" | ")} / ${exStatus()}`,
);
await exKey2("Backspace");
check("explorer: Backspace in the empty box removes the last chip", exChips() === "shared", exChips());
await exKey2("Escape");
check("explorer: Escape clears the formula box, the whole tree back", exSearch.value === "" && exChips() === "" && exTop().join() === ownTags.join());
exEl.querySelector(".tag-everything-explorer-collapse").click();
await sleep(100);
tagRow("kpi").click();
await sleep(100);
check("explorer: opening a tag: q1 on two of its files is a branch, the file alone under q2 shows directly", childrenOf(tagRow("kpi")) === `q1,${forecast.path}` && tagRow("kpi").getAttribute("aria-expanded") === "true" && !tagRow("kpi").querySelector(".collapse-icon").hasClass("is-collapsed"), childrenOf(tagRow("kpi")));
tagRow("kpi", "q1").click();
await sleep(100);
const docxRows = () => [...exEl.querySelectorAll(".tag-everything-explorer-row")].filter((r) => r.dataset.path === docx.path);
check("explorer: a .docx hidden by Obsidian's setting sits at the end of its tag path", vault.getConfig("showUnsupportedFiles") === false && childrenOf(tagRow("kpi", "q1")) === `${docx.path},${sales.path}`, childrenOf(tagRow("kpi", "q1")));
const docxRow = docxRows()[0];
const exWhere = docxRow?.querySelector(".tag-everything-explorer-where");
check(
  "explorer: a file row is the extension chip and the name, then the tag-count pill and its real folder (on hover)",
  [...(docxRow?.querySelector(".tree-item-inner")?.children ?? [])].map((c) => c.textContent).join("|") === "docx|board[kpi q1]" &&
    docxRow.querySelector(".tree-item-flair-outer .tag-everything-count")?.textContent === "2" && exWhere?.getAttribute("aria-label")?.startsWith("In Docs."),
  docxRow?.innerHTML.slice(0, 400),
);
const exPill = docxRow?.querySelector(".tag-everything-count");
exPill?.dispatchEvent(new MouseEvent("mouseenter"));
await sleep(50);
const exList = document.querySelector(".tag-everything-badge-list");
check("explorer: hovering the pill lists the file's tags", [...(exList?.children ?? [])].map((c) => c.textContent).join() === "kpi,q1", exList?.outerHTML.slice(0, 200));
exPill?.dispatchEvent(new MouseEvent("mouseleave"));
await sleep(400);
tagRow("q1").click();
await sleep(100);
check(
  "explorer: a tag every file of the node carries is no branch (kpi under q1): the files show directly, on both paths",
  docxRows().length === 2 && childrenOf(tagRow("q1")) === `${docx.path},${sales.path}` && !tagRow("q1", "kpi"),
  childrenOf(tagRow("q1")),
);
const exSaved = explorer.getState().expanded.map((t) => t.join("/")).sort().join();
check("explorer: the open tags are saved with the workspace", exSaved === "kpi,kpi/q1,q1", exSaved);
tagRow("kpi").click();
await sleep(100);
check("explorer: clicking an open tag closes it", childrenOf(tagRow("kpi")) === null && docxRows().length === 1);
exEl.querySelector(".tag-everything-explorer-collapse").click();
await sleep(100);
// a note, reached through its own tags (opened until it shows); a click opens it, the highlight follows the editor
const exNote = vault.getMarkdownFiles().find((f) => plugin.index.ownTagsOf(f.path).length);
const noteRow = () => [...exEl.querySelectorAll(".tag-everything-explorer-row")].find((r) => r.dataset.path === exNote.path);
const exTrail = [];
for (let next; !noteRow() && (next = plugin.index.ownTagsOf(exNote.path).find((t) => !exTrail.includes(t) && tagRow(...exTrail, t))); ) {
  exTrail.push(next);
  explorer.toggle(exTrail);
}
await sleep(100);
// the real place: the TagEverything menu of a row, and the row's folder icon, show it in the file explorer
const placeMenu = fakeMenu();
app.workspace.trigger("file-menu", placeMenu, exNote, "tag-everything-explorer");
check("explorer: right-click → TagEverything → Show in the file explorer", placeMenu.sub("TagEverything")?.titles()[0] === "Show in the file explorer", placeMenu.sub("TagEverything")?.titles().join(" | "));
const coreExplorer = app.workspace.getLeavesOfType("file-explorer")[0];
noteRow()?.querySelector(".tag-everything-explorer-where")?.click();
await sleep(500);
check("explorer: the folder icon shows the file in its real place in the file explorer", coreExplorer.view.containerEl.isShown() && !!coreExplorer.view.fileItems?.[exNote.path]?.selfEl.isShown());
await app.workspace.revealLeaf(explorer.leaf);
await sleep(1000); // the file explorer's reveal finishes late
noteRow()?.click();
await sleep(300);
check("explorer: clicking a file opens it, highlighted", app.workspace.getActiveFile()?.path === exNote.path && noteRow()?.hasClass("is-active"), `${exNote.path} via ${exTrail.join(" > ")}`);
await app.workspace.getLeaf(false).openFile(vault.getMarkdownFiles().find((f) => f !== exNote));
await sleep(300);
check("explorer: the highlight follows the editor", !noteRow()?.hasClass("is-active"));
await app.workspace.getLeaf(false).openFile(exNote);
for (const f of [docx, sales, forecast]) await vault.delete(f);
vault.setConfig("showUnsupportedFiles", true);
await sleep(800); // opening a note may reveal it in the file explorer a moment later
await app.workspace.revealLeaf(explorer.leaf); // left for the screenshot: the path to that note open, the note highlighted
await sleep(300);
if (exTrail.join() === "shared") {
  // and a search in the box that still shows that note, its chips with their ×
  await exType("shared non final");
  await exKey2("Enter");
  exSearch.blur();
}

// Screenshot: the panel with its groups and a group search, one of its tags switched off.
document.querySelectorAll(".notice").forEach((n) => n.remove()); // the refusals provoked above
await sleep(300);
