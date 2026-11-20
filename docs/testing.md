# Testing

Two levels, both runnable without the owner and without touching a real vault.

| | Unit tests | In-app smoke test |
|---|---|---|
| Command | `npm test -- <id>` | `npm run smoke -- <id>` |
| Files | `plugins/<id>/tests/**/*.test.ts` | `plugins/<id>/tests/smoke.js` (+ `tests/fixtures/vault/`) |
| Runs in | Node (`node --test`, TypeScript run directly) | A real Obsidian, throwaway profile + vault |
| Covers | Pure logic: parsing, formatting, planning, paths | Wiring: load, commands, menus, views, vault I/O, DOM |
| Speed | < 1 s | ~20 s |

## Unit tests

- Import only modules that do **not** import `obsidian`: the npm package has types but no runtime code, so
  `import { Notice } from "obsidian"` fails under Node. This is why pure logic lives in its own files.
- `import { test } from "node:test"; import assert from "node:assert/strict";` and relative imports with `.ts`.
- Test the edge cases that touch user data: empty input, Unicode, very long names, malformed files, re-running an
  operation twice (idempotence).

## In-app smoke test (`tools/smoke.mjs`)

What it does, in order:

1. Builds `dist/<id>` (skip with `--no-build`).
2. Creates `%TEMP%\obsidian-smoke-<id>-*\vault` from `plugins/<id>/tests/fixtures/vault/` (or a single `Welcome.md`),
   installs the build in it and lists the plugin in `community-plugins.json`. Unless the fixture has its own
   `.obsidian/app.json`, writes one with `showUnsupportedFiles: true`.
3. Starts Obsidian with `--user-data-dir=<temp profile>` (so it sees only that vault; your settings, vault list and
   running Obsidian are untouched) and `--remote-debugging-port=9334` (`--port` to change).
4. Over the Chrome DevTools Protocol: waits for `app.workspace.layoutReady`, turns Restricted mode off and enables
   the plugin (`app.plugins.setEnable(true)`, `enablePluginAndSave(id)`), closes the "trust this vault" dialog.
5. Runs `tests/smoke.js` inside the page, then screenshots to `dist/<id>-smoke.png`.
6. Prints every check, every console warning/error and exception. **PASS** = plugin loaded, every `check()` true,
   no unexpected console error or exception.
7. Kills only Obsidian processes started with its port, deletes the temp folder (`--keep` keeps it).

### Writing `tests/smoke.js`

The file body runs inside an `async` function in the Obsidian window. In scope:

| Name | What |
|---|---|
| `app` | Obsidian's `App` (vault, workspace, fileManager, commands, plugins...) |
| `plugin` | Your plugin instance (`app.plugins.plugins[id]`): call its public methods directly |
| `check(name, condition, detail?)` | Records one result; `detail` is printed (handy for debugging values) |
| `sleep(ms)` | Wait for debounced UI, renames, link updates (300 to 800 ms is usually enough) |
| `expectError(regex)` | Declares a console error your test provokes on purpose so it does not fail the run |
| `fakeMenu()` | Stand-in for `Menu`: pass it to `file-menu` / `files-menu` / `editor-menu` handlers, then `.titles()` and `.click(title)` |
| `Notice`, `requestUrl`, `moment` | The only Obsidian exports that are globals in the page |

It is plain JavaScript (not TypeScript, not bundled). A thrown error is reported as a failed check.
`require("obsidian")` does **not** work in the page: reach classes through instances (`app.vault`, `plugin`), or
expose what you need on the plugin.

Patterns:

```js
await plugin.someAction(app.vault.getAbstractFileByPath("note.md"));      // drive the plugin directly
app.commands.executeCommandById("<id>:<command-id>");                       // or through its command
check("file renamed", !!app.vault.getAbstractFileByPath("note[x].md"));
check("json written", JSON.parse(await app.vault.adapter.read(".ts/note.md.json")).tags.length === 1);
check("view open", document.querySelectorAll(".<id>-view").length === 1);
```

Menus: trigger the event with `fakeMenu()`, then inspect or click its items:

```js
const menu = fakeMenu();
app.workspace.trigger("file-menu", menu, app.vault.getAbstractFileByPath("note.md"), "file-explorer");
check("menu item", menu.titles().includes("Edit tags"), menu.titles().join(" | "));
menu.click("Edit tags");                        // runs the item's onClick
```

- Make public (no `private`) any plugin member the smoke test needs (e.g. `badges`, `index`).
- Settings changed in the test (`plugin.settings.x = ...`) only last for the run; the vault is thrown away.
- End by opening the plugin's main UI (modal, view) so the screenshot shows it. **Look at the screenshot**: it is
  the only check of layout and colours.
- Keep it deterministic: no network, no dates in assertions, wait with `sleep` after anything debounced.

### Fixture vault

`tests/fixtures/vault/` is copied as is. Keep it small (a handful of files) and committed. Dot-folders (`.ts`,
`.obsidian`) are copied too. File names with `[` `]` are fine (create them with `-LiteralPath` in PowerShell).
