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

// All's count range is on at 10–100 by default; the fixture's tags are used fewer than 10 times: off until its section.
check("tag count range on by default, 10–100", plugin.settings.tagRangeOn === true && plugin.settings.tagRangeMin === 10 && plugin.settings.tagRangeMax === 100);
plugin.settings.tagRangeOn = false;

// Sections up to "UI" exercise the name / sidecar engine on notes: frontmatter storage off for them.
check("note tags go to frontmatter by default", plugin.settings.noteTagsInFrontmatter === true);
plugin.settings.noteTagsInFrontmatter = false;

// ---- context menus: single item and multi-selection
// Every item of the plugin sits in one "TagEverything" submenu, so the user sees where it comes from.
const fileMenu = fakeMenu();
app.workspace.trigger("file-menu", fileMenu, file("report.md"), "file-explorer");
const single = fileMenu.sub("TagEverything");
check("file-menu: one TagEverything submenu, nothing else", fileMenu.titles().filter((t) => /tag|guide/i.test(t)).join() === "TagEverything", fileMenu.titles().join(" | "));
check("file-menu: Edit tags, Claude Code suggestions and Exclude in the submenu, no guide for a file", single?.titles().join() === "Edit tags,Suggest tags with Claude Code,Exclude from the tag engine", single?.titles().join(" | "));
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
check("files-menu has bulk edit, suggestions and exclude in the submenu", multiMenu.sub("TagEverything")?.titles().join() === "Edit tags of 2 items,Suggest tags with Claude Code,Exclude 2 items from the tag engine", multiMenu.titles().join(" | "));
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

// ---- a folder renamed with "Follow renames" off: its files' sidecars moved with its .ts folder, their tags stay
plugin.settings.followRenames = false;
await app.fileManager.renameFile(file("Projects"), "Projects2");
await waitFor(() => plugin.index.tagsOf("Projects2/spec.md").length > 0, 2000);
check("rename: a folder renamed with Follow renames off keeps its files' sidecar tags", plugin.index.tagsOf("Projects2/spec.md").join() === "final" && plugin.index.tagsOf("Projects2/Alpha").join() === "client,2026", plugin.index.tagsOf("Projects2/spec.md").join());
await app.fileManager.renameFile(file("Projects2"), "Projects");
await waitFor(() => plugin.index.tagsOf("Projects/spec.md").length > 0, 2000);
plugin.settings.followRenames = true;
check("rename: and back", plugin.index.tagsOf("Projects/spec.md").join() === "final" && !!file("Projects/Alpha"));

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
  check("settings: declarative rows, indexed for settings search", names.includes("Store file tags in") && names.includes("Badges for") && names.includes("Claude Code program") && names.includes("Model") && names.includes("Used at least") && names.includes("Used at most"), JSON.stringify(names));
  check("settings: tab has an icon", settingTab.icon === "tags", String(settingTab.icon));
  // Through the real dialog: the badges toggle disables / enables the badge option and is saved.
  app.setting.open();
  app.setting.openTabById("tag-everything");
  await sleep(300);
  const el = settingTab.containerEl;
  const row = (name) => [...el.querySelectorAll(".setting-item")].find((i) => i.querySelector(".setting-item-name")?.textContent === name);
  const disabledCount = () => el.querySelectorAll(".setting-item.is-disabled").length;
  const toggle = row("Show tag badges")?.querySelector(".checkbox-container");
  // The naming rule is on by default: "Lower-case new tags" is implied, so disabled; the count range is off here
  // (turned off at the start), so its two numbers are disabled too (3 rows).
  const isDisabled = (name) => !!row(name)?.classList.contains("is-disabled");
  check("settings: rendered in the settings dialog", !!toggle && !!row("Store file tags in") && disabledCount() === 3 && isDisabled("Lower-case new tags"), String(disabledCount()));
  check("settings: the count range's numbers disabled while it is off", isDisabled("Used at least") && isDisabled("Used at most") && !isDisabled("Only tags used a number of times"));
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
  check("settings: badge option disabled while badges are off", off === 4 && saved === false, `disabled=${off} saved=${saved}`);
  check("settings: enabled again, setting saved", plugin.settings.showBadges === true && disabledCount() === 3 && (await plugin.loadData())?.showBadges === true);
  // Tag maintenance: settings hold options only; one row leads to the panel's Tools tab, where the actions are.
  check("settings: no maintenance action, one row leading to the Tools tab", names.includes("Tag tools") && !names.includes("Re-read all tags") && !names.includes("Check and fix tag names"), JSON.stringify(names));
  row("Tag tools")?.querySelector("button")?.click();
  await sleep(400);
  const toolsFromSettings = app.workspace.getLeavesOfType("tag-everything-view")[0]?.view;
  check("settings: Tag tools opens the panel on its Tools tab", toolsFromSettings?.getState().page === "tools" && !!toolsFromSettings.contentEl.querySelector('.tag-everything-tools [data-action="reindex"]'), JSON.stringify(toolsFromSettings?.getState()));
  toolsFromSettings?.showAll();
  app.setting.close();
} else check("settings: tab found", false);

// ---- tag groups in the panel: create, drag tags in, fold, select = search over the group's tags
const panel = () => document.querySelector(".tag-everything-view");
// A group of the Groups section (the Selection tab draws the group searching too: selCard below).
const groupEl = (name) =>
  [...panel().querySelectorAll(".tag-everything-view-groups .tag-everything-group")].find((g) => g.querySelector(".tag-everything-group-name")?.textContent === name);
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
check("groups: empty state shown", plugin.settings.groups.length === 0 && !!panel().querySelector(".tag-everything-section-head"));
check("panel: the tags have their own titled section under the groups", panel().querySelector(".tag-everything-tags-head .tag-everything-section-title")?.textContent === "Tags" && !!panel().querySelector(".tag-everything-view-groups + .tag-everything-tags-head + .tag-everything-view-tags"));
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
view.page = null; // back on All, where the group searching shows
groupEl("Shared docs").querySelector(".tag-everything-group-header").click();
await sleep(200);
check("groups: clicking the active group shows its results, the search kept", view.page === "selection" && results() === 1 && !!panel().querySelector(".tag-everything-group.is-active"));
view.selectGroup(groupEl("Shared docs").dataset.group);
await sleep(200);
check("groups: selecting the active group again clears the search", results() === 0 && !panel().querySelector(".tag-everything-group.is-active"));
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
const fModal = document.querySelector(".tag-everything-group-modal");
const fInput = fModal?.querySelector(".tag-everything-formula-input");
check("formula: one dialog, name and formula, starting from the group's", fModal?.querySelector(".tag-everything-group-input")?.value === "Formula" && fInput?.value === "shared", fInput?.value);
fInput.value = "(shared ou b27";
fInput.dispatchEvent(new Event("input"));
await sleep(100);
check("formula: syntax error shown live", /not closed/.test(fModal.querySelector(".tag-everything-error").textContent), fModal.querySelector(".tag-everything-error").textContent);
fModal.querySelector(".mod-cta").click();
await sleep(200);
check("formula: invalid formula not saved, dialog stays", !!document.querySelector(".tag-everything-group-modal") && !plugin.settings.groups.find((g) => g.id === formulaId).formula);
fInput.value = "(shared ou b27) et (final OU INC)";
fInput.dispatchEvent(new Event("input"));
await sleep(100);
const fPreview = fModal.querySelector(".tag-everything-formula-preview").textContent;
check("formula: preview in canonical form, with the vault's spelling and the count", fPreview.includes("(shared OR B27) AND (final OR INC)") && fPreview.includes("2 items"), fPreview);
fModal.querySelector(".mod-cta").click();
await sleep(300);
const fGroup = () => plugin.settings.groups.find((g) => g.id === formulaId);
check("formula: saved, tags = the formula's", !document.querySelector(".tag-everything-group-modal") && fGroup().formula === "(shared OR B27) AND (final OR INC)" && fGroup().tags.join() === "shared,B27,final,INC", JSON.stringify(fGroup()));
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
check("NOT: excluding a cloud tag lists the items without it", withoutShared > 0 && results() === withoutShared && notOps === "NOT" && !!panel().querySelector(".tag-everything-view-selected .tag-everything-chip.is-negated") && cloudChip("shared")?.matches(".is-selected.is-negated"), `${results()} vs ${withoutShared}`);
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
// Selection tab: a search moves to it (search, narrowing tags, results); All keeps every tag, the search's marked.
const shown = (cls) => getComputedStyle(panel().querySelector(cls)).display !== "none";
const selTab = () => panel().querySelector(".tag-everything-tab-selection");
const allTab = () => [...panel().querySelectorAll(".tag-everything-tab")].find((t) => t.textContent === "All");
check(
  "selection tab: a selected tag switches to it, results only",
  selTab()?.classList.contains("is-active") && selTab().textContent === "Selection1" && !allTab().classList.contains("is-active") &&
    shown(".tag-everything-view-results") && shown(".tag-everything-view-selected") && !shown(".tag-everything-view-tags") && !shown(".tag-everything-view-groups") &&
    view.getState().selection === true,
  selTab()?.outerHTML,
);
allTab().click();
await sleep(100);
const allChips = () => [...panel().querySelectorAll(".tag-everything-view-tags > .tag-everything-chip")];
check(
  "selection tab: All shows only the groups and every tag, vault counts, the selected one marked",
  allTab().classList.contains("is-active") && !selTab().classList.contains("is-active") && shown(".tag-everything-view-tags") && shown(".tag-everything-view-groups") &&
    !shown(".tag-everything-view-results") && !shown(".tag-everything-view-selected") && !shown(".tag-everything-view-refine") &&
    allChips().length === plugin.index.counts().size && cloudChip("client")?.classList.contains("is-selected") &&
    allChips().every((c) => c.querySelector(".tag-everything-chip-count").textContent === String(plugin.index.counts().get(c.dataset.tag))) &&
    view.getState().selection === false,
  `${allChips().length} vs ${plugin.index.counts().size}`,
);
selTab().click();
await sleep(100);
check("selection tab: clicking it shows the search again", selTab().classList.contains("is-active") && shown(".tag-everything-view-results"));
check("selection tab: one item, no tag to narrow it", !panel().querySelector(".tag-everything-view-refine .tag-everything-chip"));
view.selectOnly("shared");
await sleep(200);
const refineChips = () => [...panel().querySelectorAll(".tag-everything-view-refine .tag-everything-refine-chips > .tag-everything-chip")];
const sharedN = results();
const refineOk = refineChips().length > 0 && refineChips().every((c) => {
  const n = Number(c.querySelector(".tag-everything-chip-count").textContent);
  return c.dataset.tag !== "shared" && n > 0 && n < sharedN;
});
check("selection tab: the tags that narrow it, counted in it", shown(".tag-everything-view-refine") && refineOk, refineChips().map((c) => c.textContent).join() + ` / ${sharedN}`);
// one size: no cloud weight (the fixture's counts are too close to tell sizes apart)
const sizes = new Set(refineChips().map((c) => getComputedStyle(c).fontSize + (c.style.getPropertyValue("--tag-everything-weight") ? " weighted" : "")));
check(
  "selection tab: titled sections Narrow and Results with their counts, narrowing chips one size, the search in a card",
  panel().querySelector(".tag-everything-refine-head")?.textContent === `Narrowcounted in the ${sharedN} items` &&
    panel().querySelector(".tag-everything-view-status.tag-everything-section-head")?.textContent === `Results${sharedN} items` &&
    sizes.size === 1 && ![...sizes][0].endsWith("weighted") && getComputedStyle(panel().querySelector(".tag-everything-view-selected")).borderTopStyle === "solid",
  panel().querySelector(".tag-everything-refine-head")?.textContent + " / " + panel().querySelector(".tag-everything-view-status")?.textContent + " / " + [...sizes].join(),
);
const narrowTag = refineChips()[0]?.dataset.tag;
refineChips()[0]?.click();
await sleep(200);
check(
  "selection tab: a narrowing tag clicked joins the search, stays in Selection",
  view.getState().selected.join() === `shared,${narrowTag}` && results() < sharedN && selTab().classList.contains("is-active") && !refineChips().some((c) => c.dataset.tag === narrowTag),
  JSON.stringify(view.getState().selected),
);
allTab().click();
await sleep(100);
cloudChip(narrowTag).click();
await sleep(100);
check("selection tab: a marked tag clicked in All leaves the search", view.getState().selected.join() === "shared" && !cloudChip(narrowTag).classList.contains("is-selected"), JSON.stringify(view.getState().selected));
selTab().click();
await sleep(100);
// The Selection tab's Formula… button: the search as a formula (no name), run at once; Save as group is its own icon.
const formulaBtn = () => panel().querySelector(".tag-everything-view-selected .tag-everything-view-formula");
const searchChipBottom = panel().querySelector(".tag-everything-view-selected > .tag-everything-chip")?.getBoundingClientRect().bottom ?? Infinity;
check(
  "formula button: in the Selection tab, labelled, with Clear on their own line under the search",
  formulaBtn()?.textContent === "Formula…" && formulaBtn().parentElement.matches(".tag-everything-view-actions") &&
    !!formulaBtn().parentElement.querySelector(".tag-everything-view-clear") && formulaBtn().getBoundingClientRect().top >= searchChipBottom,
  formulaBtn()?.outerHTML,
);
// Each button: its own icon, centred on its label (not on the text baseline).
const iconOf = (b) => b?.querySelector(".tag-everything-button-icon svg");
// Icon centre minus the label's centre, in px.
const iconOffset = (b) => {
  const i = iconOf(b)?.getBoundingClientRect();
  const t = b?.querySelector(".tag-everything-button-icon + span")?.getBoundingClientRect();
  return i && t && i.height > 0 ? i.top + i.height / 2 - (t.top + t.height / 2) : NaN;
};
const centred = (b) => Math.abs(iconOffset(b)) <= 0.5;
const clearBtn = () => panel().querySelector(".tag-everything-view-selected .tag-everything-view-clear");
check(
  "selection buttons: Formula… and Clear each have their icon, centred on the label",
  iconOf(formulaBtn())?.classList.contains("lucide-square-function") && iconOf(clearBtn())?.classList.contains("lucide-search-x") && centred(formulaBtn()) && centred(clearBtn()),
  `${iconOf(formulaBtn())?.getAttribute("class")} / ${iconOf(clearBtn())?.getAttribute("class")} / offsets ${iconOffset(formulaBtn())} ${iconOffset(clearBtn())}`,
);
formulaBtn().click();
await sleep(300);
const gModal = document.querySelector(".tag-everything-group-modal");
const gInput = gModal?.querySelector(".tag-everything-formula-input");
const opButtons = [...(gModal?.querySelectorAll(".tag-everything-formula-op") ?? [])];
check(
  "formula button: edits the search as a formula, no name to give, with operator buttons",
  gModal?.querySelector(".modal-title")?.textContent === "Search formula" && !gModal.querySelector(".tag-everything-group-input") && gInput?.value === "shared" &&
    opButtons.map((b) => b.textContent).join(" ") === "AND OR NOT ( ) Date" && gModal.querySelector(".mod-cta")?.textContent === "Search",
  `${gInput?.value} / ${opButtons.map((b) => b.textContent)}`,
);
gInput.setSelectionRange(gInput.value.length, gInput.value.length);
opButtons.find((b) => b.textContent === "OR").click();
gInput.value += "b27";
gInput.dispatchEvent(new Event("input"));
await sleep(100);
const eitherN = plugin.index.paths().filter((p) => plugin.index.hasTag(p, "shared") || plugin.index.hasTag(p, "B27")).length;
check("formula button: OR inserted with its spaces, live count", gInput.value === "shared OR b27" && gModal.querySelector(".tag-everything-formula-preview").textContent.includes(`shared OR B27  →  ${eitherN} items`), gModal.querySelector(".tag-everything-formula-preview").textContent);
const groupsBefore = plugin.settings.groups.length;
gModal.querySelector(".mod-cta").click();
await sleep(300);
const formulaChip = () => panel().querySelector(".tag-everything-view-selected .tag-everything-formula-chip");
check(
  "formula button: Search runs it as the search, one formula chip, no group saved",
  !document.querySelector(".tag-everything-group-modal") && view.getState().formula === "shared OR B27" && !view.getState().selected.length && formulaChip()?.textContent === "shared OR B27" &&
    plugin.settings.groups.length === groupsBefore && selTab().classList.contains("is-active") && results() === eitherN,
  JSON.stringify(view.getState()) + ` ${results()} vs ${eitherN}`,
);
const saveGroupBtn = () => panel().querySelector(".tag-everything-view-selected .tag-everything-view-save-group");
check("formula button: Save as group is its own icon next to it", iconOf(saveGroupBtn())?.classList.contains("lucide-folder-plus") && saveGroupBtn()?.getAttribute("aria-label") === "Save this search as a group", saveGroupBtn()?.outerHTML);
await snap("search-formula");
saveGroupBtn().click();
await sleep(300);
const sgModal = document.querySelector(".tag-everything-group-modal");
check("formula button: Save as group asks a name, the formula filled", sgModal?.querySelector(".modal-title")?.textContent === "New group from this search" && sgModal.querySelector(".tag-everything-formula-input")?.value === "shared OR B27", sgModal?.querySelector(".tag-everything-formula-input")?.value);
sgModal.querySelector(".tag-everything-group-input").value = "Either";
sgModal.querySelector(".mod-cta").click();
await sleep(300);
const either = plugin.settings.groups.find((g) => g.name === "Either");
check(
  "formula button: saved as a group, its search runs at once",
  !document.querySelector(".tag-everything-group-modal") && either?.formula === "shared OR B27" && view.getState().activeGroup === either.id && !view.getState().formula && selTab().classList.contains("is-active") && results() === eitherN,
  JSON.stringify(either) + ` ${results()} vs ${eitherN}`,
);
check(
  "formula button: on a group search it edits the group, with a pencil",
  formulaBtn()?.textContent === "Edit group" && /lucide-(pencil|edit-3)\b/.test(iconOf(formulaBtn())?.getAttribute("class")) && centred(formulaBtn()),
  `${iconOf(formulaBtn())?.getAttribute("class")} offset ${iconOffset(formulaBtn())}`,
);
groupEl("Either").querySelector(".tag-everything-group-header").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1000, clientY: 300 }));
await sleep(200);
[...document.querySelectorAll(".menu .menu-item")].find((m) => /^Delete group/.test(m.textContent))?.click();
await sleep(200);
view.selectOnly("shared");
await sleep(100);
panel().querySelector(".tag-everything-view-clear").click();
await sleep(100);
check("selection tab: gone once the search is cleared, back on All", !selTab() && allTab().classList.contains("is-active") && shown(".tag-everything-view-tags") && !panel().querySelector(".tag-everything-refine-head"));
await sleep(100);
const searchLabel = () => groupEl("Formula").querySelector(".tag-everything-group-search-label")?.textContent;
check("groups: the search button is labelled", searchLabel() === "Search", searchLabel());
groupEl("Formula").querySelector(".tag-everything-group-search").click();
await sleep(200);
// The Selection tab draws the group searching as its card in All: header (name, ⋯) above its chips with their counts.
const selCard = panel().querySelector(".tag-everything-view-selected > .tag-everything-group");
check("groups: the search button runs the group", groupEl("Formula").classList.contains("is-active") && !!selCard?.classList.contains("is-active"));
const selHeader = selCard?.querySelector(".tag-everything-group-header");
const selChips = [...(selCard?.querySelectorAll(".tag-everything-group-tags .tag-everything-chip") ?? [])];
const cardChips = [...groupEl("Formula").querySelectorAll(".tag-everything-group-tags .tag-everything-chip")];
const chipText = (c) => c.textContent;
check(
  "groups: in Selection, the group's card as in All: name and ⋯ in its header, no fold or search button, its tags below with their counts",
  selHeader?.querySelector(".tag-everything-group-name")?.textContent === "Formula" && !!selHeader.querySelector(".tag-everything-group-more") &&
    !selHeader.querySelector(".tag-everything-group-fold, .tag-everything-group-search") && selChips.length > 0 &&
    selChips.every((c) => c.querySelector(".tag-everything-chip-count")) && selChips.map(chipText).join() === cardChips.map(chipText).join() &&
    selHeader.getBoundingClientRect().bottom <= selChips[0].getBoundingClientRect().top,
  `${selChips.map(chipText)} vs ${cardChips.map(chipText)}`,
);
selHeader?.querySelector(".tag-everything-group-more")?.click();
await sleep(200);
const selMenu = [...document.querySelectorAll(".menu .menu-item")].map((m) => m.textContent);
check("groups: its ⋯ in Selection is the group menu, without Show in Selection", selMenu[0] === "Stop the search" && !selMenu.some((t) => /^Show in Selection/.test(t)), selMenu.join(" | "));
document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
document.querySelectorAll(".menu").forEach((m) => m.remove());
await sleep(100);
allTab().click();
await sleep(200);
check("groups: on the group searching, the button leads to Selection", searchLabel() === "Selection" && !selTab()?.classList.contains("is-active"), searchLabel());
groupEl("Formula").querySelector(".tag-everything-group-search").click();
await sleep(200);
check("groups: and opens the Selection tab, the search kept", selTab()?.classList.contains("is-active") && groupEl("Formula").classList.contains("is-active"));
groupEl("Formula").querySelector(".tag-everything-group-more").click();
await sleep(200);
[...document.querySelectorAll(".menu .menu-item")].find((m) => m.textContent === "Stop the search")?.click();
await sleep(200);
check("groups: ⋯ → Stop the search clears it", !panel().querySelector(".tag-everything-group.is-active"));

// ---- the tag count range in All: "used [10] to [100] times  See all" in the Tags heading. A number typed applies at once (the box
// keeps the focus), Enter / leaving the box saves; See all shows every tag. Tags in the search, and every tag while
// filtering by name, stay.
{
  const counts = plugin.index.counts();
  const top = Math.max(...counts.values()); // the most used count: the rarer tags are hidden
  const within = (a, b) => [...counts].filter(([, n]) => n >= a && (!b || n <= b)).map(([t]) => t).sort().join();
  const cloudTags = () => [...panel().querySelectorAll(".tag-everything-view-tags > .tag-everything-chip")].map((e) => e.firstChild.textContent).sort().join();
  const box = (b) => panel().querySelector(`.tag-everything-tags-head .tag-everything-range-input[data-bound="${b}"]`);
  const seeAll = () => panel().querySelector(".tag-everything-tags-head .tag-everything-range-all");
  const headCount = () => panel().querySelector(".tag-everything-tags-head .tag-everything-section-count")?.textContent;
  const type = async (b, text) => {
    box(b).focus();
    box(b).value = text;
    box(b).dispatchEvent(new Event("input"));
    await sleep(200);
  };
  const commit = async (b) => {
    box(b).dispatchEvent(new Event("change"));
    box(b).blur();
    await sleep(300);
  };
  const rare = [...counts].find(([, n]) => n < top)?.[0];
  check("range: off, every tag shown; the boxes say 10 and 100, See all pressed", allTab().classList.contains("is-active") && cloudTags().split(",").length === counts.size && box("min")?.value === "10" && box("max")?.value === "100" && seeAll()?.classList.contains("is-active"), `${cloudTags()} / ${box("min")?.value}`);
  const minEl = box("min");
  await type("min", String(top));
  const want = within(top, 100);
  check(
    "range: a number typed applies at once, See all off, the count says of how many, the box keeps the focus",
    plugin.settings.tagRangeOn && cloudTags() === want && want.split(",").length < counts.size && headCount() === `${want.split(",").length} of ${counts.size}` && !seeAll().classList.contains("is-active") && box("min") === minEl && document.activeElement === minEl,
    `${cloudTags()} vs ${want} / ${headCount()}`,
  );
  await commit("min");
  check("range: saved when the box is left", (await plugin.loadData())?.tagRangeMin === top && (await plugin.loadData())?.tagRangeOn === true);
  check("range: a rare tag outside it is hidden", !!rare && !cloudChip(rare), rare);
  view.selectOnly(rare);
  await sleep(100);
  allTab().click();
  await sleep(200);
  check("range: a tag in the search stays shown, marked", cloudChip(rare)?.classList.contains("is-selected"));
  cloudChip(rare)?.click();
  await sleep(200);
  allTab().click();
  await sleep(200);
  const filterBox = panel().querySelector(".tag-everything-view-search");
  filterBox.value = rare;
  filterBox.dispatchEvent(new Event("input"));
  await sleep(200);
  check("range: filtering by name finds every tag", !!cloudChip(rare) && !view.getState().selected.length);
  filterBox.value = "";
  filterBox.dispatchEvent(new Event("input"));
  await sleep(200);
  await type("max", "");
  await commit("max");
  check("range: an empty max = no limit, saved", plugin.settings.tagRangeMax === 0 && box("max").value === "" && cloudTags() === within(top, 0) && (await plugin.loadData())?.tagRangeMax === 0);
  await type("min", "abc");
  await commit("min");
  check("range: an unreadable number goes back to the stored one", box("min").value === String(top) && plugin.settings.tagRangeMin === top, box("min").value);
  seeAll().click();
  await sleep(300);
  check("range: See all shows every tag, keeps the numbers, saved", !plugin.settings.tagRangeOn && cloudTags().split(",").length === counts.size && headCount() === String(counts.size) && box("min").value === String(top) && seeAll().classList.contains("is-active") && (await plugin.loadData())?.tagRangeOn === false);
}

// ---- sections: groups and tags sorted under foldable headings in All, each in one section at most, saved
const tabEl = (name) => [...panel().querySelectorAll(".tag-everything-tab")].find((t) => t.textContent === name);
const topGroups = () => [...panel().querySelectorAll(".tag-everything-view-groups > .tag-everything-group .tag-everything-group-name")].map((e) => e.textContent).join();
const sectionEl = (name) => [...panel().querySelectorAll(".tag-everything-panel-section")].find((x) => x.querySelector(".tag-everything-panel-section-name")?.textContent === name);
const sectionOf = (name) => plugin.settings.tabs.find((t) => t.name === name);
const openMenu = async (el) => {
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1000, clientY: 300 }));
  await sleep(200);
};
const menuClick = async (title) => {
  const item = [...document.querySelectorAll(".menu .menu-item")].find((m) => (typeof title === "string" ? m.textContent === title : title.test(m.textContent)));
  item?.click();
  await sleep(200);
  return !!item;
};
check("sections: no bookmark tab any more, All first and active", panel().querySelector(".tag-everything-tab") === tabEl("All") && tabEl("All").classList.contains("is-active") && !panel().querySelector(".tag-everything-tab-add"));
panel().querySelector(".tag-everything-view-groups .tag-everything-section-add").click();
await sleep(300);
document.querySelector(".tag-everything-group-modal input").value = " Work ";
document.querySelector(".tag-everything-group-modal .mod-cta").click();
await sleep(300);
check("sections: the folder icon of Groups creates a named section in All, empty", !!sectionEl("Work") && /Empty/.test(sectionEl("Work").textContent) && tabEl("All").classList.contains("is-active"), sectionEl("Work")?.textContent);
const dropped = dragTag(cloudChip("client"), sectionEl("Work")) && dragTag(groupEl("Formula").querySelector(".tag-everything-group-header"), sectionEl("Work"));
await sleep(200);
await openMenu(cloudChip("final"));
await menuClick('Move to the section "Work"');
check("sections: tags and a group moved in by drop and by menu", dropped && sectionOf("Work")?.tags.join() === "client,final" && sectionOf("Work").groups.join() === formulaId, JSON.stringify(sectionOf("Work")));
const workTags = () => [...(sectionEl("Work")?.querySelectorAll(".tag-everything-panel-section-tags .tag-everything-chip") ?? [])].map((c) => c.firstChild.textContent).join();
check(
  "sections: the group under its heading, not at the top; the tags there and still in Tags",
  !!sectionEl("Work").querySelector(`.tag-everything-group[data-group="${formulaId}"]`) && !topGroups().split(",").includes("Formula") && workTags() === "client,final" && !!cloudChip("client"),
  `${topGroups()} / ${workTags()}`,
);
await snap("sections"); // All with a section, to look at
sectionEl("Work").querySelector(".tag-everything-panel-section-head").click();
await sleep(200);
check("sections: a click on the heading folds it, saved", sectionOf("Work").collapsed === true && !sectionEl("Work").querySelector(".tag-everything-group") && (await plugin.loadData())?.tabs?.[0]?.collapsed === true);
sectionEl("Work").querySelector(".tag-everything-panel-section-head").click();
await sleep(200);
check("sections: saved in data.json (under tabs, readable by the versions with bookmark tabs)", (await plugin.loadData())?.tabs?.[0]?.tags?.length === 2 && !sectionOf("Work").collapsed);
await view.createSection("Home");
await sleep(200);
await openMenu(groupEl("Formula").querySelector(".tag-everything-group-header"));
const movedByMenu = await menuClick('Move to the section "Home"');
check("sections: a group moved to another section leaves the first", movedByMenu && sectionOf("Home").groups.join() === formulaId && !sectionOf("Work").groups.length, JSON.stringify(plugin.settings.tabs));
await openMenu(groupEl("Formula").querySelector(".tag-everything-group-header"));
await menuClick(/^Take out of the section "Home"/);
check("sections: taken out, the group is back at the top", !sectionOf("Home").groups.length && topGroups().split(",").includes("Formula"), topGroups());
const tempId = await view.createGroup("Temp");
await view.moveToSection(sectionOf("Home").id, "groups", tempId);
await sleep(200);
await openMenu(groupEl("Temp").querySelector(".tag-everything-group-header"));
await menuClick(/^Delete group/);
check("sections: a deleted group leaves its section", !sectionOf("Home").groups.includes(tempId) && !groupEl("Temp"), JSON.stringify(sectionOf("Home")));
await openMenu(sectionEl("Home").querySelector(".tag-everything-panel-section-head"));
await menuClick(/^Delete section/);
check("sections: a section deleted, nothing else", !sectionOf("Home") && !!groupEl("Formula") && !!sectionOf("Work"));
await view.moveToSection(sectionOf("Work").id, "groups", formulaId); // in its section for the screenshot

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
check("guide: folder submenu has Edit tags, suggestions, its inbox, the consistency check, the guide and Exclude", guideMenu?.titles().join() === "Edit tags,Suggest tags with Claude Code,Inbox of this folder,Check tag consistency,Write AI assistant guide,Exclude from the tag engine", guideMenu?.titles().join(" | "));
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

// ---- tag consistency: in a folder whose files nearly all carry a tag, the few without it (or with a look-alike)
await vault.createFolder("Cons");
for (const n of ["a[invoice edf]", "b[invoice]", "c[invoice]", "d[invoice orange]", "e[invoice]", "f[invoice]", "g[edf]", "h[invoices]"]) await vault.create(`Cons/${n}.pdf`, "");
await waitFor(() => plugin.index.ownTagsOf("Cons/h[invoices].pdf").length);
const csMenu = fakeMenu();
app.workspace.trigger("file-menu", csMenu, file("Cons"), "file-explorer");
csMenu.sub("TagEverything")?.click("Check tag consistency");
await waitFor(() => !!document.querySelector(".tag-everything-consistency-modal"));
document.querySelector(".tag-everything-consistency-modal")?.querySelector(".modal-close-button, .modal-header-button")?.click();
await sleep(200);
const cs = await plugin.checkConsistency(file("Cons"));
const csEl = document.querySelector(".tag-everything-consistency-modal");
const csRows = [...(csEl?.querySelectorAll(".tag-everything-fix-row") ?? [])];
check(
  "consistency: the folder menu opens it; the files without the folder's usual tag listed, nothing ticked",
  csEl?.querySelector(".modal-title")?.textContent === "TagEverything: tag consistency of Cons" &&
    csRows.map((r) => `${r.dataset.path}>${r.dataset.tag}`).join() === "Cons/g[edf].pdf>invoice,Cons/h[invoices].pdf>invoice" &&
    csRows.every((r) => !r.querySelector("input[type=checkbox]").checked),
  csRows.map((r) => `${r.dataset.path}>${r.dataset.tag}`).join(),
);
check("consistency: a look-alike is offered as replaced, with the counts", /invoices looks like a misspelling: 6 of the 8 files here carry invoice/.test(csRows[1]?.textContent ?? "") && /instead of invoices/.test(csRows[1]?.textContent ?? ""), csRows[1]?.textContent);
await snap("consistency"); // the dialog, to look at
[...csEl.querySelectorAll("button")].find((b) => b.textContent === "Tick all")?.click();
check("consistency: Tick all, then Fix counts the files", csEl.querySelector("button.mod-cta")?.textContent === "Fix 2 files", csEl.querySelector("button.mod-cta")?.textContent);
await cs.apply();
const csTags = (prefix) => plugin.index.ownTagsOf(file("Cons").children.find((c) => c.name.startsWith(prefix))?.path ?? "").slice().sort().join();
await waitFor(() => csTags("g[") === "edf,invoice" && csTags("h[") === "invoice");
check("consistency: applied: the tag added, the look-alike replaced", csTags("g[") === "edf,invoice" && csTags("h[") === "invoice", `${csTags("g[")} / ${csTags("h[")}`);
const cs2 = await plugin.checkConsistency(file("Cons"));
check("consistency: nothing left to say once fixed", /nothing stands out/.test(document.querySelector(".tag-everything-consistency-modal")?.textContent ?? ""));
cs2.close();
check("command: check tag consistency registered", !!app.commands.commands["tag-everything:check-consistency"]);
await vault.delete(file("Cons"), true);

// ---- put away: a tagged file moved to the folder whose files usually carry its tags, never over a file
await vault.createFolder("Bills/Power");
await vault.createFolder("Drop");
for (const n of ["a[bill power]", "b[bill power]", "dup[bill power]"]) await vault.create(`Bills/Power/${n}.pdf`, "kept");
for (const n of ["new[bill power 2026]", "dup[bill power]", "other[holiday]"]) await vault.create(`Drop/${n}.pdf`, "");
await waitFor(() => plugin.index.ownTagsOf("Drop/other[holiday].pdf").length);
const paMenu = fakeMenu();
app.workspace.trigger("file-menu", paMenu, file("Drop"), "file-explorer");
check("put away: the folder menu offers it for its files with a better folder", !!paMenu.sub("TagEverything")?.titles().includes("Put away (2 files)"), paMenu.sub("TagEverything")?.titles().join(" | "));
const inPlace = fakeMenu();
app.workspace.trigger("file-menu", inPlace, file("Bills/Power/a[bill power].pdf"), "file-explorer");
check("put away: not offered for a file already in its place", !inPlace.sub("TagEverything")?.titles().some((t) => t.startsWith("Put away")), inPlace.sub("TagEverything")?.titles().join(" | "));
paMenu.sub("TagEverything").click("Put away (2 files)");
await waitFor(() => !!document.querySelector(".tag-everything-putaway-modal"));
const paEl = document.querySelector(".tag-everything-putaway-modal");
const paRows = [...(paEl?.querySelectorAll(".tag-everything-fix-row") ?? [])];
check(
  "put away: each file with its folder and why, ticked",
  paRows.map((r) => r.dataset.path).sort().join() === "Drop/dup[bill power].pdf,Drop/new[bill power 2026].pdf" &&
    paRows.every((r) => r.querySelector("input[type=checkbox]").checked && r.querySelector("select")?.value === "Bills/Power") &&
    /3 files usually carry bill, power/.test(paRows[0]?.textContent ?? ""),
  paRows.map((r) => r.textContent).join(" || "),
);
check("put away: Move counts the ticked files", paEl?.querySelector("button.mod-cta")?.textContent === "Move 2 files", paEl?.querySelector("button.mod-cta")?.textContent);
await snap("putaway"); // the dialog, to look at
expectError(/moving failed\s+path=Drop\/dup\[bill power\]\.pdf/);
paEl.querySelector("button.mod-cta").click();
await waitFor(() => !!file("Bills/Power/new[bill power 2026].pdf"));
check(
  "put away: moved, links follow; a name already there refused, both files untouched",
  !!file("Bills/Power/new[bill power 2026].pdf") && !file("Drop/new[bill power 2026].pdf") && !!file("Drop/dup[bill power].pdf") && (await vault.read(file("Bills/Power/dup[bill power].pdf"))) === "kept" && !!file("Drop/other[holiday].pdf"),
  file("Drop").children.map((c) => c.name).join(),
);
check("put away: its tags still read at the new place", plugin.index.ownTagsOf("Bills/Power/new[bill power 2026].pdf").length === 3);
await vault.delete(file("Bills"), true);
await vault.delete(file("Drop"), true);

// ---- bring in: files arriving in a folder outside the vault are moved into a vault folder (then the inbox)
const nfs = window.require("fs");
const npath = window.require("path");
const outside = nfs.mkdtempSync(npath.join(window.require("os").tmpdir(), "te-bring-"));
const putOutside = (name) => {
  const p = npath.join(outside, name);
  nfs.writeFileSync(p, "x");
  const t = new Date(Date.now() - 10_000); // settled: written 10 s ago
  nfs.utimesSync(p, t, t);
};
putOutside("before.pdf"); // there before the folder is added: stays
await vault.createFolder("Arrivals");
await vault.create("Arrivals/dup.pdf", "kept");
const biList = settingTab?.getSettingDefinitions().find((d) => d.heading === "Bring in files from outside the vault");
check("bring in: a list in the settings, empty", !!biList && biList.items.length === 0);
biList?.addItem.action();
await waitFor(() => !!document.querySelector(".tag-everything-bring-in-modal"));
const biEl = document.querySelector(".tag-everything-bring-in-modal");
const biInputs = [...(biEl?.querySelectorAll("input[type=text]") ?? [])];
const biType = (input, text) => {
  input.value = text;
  input.dispatchEvent(new Event("input"));
};
biType(biInputs[0], npath.join(app.vault.adapter.getBasePath(), "Docs"));
await sleep(300);
check("bring in: a folder of the vault is refused", /in the vault/.test(biEl.querySelector(".tag-everything-rule-preview")?.textContent ?? "") && biEl.querySelector("button.mod-cta")?.disabled, biEl.querySelector(".tag-everything-rule-preview")?.textContent);
biType(biInputs[0], outside);
biType(biInputs[1], "Arrivals");
biType(biInputs[2], "pdf jpg");
await sleep(300);
check("bring in: the dialog says what will happen", /from now on are moved to Arrivals/.test(biEl.querySelector(".tag-everything-rule-preview")?.textContent ?? ""), biEl.querySelector(".tag-everything-rule-preview")?.textContent);
await snap("bring-in");
biEl.querySelector("button.mod-cta").click();
await waitFor(() => plugin.settings.bringIn.length === 1);
check("bring in: saved in the settings, from now on", plugin.settings.bringIn[0]?.target === "Arrivals" && Date.now() - plugin.settings.bringIn[0].since < 10_000, JSON.stringify(plugin.settings.bringIn));
await sleep(100);
for (const n of ["scan.pdf", "dup.pdf", "setup.exe", "half.pdf.crdownload"]) putOutside(n);
await waitFor(() => !!file("Arrivals/scan.pdf"), 8000); // the watcher looks 2 s after the last change
const outsideNow = nfs.readdirSync(outside).sort().join();
check(
  "bring in: a new file is moved in (the watcher), the old one, other types, downloads in progress and a taken name stay",
  !!file("Arrivals/scan.pdf") && outsideNow === "before.pdf,dup.pdf,half.pdf.crdownload,setup.exe" && (await vault.read(file("Arrivals/dup.pdf"))) === "kept",
  outsideNow,
);
check("bring in: a new file of the vault, so in the inbox", Date.now() - (file("Arrivals/scan.pdf")?.stat.ctime ?? 0) < 60_000);
plugin.settings.bringIn = [];
plugin.bringIn.restart(); // stops watching
nfs.rmSync(outside, { recursive: true, force: true });
await vault.delete(file("Arrivals"), true);
document.querySelectorAll(".notice").forEach((n) => n.remove());

// ---- inbox: files without tags that arrived lately, auto-tag rules (from a file), applied, dismissed, on arrival
await vault.createFolder("Inbox");
await vault.create("Inbox/Facture EDF.pdf", "");
await vault.create("Inbox/photo.jpg", "");
// The inbox is a tab of the TagEverything explorer only: not of the panel, no view, ribbon icon or sidebar tab of its own.
const ibBefore = app.workspace.getLeavesOfType("tag-everything-view")[0]?.view.getState();
const ibView = await plugin.openInbox();
await sleep(400);
const inbox = ibView?.inbox;
const ibEl = ibView?.contentEl;
const ibRow = (path) => ibEl?.querySelector(`.tag-everything-explorer-page .tag-everything-inbox-row[data-path="${path}"]`);
const ibTab = () => ibEl?.querySelector(".tag-everything-explorer-tabs > .tag-everything-explorer-tab-inbox");
check(
  "inbox: the command opens the explorer's Inbox tab, its count on it; no Inbox tab in the panel, no view of its own",
  ibView?.getViewType() === "tag-everything-explorer" && ibView.getState().tab === "inbox" && ibTab()?.classList.contains("is-active") && ibTab()?.querySelector(".tag-everything-chip-count")?.textContent === String(inbox.files().length) &&
    !document.querySelector(".tag-everything-tab-inbox") && !document.querySelector('.side-dock-ribbon-action[aria-label*="inbox"]') && !app.workspace.getLeavesOfType("tag-everything-inbox").length,
  JSON.stringify(ibView?.getState()) + " " + ibTab()?.textContent,
);
check("inbox: opens, lists the new untagged files, newest first", !!ibRow("Inbox/Facture EDF.pdf") && !!ibRow("Inbox/photo.jpg") && inbox.files().slice(0, 2).every((f) => f.path.startsWith("Inbox/")), inbox?.files().slice(0, 4).map((f) => f.path).join());
check("inbox: no rule yet: says what rules do", /Auto-tag rules tag files for you/.test(ibEl?.textContent ?? ""));
// A row's actions are behind its one ⋮ icon: open its menu, click an item by its title.
const ibAct = (path, title) => {
  document.querySelectorAll(".menu").forEach((m) => m.remove());
  ibRow(path)?.querySelector('[data-action="menu"]')?.click();
  const items = [...document.querySelectorAll(".menu .menu-item")];
  items.find((m) => m.textContent.startsWith(title))?.click();
  return items.map((m) => m.textContent);
};
const ibMenuTitles = ibAct("Inbox/Facture EDF.pdf", "(none)");
document.querySelectorAll(".menu").forEach((m) => m.remove());
check(
  "inbox: a row has one ⋮ icon, its menu holds the actions",
  ibRow("Inbox/Facture EDF.pdf")?.querySelectorAll(".clickable-icon").length === 1 && ibMenuTitles.join() === "Edit tags…,Suggest tags with Claude Code…,New rule from this file…,Dismiss: no tag needed",
  ibMenuTitles.join(" | "),
);
const realSuggestTags = plugin.suggestTags;
let ibSuggested = null;
plugin.suggestTags = (items) => ((ibSuggested = items.map((f) => f.path)), null); // the dialog itself is checked under suggest:
ibAct("Inbox/Facture EDF.pdf", "Suggest tags");
plugin.suggestTags = realSuggestTags;
check("inbox: a row's Suggest tags suggests tags for that file", ibSuggested?.join() === "Inbox/Facture EDF.pdf", JSON.stringify(ibSuggested));
ibAct("Inbox/Facture EDF.pdf", "New rule from this file");
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
const ibAddTitles = ibAct("Inbox/Facture EDF.pdf", "Add the rule tags");
await waitFor(() => !!file("Inbox/Facture EDF[energie].pdf"));
await sleep(300);
check("inbox: Add the rule tags (first in the menu, names them) adds those left on, the file leaves the inbox", ibAddTitles[0] === "Add the rule tags (energie)" && !!file("Inbox/Facture EDF[energie].pdf") && !ibRow("Inbox/Facture EDF[energie].pdf"), ibAddTitles.join(" | "));
ibAct("Inbox/photo.jpg", "Dismiss");
await sleep(400);
check("inbox: dismissed, saved", !ibRow("Inbox/photo.jpg") && (await plugin.loadData())?.inboxDismissed?.includes("Inbox/photo.jpg"));
// focused on one folder (setting inboxFolder)
const ibFolderDef = settingTab?.getSettingDefinitions().find((d) => d.heading === "Inbox")?.items?.find((i) => i.control?.key === "inboxFolder");
check("settings: the inbox folder row", ibFolderDef?.name === "Inbox folder" && ibFolderDef.control.type === "text", JSON.stringify(ibFolderDef));
await vault.create("Inbox/scan.png", "");
await settingTab.setControlValue("inboxFolder", " inbox/ "); // case ignored, slashes trimmed
await sleep(300);
check(
  "inbox: focused on a folder, lists only its files, says where",
  plugin.settings.inboxFolder === "inbox" && inbox.files().map((f) => f.path).join() === "Inbox/scan.png" && !!ibRow("Inbox/scan.png") && /1 file without tags in inbox from the last 30 days/.test(ibEl.textContent),
  inbox.files().map((f) => f.path).join() + " / " + ibEl.querySelector(".tag-everything-inbox-status")?.textContent,
);
ibView.showTab("tags");
await sleep(200);
check(
  "explorer: two tabs, Tags (shown) then Inbox with the inbox's count",
  [...(ibEl?.querySelectorAll(".tag-everything-explorer-tabs > .tag-everything-tab") ?? [])].map((t) => t.textContent).join() === "Tags,Inbox1" &&
    ibEl.querySelector(".tag-everything-explorer-tab-tags.is-active") && !ibEl.querySelector(".tag-everything-explorer-tree .is-inbox"),
  ibEl?.querySelector(".tag-everything-explorer-tabs")?.textContent,
);
ibTab()?.click();
await sleep(200);
check(
  "explorer: the Inbox tab holds the inbox (rule actions on its rows), the search box and tree hidden, saved",
  !!ibRow("Inbox/scan.png")?.querySelector('[data-action="menu"]') && ibTab()?.hasClass("is-active") && !ibEl.querySelector(".tag-everything-explorer-bar").isShown() && ibView.getState().tab === "inbox",
  ibEl?.textContent.slice(0, 200),
);
await settingTab.setControlValue("inboxFolder", "Nowhere");
await sleep(300);
check(
  "inbox: a focus folder not in the vault is said in the explorer's Inbox tab (no count)",
  /No folder Nowhere in the vault/.test(ibEl.textContent) && ibTab()?.textContent === "Inbox",
  ibEl.textContent.slice(0, 200),
);
await settingTab.setControlValue("inboxFolder", "");
ibView.showTab("tags");
// Targeted actions in the folder menu: its inbox, the rules on the files below it.
await vault.create("Inbox/Facture Orange.pdf", "");
await sleep(300);
const ibMenu = fakeMenu();
app.workspace.trigger("file-menu", ibMenu, file("Inbox"), "file-explorer");
const ibSub = ibMenu.sub("TagEverything");
// EDF still lacks facture (left out above), Orange lacks both; photo and scan are no PDF.
check("menu: Apply auto-tag rules on a folder, with the files it would tag", ibSub?.titles().includes("Apply auto-tag rules (2 files)"), ibSub?.titles().join(" | "));
ibSub?.click("Inbox of this folder");
await sleep(500);
check("menu: Inbox of this folder focuses the inbox there and shows it", plugin.settings.inboxFolder === "Inbox" && ibView.getState().tab === "inbox" && /without tags in Inbox/.test(ibEl.textContent), plugin.settings.inboxFolder + " / " + ibView.getState().tab);
ibEl.querySelector(".tag-everything-inbox-actions button:last-child")?.click(); // "Whole vault"
await sleep(400);
check("inbox: Whole vault stops the focus", plugin.settings.inboxFolder === "", plugin.settings.inboxFolder);
// Date criteria, from the Dates button's menu: a created one replaces the last days, a modified one shows on the rows.
const menuItem = (title, nth = 0) => [...document.querySelectorAll(".menu .menu-item:not(.is-label)")].filter((m) => m.textContent === title)[nth];
const ibCount = inbox.files().length;
const ibDates = () => ibEl.querySelector(".tag-everything-inbox-actions .tag-everything-dates-button");
ibDates()?.click();
await sleep(200);
menuItem("More than a year ago")?.click(); // the first one: Created
await sleep(300);
check(
  "inbox: Dates → created more than a year ago: nothing, said at the top, the tab's count follows, the button marked",
  inbox.dates.created?.within === false && inbox.dates.created.days === 365 && inbox.files().length === 0 && /Inbox zero: every file created more than a year ago has tags/.test(ibEl.textContent) && !ibTab()?.querySelector(".tag-everything-chip-count") && ibDates()?.classList.contains("is-active"),
  JSON.stringify(inbox.dates) + " " + ibEl.querySelector(".tag-everything-inbox-status")?.textContent,
);
ibDates()?.click();
await sleep(200);
menuItem("Any date")?.click();
await sleep(200);
const ibAll = inbox.files();
ibDates()?.click();
await sleep(200);
menuItem("In the last day", 1)?.click(); // the second one: Modified
await sleep(300);
// The fixture's files keep their old modification dates: only those modified since yesterday stay.
const ibRecent = ibAll.filter((f) => f.stat.mtime >= Date.now() - 24 * 3600_000).length;
check(
  "inbox: Dates → Any date brings the files back; modified in the last day keeps those, rows say when they were modified",
  ibAll.length === ibCount && !inbox.dates.created && inbox.dates.modified?.days === 1 && ibRecent > 0 && inbox.files().length === ibRecent &&
    / from the last 30 days, modified in the last day\./.test(ibEl.textContent) && /Arrived .*, modified /.test(ibEl.querySelector(".tag-everything-inbox-row")?.textContent ?? ""),
  `${ibAll.length}/${ibCount} ${inbox.files().length}/${ibRecent} ` + ibEl.querySelector(".tag-everything-inbox-row")?.textContent,
);
inbox.dates = {};
ibView.showTab("tags"); // the explorer as the later sections expect it
// The Tools tab: the vault-wide actions, the rules applied to every file they match.
const toolsView = await plugin.openTools();
await sleep(300);
const toolsEl = toolsView?.contentEl;
const toolBtn = (action) => toolsEl?.querySelector(`.tag-everything-tools button[data-action="${action}"]`);
check(
  "tools: a tab of the panel with re-read, apply rules, check, review, consistency, rename",
  toolsView?.getState().page === "tools" && ["reindex", "apply-rules", "check-names", "review", "consistency", "rename"].every((a) => !!toolBtn(a)) && !toolsEl.querySelector(".tag-everything-tab-tools")?.textContent,
  [...(toolsEl?.querySelectorAll(".tag-everything-tools button") ?? [])].map((b) => b.dataset.action).join(),
);
check("tools: Apply names the files the rules would tag", toolBtn("apply-rules")?.textContent === "Apply to 2 files" && !toolBtn("apply-rules").disabled, toolBtn("apply-rules")?.textContent);
toolBtn("apply-rules")?.click();
await waitFor(() => !!file("Inbox/Facture Orange[energie facture].pdf") && !!file("Inbox/Facture EDF[energie facture].pdf"), 5000);
await sleep(400);
check("tools: Apply adds the rule tags (only adds), then nothing is left to apply", !!file("Inbox/Facture Orange[energie facture].pdf") && !!file("Inbox/Facture EDF[energie facture].pdf") && toolBtn("apply-rules")?.disabled, toolBtn("apply-rules")?.textContent);
toolBtn("reindex")?.click();
await waitFor(() => [...document.querySelectorAll(".notice")].some((n) => /tagged item/.test(n.textContent)), 5000);
check("tools: Re-read all tags says how many items", [...document.querySelectorAll(".notice")].some((n) => /tagged item/.test(n.textContent)));
toolBtn("check-names")?.click();
await waitFor(() => !!document.querySelector(".tag-everything-fix-modal"), 5000);
check("tools: Check opens the tag name check", !!document.querySelector(".tag-everything-fix-modal"));
document.querySelector(".tag-everything-fix-modal")?.querySelector(".modal-close-button, .modal-header-button")?.click();
await sleep(200);
check("command: open the tools registered", !!app.commands.commands["tag-everything:open-tools"]);
// A workspace saved by 0.27 had the inbox in its own sidebar tab: closed at load.
const oldInboxes = () => {
  const found = [];
  app.workspace.iterateAllLeaves((l) => l.getViewState().type === "tag-everything-inbox" && found.push(l));
  return found;
};
await app.workspace.getRightLeaf(false)?.setViewState({ type: "tag-everything-inbox" });
const oldBefore = oldInboxes().length;
plugin.closeOldInbox();
check("inbox: the old inbox sidebar tab of a saved workspace is closed", oldBefore === 1 && !oldInboxes().length, `before=${oldBefore} after=${oldInboxes().length}`);
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
if (ibBefore) await toolsView?.setState(ibBefore, {}); // the panel as it was before the Tools tab
await vault.delete(file("Inbox"), true);
document.querySelectorAll(".notice").forEach((n) => n.remove());

// ---- exclusions: a folder by right-click, a file by a rule; ignored everywhere, tags kept on disk, eye-off icon
{
  const under = (prefix) => plugin.index.paths().filter((p) => p === prefix || p.startsWith(prefix + "/"));
  const before = under("Projects");
  const alphaTags = plugin.index.ownTagsOf("Projects/Alpha").join();
  const exMenu = fakeMenu();
  app.workspace.trigger("file-menu", exMenu, file("Projects"), "file-explorer");
  exMenu.sub("TagEverything").click("Exclude from the tag engine");
  await waitFor(() => !under("Projects").length);
  check("exclude: a folder by right-click leaves the index, everything under it too", before.length > 1 && !under("Projects").length && plugin.settings.excluded.join() === "Projects", `${before.join()} -> ${under("Projects").join()}`);
  check("exclude: saved in data.json", (await plugin.loadData())?.excluded?.join() === "Projects");
  check("exclude: its tags stay on disk (folder sidecar untouched)", /"tags"/.test(await adapter.read("Projects/Alpha/.ts/tsm.json").catch(() => "")) && alphaTags.length > 0);
  // the eye-off icon on the folder's row in the file explorer, even with the badges off
  plugin.settings.showBadges = false;
  plugin.badges.refresh();
  const projRow = app.workspace.getLeavesOfType("file-explorer")[0]?.view.fileItems?.["Projects"]?.selfEl;
  const eye = projRow?.querySelector(":scope > .tag-everything-excluded");
  check("exclude: eye-off icon on the excluded row, faded, even with the badges off", !!eye?.querySelector("svg") && projRow.classList.contains("tag-everything-is-excluded") && /Excluded from TagEverything/.test(eye.getAttribute("aria-label")), projRow?.outerHTML.slice(0, 300));
  plugin.settings.showBadges = true;
  // an excluded item: no tagging, only the way back in; a file inside: back through its folder
  const inMenu = fakeMenu();
  app.workspace.trigger("file-menu", inMenu, file("Projects/Alpha"), "file-explorer");
  check("exclude: an item inside offers only to include its folder again", inMenu.sub("TagEverything")?.titles().join() === 'Include "Projects" in the tag engine again', inMenu.sub("TagEverything")?.titles().join(" | "));
  expectError(/it is excluded from the tag engine/);
  await plugin.applyTags([file("Projects/Alpha")], { added: ["sneaky"], removed: [] });
  await sleep(200);
  check("exclude: writes refused while excluded", !(await adapter.read("Projects/Alpha/.ts/tsm.json")).includes("sneaky"));
  document.querySelectorAll(".notice").forEach((n) => n.remove());
  const outMenu = fakeMenu();
  app.workspace.trigger("file-menu", outMenu, file("Projects"), "file-explorer");
  outMenu.sub("TagEverything").click("Include in the tag engine again");
  await waitFor(() => under("Projects").length === before.length);
  check("exclude: included again, its tags are read back", under("Projects").join() === before.join() && plugin.index.ownTagsOf("Projects/Alpha").join() === alphaTags && !plugin.settings.excluded.length, under("Projects").join());
  plugin.badges.refresh();
  check("exclude: the icon goes with it", !projRow?.querySelector(":scope > .tag-everything-excluded") && !projRow?.classList.contains("tag-everything-is-excluded"));
  // an exclusion rule, through its dialog (no tags field), listed in the settings
  const rm = settingTab.getSettingDefinitions().find((d) => d.heading === "Exclusion rules");
  rm?.addItem?.action();
  await sleep(300);
  const ruleEl = document.querySelector(".tag-everything-rule-modal");
  const ruleInputs = ruleEl?.querySelectorAll("input");
  ruleInputs[2].value = "pdf";
  ruleInputs[2].dispatchEvent(new Event("input"));
  const pdfs = vault.getFiles().filter((f) => f.extension === "pdf").length;
  check(
    "exclude rule: dialog titled, tags field hidden, preview counts the files",
    ruleEl?.querySelector(".modal-title")?.textContent === "TagEverything: new exclusion rule" && getComputedStyle(ruleInputs[3].closest(".setting-item")).display === "none" && ruleEl.querySelector(".tag-everything-rule-preview")?.textContent === `pdf. Excludes ${pdfs} file${pdfs === 1 ? "" : "s"} of the vault.`,
    ruleEl?.querySelector(".tag-everything-rule-preview")?.textContent,
  );
  ruleEl.querySelector(".mod-cta").click();
  await waitFor(() => !plugin.index.paths().some((p) => p.endsWith(".pdf")));
  check("exclude rule: saved, the matching files leave the index", plugin.settings.excludeRules.length === 1 && pdfs > 0 && !plugin.index.paths().some((p) => p.endsWith(".pdf")), JSON.stringify(plugin.settings.excludeRules));
  check("exclude rule: listed in the settings", settingTab.getSettingDefinitions().find((d) => d.heading === "Exclusion rules")?.items?.[0]?.name === "pdf");
  const pdfMenu = fakeMenu();
  app.workspace.trigger("file-menu", pdfMenu, vault.getFiles().find((f) => f.extension === "pdf"), "file-explorer");
  check("exclude rule: a covered file's menu points to the rule", pdfMenu.sub("TagEverything")?.titles().join() === 'Excluded by the rule "pdf": edit it', pdfMenu.sub("TagEverything")?.titles().join(" | "));
  settingTab.getSettingDefinitions().find((d) => d.heading === "Exclusion rules").onDelete(0);
  await waitFor(() => plugin.index.paths().some((p) => p.endsWith(".pdf")));
  check("exclude rule: deleted, the files come back", !plugin.settings.excludeRules.length && plugin.index.paths().some((p) => p.endsWith(".pdf")));
  document.querySelectorAll(".notice").forEach((n) => n.remove());
}

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
// The panel's tag lists show the extension tags only when its toggle is on (off by default).
await view.setState({ selected: [], excluded: [], dates: {}, activeGroup: null, tab: null, page: null }, { history: false });
await sleep(300);
const extToggle = () => panel().querySelector(".tag-everything-tags-head .tag-everything-ext-toggle");
check("ext: the panel's All hides extension tags by default", plugin.settings.panelExtensionTags === false && !cloudChip("md") && !!cloudChip(reportTags[0]) && !extToggle()?.classList.contains("is-active"));
extToggle()?.click();
await sleep(300);
check("ext: the toggle in All's Tags heading shows them, saved", !!cloudChip("md") && extToggle()?.classList.contains("is-active") && (await plugin.loadData())?.panelExtensionTags === true);
extToggle()?.click();
await sleep(300);
check("ext: clicked again, hidden", !cloudChip("md") && plugin.settings.panelExtensionTags === false);
// Date criteria of the search (calendar icon of the panel's bar): alone, with tags, kept by a new tag search, cleared.
const DAY = 24 * 3600_000;
const hasDatesIn = (state) => Object.keys(state.dates ?? {}).length > 0;
const createdToday = (paths) => paths.filter((p) => { const f = file(p); return f?.stat && f.stat.ctime >= Date.now() - DAY; }).length;
const selCount = () => selTab()?.querySelector(".tag-everything-chip-count")?.textContent;
const dateChip = () => panel().querySelector(".tag-everything-view-selected .tag-everything-date-chip");
const pickDate = async (title) => {
  panel().querySelector(".tag-everything-view-bar .tag-everything-dates-button")?.click();
  await sleep(200);
  menuItem(title)?.click(); // the first one: Created
  await sleep(300);
};
await pickDate("In the last day");
const todayN = createdToday(plugin.index.paths());
check(
  "dates: a criterion alone is a search: Selection with what it finds, its chip, the icon marked",
  view.getState().dates?.created?.days === 1 && view.getState().page === "selection" && todayN > 0 && selCount() === String(todayN) && dateChip()?.textContent === "created in the last day" && panel().querySelector(".tag-everything-view-bar .tag-everything-dates-button")?.classList.contains("is-active"),
  `${JSON.stringify(view.getState().dates)} ${selCount()} / ${todayN} ${dateChip()?.textContent}`,
);
await plugin.showTag("pdf");
await sleep(300);
const pdfToday = createdToday(plugin.index.paths().filter((p) => plugin.index.hasTag(p, "pdf")));
check("dates: combined with a tag, kept by a new tag search", view.getState().selected.join() === "pdf" && view.getState().dates?.created?.days === 1 && selCount() === String(pdfToday) && pdfToday > 0, `${selCount()} / ${pdfToday}`);
await pickDate("More than a year ago");
check("dates: created more than a year ago: nothing found", view.getState().dates?.created?.within === false && selCount() === "0" && dateChip()?.textContent === "created more than a year ago", `${selCount()} ${dateChip()?.textContent}`);
dateChip()?.click();
await sleep(300);
check("dates: the chip clicked takes the criterion out, the tags stay", !hasDatesIn(view.getState()) && view.getState().selected.join() === "pdf" && !dateChip());
await pickDate("In the last 7 days");
panel().querySelector(".tag-everything-view-clear")?.click();
await sleep(300);
check("dates: Clear drops the dates too", !hasDatesIn(view.getState()) && !view.getState().selected.length && !selTab());
// Dates in groups: Formula… keeps the search's dates, the dialog's Date button inserts a term, a group's date terms
// are chips with a × and its search uses them (replacing the panel's dates).
await pickDate("In the last day");
panel().querySelector(".tag-everything-view-formula")?.click();
await sleep(300);
const dInput = document.querySelector(".tag-everything-group-modal .tag-everything-formula-input");
check("dates: Formula… from a search with a date writes it in the formula", dInput?.value === "created:1d", dInput?.value);
document.querySelector(".tag-everything-group-modal .tag-everything-formula-date")?.click();
await sleep(200);
menuItem("More than a year ago", 1)?.click(); // the second one: Modified
await sleep(200);
check("dates: the group dialog's Date button inserts a term", /^created:1d modified:>1y\s*$/.test(dInput?.value ?? ""), dInput?.value);
[...document.querySelectorAll(".tag-everything-group-modal button")].find((b) => b.textContent === "Cancel")?.click();
await sleep(200);
const datedId = await view.createGroup("Old PDFs");
await view.setGroupFormula(datedId, "pdf AND created:>1y");
await sleep(300);
view.selectGroup(datedId);
await sleep(300);
const datedCard = () => panel().querySelector(`.tag-everything-view-selected .tag-everything-group[data-group="${datedId}"]`);
check(
  "dates: a group with a date term: its chip in the card, its search finds only what meets it, the panel's date dropped",
  datedCard()?.querySelector(".tag-everything-date-chip")?.textContent === "created more than a year ago" && selCount() === "0" && !hasDatesIn(view.getState()),
  `${datedCard()?.textContent} / ${selCount()} / ${JSON.stringify(view.getState().dates)}`,
);
datedCard()?.querySelector(".tag-everything-date-chip .tag-everything-chip-remove")?.click();
await sleep(300);
const datedGroup = () => plugin.settings.groups.find((g) => g.id === datedId);
check("dates: a group's date chip × takes it out of the formula", datedGroup()?.formula === "pdf" && selCount() === String(plugin.index.paths().filter((p) => plugin.index.hasTag(p, "pdf")).length), `${datedGroup()?.formula} / ${selCount()}`);
view.selectGroup(datedId); // stop its search
plugin.settings.groups = plugin.settings.groups.filter((g) => g.id !== datedId);
await plugin.saveSettings();
await sleep(200);
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
// the tag count range, shared with the panel's All tab: under the search box, it keeps the root to the tags used that
// many times (stored tags); an open tag stays
{
  const own = plugin.index.counts(undefined, true);
  const top = Math.max(...own.values());
  const rare = [...own].find(([, n]) => n < top)?.[0];
  const exBox = (b) => exEl.querySelector(`.tag-everything-explorer-range .tag-everything-range-input[data-bound="${b}"]`);
  const exAll = () => exEl.querySelector(".tag-everything-explorer-range .tag-everything-range-all");
  check("explorer range: the panel's numbers, See all pressed (off)", exBox("min")?.value === String(plugin.settings.tagRangeMin) && exAll()?.classList.contains("is-active"), exBox("min")?.value);
  explorer.toggle([rare]);
  exBox("min").focus();
  exBox("min").value = String(top);
  exBox("min").dispatchEvent(new Event("input"));
  await sleep(200);
  const want = [...own].filter(([t, n]) => n >= top || t === rare).map(([t]) => t).sort(byName).join();
  check(
    "explorer range: a number typed keeps the root to the tags used that many times, an open one stays, the box keeps the focus",
    exTop().join() === want && want.split(",").length < ownTags.length && document.activeElement === exBox("min") && / of \d+ tags/.test(exEl.querySelector(".tag-everything-explorer-status").textContent),
    `${exTop().join()} vs ${want}`,
  );
  exBox("min").dispatchEvent(new Event("change"));
  exBox("min").blur();
  await sleep(400);
  const panelMin = document.querySelector('.tag-everything-view .tag-everything-tags-head .tag-everything-range-input[data-bound="min"]')?.value;
  check("explorer range: saved, and the panel shows it", (await plugin.loadData())?.tagRangeOn === true && panelMin === String(top) && !exAll().classList.contains("is-active"), panelMin);
  explorer.toggle([rare]);
  // a formula: the root holds the tags of what it finds, whatever their count there
  const box = exEl.querySelector(".tag-everything-explorer-input");
  box.value = "kpi";
  box.dispatchEvent(new Event("input"));
  await sleep(200);
  const kpiRoot = [...plugin.index.counts(plugin.index.paths().filter((p) => plugin.index.hasTag(p, "kpi")), true).keys()].sort(byName).join();
  check("explorer range: not while a formula filters the tree", plugin.settings.tagRangeOn && exTop().filter((k) => !k.includes("/")).join() === kpiRoot, `${exTop().join()} vs ${kpiRoot}`);
  box.value = "";
  box.dispatchEvent(new Event("input"));
  await sleep(200);
  exAll().click();
  await sleep(400);
  check("explorer range: See all, every stored tag again", exTop().join() === ownTags.join() && !plugin.settings.tagRangeOn, exTop().join());
}
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
// Date terms: typed (created:1d) or picked with the calendar icon; a chip with a × each.
const exDateChip = () => exEl.querySelector(".tag-everything-explorer-search .tag-everything-date-chip");
const exDatesBtn = () => exEl.querySelector(".tag-everything-explorer-bar .tag-everything-dates-button");
const createdToday2 = (p) => { const f = file(p); return !!f?.stat && f.stat.ctime >= Date.now() - 24 * 3600_000; };
await exType("shared created:1d");
await exKey2("Enter");
check(
  "explorer: a date term typed is a chip; the tree holds only the items meeting it",
  exDateChip()?.textContent === "created in the last day" && exStatus().endsWith("shared AND created:1d") && exTop().join() === rootFor((p) => has("shared")(p) && createdToday2(p)).join() && exDatesBtn()?.classList.contains("is-active"),
  `${exDateChip()?.textContent} / ${exStatus()} / ${exTop().join(" | ")}`,
);
exDatesBtn()?.click();
await sleep(200);
menuItem("More than a year ago")?.click(); // the first one: Created
await sleep(200);
check("explorer: the calendar's menu replaces the date: nothing that old", exDateChip()?.textContent === "created more than a year ago" && exStatus().endsWith("shared AND created:>1y") && exTop().length === 0, `${exDateChip()?.textContent} / ${exStatus()}`);
exDateChip()?.querySelector(".tag-everything-chip-remove")?.click();
await sleep(150);
check("explorer: a date chip's × takes it out", exChips() === "shared" && !exDateChip() && !exDatesBtn()?.classList.contains("is-active"), exChips());
await exKey2("Escape");
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
