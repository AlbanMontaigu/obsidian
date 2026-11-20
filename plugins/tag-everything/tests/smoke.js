// In-app smoke test, run by `npm run smoke -- tag-everything` inside a throwaway Obsidian opened on
// tests/fixtures/vault. Available: app, plugin (this plugin's instance), check(name, cond, detail), sleep(ms),
// expectError(regex) for console errors the test provokes on purpose, fakeMenu() to test menu items.
// Contract: docs/testing.md at the repo root.

const vault = app.vault;
const adapter = vault.adapter;
const file = (p) => vault.getAbstractFileByPath(p);
const readJson = async (p) => JSON.parse(await adapter.read(p));

await plugin.index.rebuild();

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
document.querySelector(".tag-everything-modal .modal-close-button")?.click();
await sleep(200);
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

// ---- UI: panel opens and lists the tags; explorer badges appear
const view = await plugin.openView();
await sleep(500);
check("panel opens", !!view && document.querySelectorAll(".tag-everything-view .tag-everything-chip").length >= 5);
view.selectOnly("client");
await sleep(300);
check("panel filters by tag", document.querySelectorAll(".tag-everything-result").length === 1);
plugin.badges.refresh();
await sleep(300);
check("explorer badges rendered", document.querySelectorAll(".nav-files-container .tag-everything-badge").length > 0);

// ---- edit modal opens with the item's chips (left open: it is what the screenshot shows)
plugin.editTags([file("Projects/Alpha/budget[B27 INC].md")]);
await sleep(400);
check("edit modal shows chips", document.querySelectorAll(".tag-everything-modal .tag-everything-chip").length === 2);
