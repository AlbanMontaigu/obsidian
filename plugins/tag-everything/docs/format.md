# TagEverything storage format

TagEverything stores tags where other tag-aware file managers already look, so the same tags are visible outside
Obsidian. The format below matches the defaults of the TagSpaces desktop app. It was verified on 2026-11-20 against
the app's bundle (`C:\Program Files\TagSpaces\resources\app.asar`, functions around `beginTagContainer`), so the
two apps read each other's tags. Keep this file and `src/format.ts` in step.

## File tags in the name

- The tag group is the text between the **first `[`** and the **first `]`** after it, anywhere in the name.
  `2024-07-18 - [IMAC] SteerCo.md` carries `IMAC`.
- Tags inside the group are separated by **one space**. Empty items are ignored.
- **New group**: written right before the extension, **no separator**: `report.pdf` → `report[tax receipt].pdf`.
  Double extensions are kept together (`backup[x].tar.gz`).
- **Existing group**: rewritten in place, so the rest of the name keeps its shape.
- **No tags left**: the group is removed, along with the space it leaves behind (`report [tax].pdf` → `report.pdf`).
- A name with brackets that don't form a clean group (`odd]name.md`) is refused rather than guessed.

## Sidecar files (`.ts` folders)

Each folder can hold a `.ts` sub-folder:

| File | Holds |
|---|---|
| `.ts/<file name>.json` | metadata of `<file name>` in that folder (tags, description, id...) |
| `.ts/<file name>.jpg` | its thumbnail |
| `.ts/tsm.json` | metadata of **the folder itself**: tags, perspective settings, custom order... |
| `.ts/tsi.json`, `.ts/tsl.json` | the other app's index and locations: **never read or written** |

Tags in a sidecar: `"tags": [{ "title": "draft", "type": "sidecar", "color": "#2D8282", "textcolor": "#fff" }]`.

- **Folder tags always go to `tsm.json`.** Folder names are never parsed for tags.
- **Name tags and sidecar tags are always merged** when reading, whatever the storage setting.
- Writing replaces only `tags` and `lastUpdated`, adds an `id` (32 hex characters) if there isn't one, and **keeps
  every other field** and any existing tag object (colour). A one-line file stays one-line.
- An empty or BOM-prefixed file is accepted. A file that isn't a JSON object is **never overwritten**: the edit fails
  for that item.
- No sidecar is created just to store an empty tag list.

## Where an edit goes (`planTags`)

| Setting | Behaviour |
|---|---|
| **File name** (default) | All the file's tags go in the name; any sidecar tags move into the name too, and the sidecar list is emptied, so a tag never lives in two places. |
| **Sidecar** | Added tags go to the sidecar; name tags you keep stay in the name, so no rename happens just to add a tag; removing a name tag still renames, since that's the only way to remove it. |

## Renames and moves

When a file is renamed or moved in Obsidian, its `.ts/<name>.json` and `.ts/<name>.jpg` move with it (setting
*Move .ts metadata with renamed files*, on by default). An existing target is never overwritten. A folder's `.ts`
folder moves with the folder on its own.

## Limits

- Names are capped at 255 characters; longer results are refused.
- Tags can't contain spaces or `[ ] # ^ | \ / : * ? " < >`.
