# Obsidian API notes

What you need beyond `node_modules/obsidian/obsidian.d.ts` (the authoritative, documented API: grep it for every
signature). Verified against Obsidian 1.15 with the `obsidian` types 1.14.4.

## Plugin skeleton

```ts
import { Plugin } from "obsidian";
export default class MyPlugin extends Plugin {
  async onload() {
    await this.loadSettings();                       // this.loadData() / this.saveData() -> .obsidian/plugins/<id>/data.json
    this.addSettingTab(new MySettingTab(this.app, this));
    this.addCommand({ id: "do-x", name: "Do X", callback: () => {} });   // command id becomes "<plugin-id>:do-x"
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {}));
    this.app.workspace.onLayoutReady(() => { /* vault events + initial scans here */ });
  }
  onunload() { /* only what register*() does not already clean up */ }
}
```

## Building blocks and where to find an example

| Need | API | Example in this repo |
|---|---|---|
| Right-click on a file / folder / multi-selection | `workspace.on("file-menu" \| "files-menu")`, `menu.addItem(i => i.setTitle().setIcon().setSection("action").onClick())` | `tag-everything/src/main.ts` |
| Command (palette + hotkey) | `addCommand({ id, name, callback \| checkCallback \| editorCallback })` | `tag-everything/src/main.ts` |
| Settings tab | **Declarative (1.13+)**: `PluginSettingTab.getSettingDefinitions()` returns rows `{ name, desc, control: { type: "toggle" \| "dropdown" \| "text" \| "slider"..., key } }` and groups `{ type: "group", heading, items }`; the rows appear in Obsidian's settings search. A control reads `plugin.settings[key]` and saves with `saveData`; override `getControlValue` / `setControlValue` to validate or react, then call `refreshDomState()` for `disabled` / `visible` predicates (`update()` when rows are added or removed). No `display()` (deprecated). `this.icon` sets the sidebar icon. `new Setting(el)` stays the way to build rows **inside a modal**. | `tag-everything/src/settings.ts`, template |
| Dialog | `Modal` (`this.setTitle()`, `this.contentEl`, `onOpen` / `onClose`) | `tag-everything/src/modal.ts` |
| Autocomplete on an `<input>` | `AbstractInputSuggest<T>` (`getSuggestions`, `renderSuggestion`, `selectSuggestion`) | `tag-everything/src/modal.ts` |
| Pick-from-list dialog | `SuggestModal<T>` / `FuzzySuggestModal<T>` | |
| Side panel | `ItemView` + `registerView(type, leaf => new View(leaf, this))`, open with `workspace.getRightLeaf(false).setViewState({ type, active: true })` then `revealLeaf` | `tag-everything/src/view.ts`, `openView()` in `main.ts` |
| Ribbon button | `addRibbonIcon(icon, title, cb)` (Lucide icon names) | `main.ts` |
| Toast | `new Notice(text, ms)`; `ms = 0` stays until `.hide()` | `main.ts` |
| Icons | `setIcon(el, "lucide-name")` | `view.ts` |
| Rename / move with link updates | `app.fileManager.renameFile(file, newPath)` | `main.ts` |
| Read / write a note | `vault.read(file)`, `vault.process(file, fn)` (atomic), `vault.modify` | |
| Frontmatter | `app.fileManager.processFrontMatter(file, fm => {})`, `app.metadataCache.getFileCache(file)`, `metadataCache.on("changed")` | `tag-everything/src/main.ts`, `index.ts` |
| Files Obsidian ignores (dot-folders like `.ts`) | `vault.adapter.exists/read/write/list/mkdir/rename/remove` with vault-relative paths | `tag-everything/src/store.ts` |
| Vault events | `vault.on("create" \| "delete" \| "rename" \| "modify")` | `main.ts`, `index.ts` |
| Debounce | `debounce(fn, ms, true)` | `index.ts` |
| Page preview on hover (Ctrl/Cmd + hover) in your view | `plugin.registerHoverLinkSource(viewType, { display, defaultMod: true })`; on `mouseover` `workspace.trigger("hover-link", { event, source: viewType, hoverParent: view, targetEl, linktext: file.path })`; the view `implements HoverParent` (`hoverPopover = null`) | `tag-everything/src/view.ts` |
| View state across restarts | `getState()` / `setState(state, result)` on the `ItemView` (validate what comes back), `workspace.requestSaveLayout()` after a change | `tag-everything/src/view.ts` |
| Own event bus | `class X extends Events`, `trigger("changed")`, `this.registerEvent(x.on("changed", cb))` | `index.ts` |
| Absolute path on disk (desktop) | `(vault.adapter as FileSystemAdapter).getBasePath()` | |

## Internal (undocumented) APIs we rely on

They work in 1.15 but can change: always guard (`?.`, `try/catch`) and degrade gracefully.

| What | How | Used by |
|---|---|---|
| File explorer items | `workspace.getLeavesOfType("file-explorer")[0].view.fileItems[path].selfEl` | `tag-everything` badges |
| Reveal a folder in the explorer | `app.internalPlugins.getPluginById("file-explorer").instance.revealInFolder(folder)` | `tag-everything` panel |
| Open a non-note in the system app | `app.openWithDefaultApp(path)`; check `app.viewRegistry.isExtensionRegistered(ext)` first | `tag-everything` panel |
| A core setting | `(app.vault as any).getConfig("showUnsupportedFiles")` | `tag-everything` settings |
| Drag a file from your own view into a note (link) | `app.dragManager.dragFile(evt, file)` / `dragFolder(evt, folder)`, then `app.dragManager.onDragStart(evt, data)` in `dragstart` | `tag-everything` panel results |
| Page-preview sources (tests) | `app.workspace.hoverLinkSources[id]` after `registerHoverLinkSource` | `tag-everything` smoke |
| A plugin's settings tab (tests) | `app.setting.pluginTabs.find(t => t.id === id)`: `.settingItems` (the declarative rows), `.setControlValue(key, v)`; the real UI with `app.setting.open()` + `app.setting.openTabById(id)`, rows in the tab's `containerEl` (`.setting-item`, `.is-disabled`), then `app.setting.close()` | `tag-everything` smoke, template |
| Enable a plugin (tests only) | `app.plugins.setEnable(true)`, `app.plugins.enablePluginAndSave(id)`, `app.plugins.plugins[id]` | `tools/smoke.mjs` |

Pattern for internals the types do not know:

```ts
interface InternalApp { openWithDefaultApp?: (path: string) => void }
(this.app as unknown as InternalApp).openWithDefaultApp?.(file.path);
```

## Official guidelines (re-read 2026-11-20)

Sources: [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines), the
[self-critique checklist](https://docs.obsidian.md/oo/plugin), [Settings](https://docs.obsidian.md/Plugins/User+interface/Settings),
[Optimize plugin load time](https://docs.obsidian.md/Plugins/Guides/Optimize+plugin+load+time),
[Defer views](https://docs.obsidian.md/Plugins/Guides/Defer+views), [Manifest](https://docs.obsidian.md/Reference/Manifest)
and the official linter [eslint-plugin-obsidianmd](https://github.com/obsidianmd/eslint-plugin). What applies here:

- `this.app`, never the global `app`; no `console.log` (errors and warnings only); `const` / `let`; `async` /
  `await` rather than `.then()` chains; no `as any`; no deprecated API.
- **Files**: `instanceof TFile` / `TFolder`, never a cast; `getFileByPath` / `getAbstractFileByPath`, never a loop
  over `getFiles()` to find one path; `Vault.process` for background edits, the `Editor` for the open note;
  `FileManager.processFrontMatter` for frontmatter; `FileManager.trashFile`, not `Vault.delete`; `Vault.configDir`,
  never `".obsidian"`; `normalizePath()` on paths the **user** types (settings); the Vault API before `vault.adapter`
  (the adapter only for what the Vault cannot see, e.g. dot-folders).
- **DOM**: `createEl` / `createDiv` / `createSpan`, never `innerHTML`; no `el.style.x = ...`: CSS classes in
  `styles.css`, and for a computed value (a colour, a size) a CSS variable set with `el.setCssProps({ "--x": v })`.
- **Pop-out windows**: `window.setTimeout`, `activeDocument` (not `document`) for what you add to the page,
  `node.instanceOf(HTMLElement)` / `evt.instanceOf(MouseEvent)` rather than `instanceof` (each window has its own
  classes, so `instanceof` is false across windows).
- **Lifecycle**: everything through `register*` / `addCommand` / `addChild`; don't detach your leaves in `onunload`;
  `registerView` returns a new view and the plugin keeps no reference to it; views may be **deferred**: check
  `leaf.view instanceof MyView` after `await workspace.revealLeaf(leaf)`. Startup work in `onLayoutReady`; light
  view constructors.
- **UI text**: sentence case; no default hotkeys; command ids / names without the plugin id or name, nor "command";
  settings: no top heading, first section without a heading, headings without "settings", one-sentence descriptions.
- **Manifest**: `minAppVersion` covers every API used (the linter checks it against the `@since` tags).

**Run the official linter** (not a dependency of this repo; one-off, in a scratch folder):
`npm i eslint@9 typescript-eslint eslint-plugin-obsidianmd typescript@5` there; a flat config with
`...obsidianmd.configs.recommended` and `parserOptions: { projectService: true, tsconfigRootDir: "<repo root>" }`;
then run `<scratch>/node_modules/.bin/eslint -c <scratch>/eslint.config.mjs src` **from `plugins/<id>/`**. The rules
that need the manifest (`no-unsupported-api`, command names, settings tab) read `manifest.json` from the current
folder and silently do nothing without it. Add `"obsidianmd/ui/sentence-case": "warn"` to check UI text too (false
positives on placeholders and operator words).

## Traps (already hit, don't repeat)

- **The settings dialog opens in a pop-out window (1.15)** (`.modal.mod-settings` in an `is-popout-modal` window):
  the smoke screenshot of the main window does not show it, and `document.querySelector` from the main window does
  not find its rows. Query the tab's own `containerEl`. Code that runs in a settings tab must be pop-out safe.

- **Don't name a method `open`, `close`, `load`, `unload`, `onload`... on a `View`, `Modal` or `Component`
  subclass** unless you mean to override it. `ItemView` has an internal `open(containerEl)` that Obsidian calls when
  showing the view; a `private open(item)` in `tag-everything` shadowed it and crashed the panel. TypeScript does
  not flag it because the base method is not in the typings. Use specific names (`openItem`, `showResults`).
- **Enter in a modal with an `AbstractInputSuggest`**: Obsidian's keymap handles keys in the capture phase; the
  suggest popover takes Enter / arrows while it is open. In your own `keydown` handler, return early on
  `evt.defaultPrevented || evt.isComposing`, and return no suggestions for an empty query, otherwise Enter on an
  empty box picks the first suggestion instead of submitting. Don't dispatch synthetic key events.
- **Closing a modal from a test (1.15)**: the ✕ button is `.modal-header-button` inside `.modal`, no longer
  `.modal-close-button`; use `.querySelector(".modal-close-button, .modal-header-button")`. A pending modal (e.g.
  the vault-trust dialog `.modal.mod-trust-folder`) blocks every other modal from opening, with no error. Never
  match a core dialog by its text: the UI follows the OS language.
- **Settings have their own window (1.15)**: `app.setting.open()` renders the settings in a separate window, so a
  `Notice` or `Modal` opened from a settings row (e.g. an action row `{ name, desc, action }`, rendered as
  `.setting-item.mod-action`, `.click()` triggers it) lands in **that** window's document. In a test, look in
  `settingTab.containerEl.ownerDocument`, not `document`. Obsidian's `createEl` / `Notice` / `Modal` already
  follow the active window; code that uses the global `document` directly would not.
- **Frontmatter**: write with `fileManager.processFrontMatter` (keeps other properties; it throws on invalid YAML,
  which is what you want). Right after a write, `metadataCache.getFileCache` can still hold the old values: re-read
  the file (`getFrontMatterInfo` + `parseYaml`) when you need the current state, and follow live edits with
  `metadataCache.on("changed", (file, data, cache) => ...)`. Tags may be in `tags` or the older `tag`, as a list or
  a comma/space string, with or without `#`.
- **Dot-folders are invisible to the Vault API** (`getAbstractFileByPath(".ts/x")` is null, no events). Use
  `vault.adapter` for them, and remember nothing tells you when another app changes them.
- **Non-note files are only loaded if *Detect all file extensions* is on** (`showUnsupportedFiles`). Without it,
  PDFs and Office files are missing from `getFiles()`, menus and events. The owner's main vault has it **off**.
- **`vault.on("create")` fires for every file at startup**: register vault events inside `onLayoutReady`.
- **An async scan that swaps in a fresh map loses the events that arrived meanwhile** (renames, your own writes),
  and a folder renamed mid-scan makes `adapter.list(oldPath)` throw ENOENT. Log the events during the scan and
  replay them on its result, re-read what is cheap to read synchronously at the swap, retry a folder at its new
  path (`TagIndex.scan` in `tag-everything`).
- **A view's `setState` runs before your data is loaded** at startup: don't prune restored state against an index
  that is still empty.
- **`Notice.setMessage()`** updates a long-running notice (progress) instead of stacking new ones.
- **Renaming inside your own rename handler** loops: mark paths you rename yourself (see `ownRenames` in
  `tag-everything/src/main.ts`).
- **`renameFile` to an existing path throws**: check `vault.getAbstractFileByPath(newPath)` first and refuse.
- **File names**: max 255 chars on Windows; forbidden `\ / : * ? " < > |`; Obsidian links also break on `# ^ [ ] |`.
  `[` `]` in names work in Obsidian (links are updated) but are wildcards in PowerShell paths.
- **The `obsidian` package has no runtime code**: importing it from a module makes that module untestable under
  `node --test`. Keep pure logic separate.
- **DOM decoration of core views** (explorer, tabs) must be re-applied on `layout-change` and after your data changes,
  removed on unload, and must never throw.
- **Styles**: theme variables only; prefix classes with the plugin id; `color-mix(in srgb, var(--x) 20%, transparent)`
  works for tints.

## Manifest

`manifest.json`: `id` (= folder name, lower-case, no "obsidian"), `name`, `version` (semver), `minAppVersion`
(`1.13.0` for a declarative settings tab, else the oldest version whose `@since` tags in `obsidian.d.ts` cover what
you use), `description`, `author`,
`isDesktopOnly` (`true` when using Node / Electron / `FileSystemAdapter`). `tools/lib.mjs` validates it on every
command.
