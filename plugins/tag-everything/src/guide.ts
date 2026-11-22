// The AI assistant guide: a `CLAUDE.md` written into a folder so that a coding assistant working in the vault (it
// reads that file from the folder it starts in and its parents) knows how tags are stored here, which tags already
// exist, and how to add one without breaking the format. Pure, no `obsidian` import (unit-tested under node --test).
// The file is written once and never overwritten (main.ts `writeGuide`).

import type { StorageMode } from "./format.ts";
import { parseStopWords } from "./naming.ts";

export const GUIDE_FILE = "CLAUDE.md";

/** Tags listed per section; the rest is counted ("…and N more"). */
const MAX_LISTED = 80;

export interface GuideInput {
  /** Vault path of the folder the guide is written to; "" or "/" for the vault root. */
  folder: string;
  storage: StorageMode;
  noteTagsInFrontmatter: boolean;
  tagRule: boolean;
  lowercase: boolean;
  stopWords: string;
  /** Each file's extension counts as a tag in Obsidian (read from the name, never written). */
  extensionTags: boolean;
  /** Settings `inheritFolderTags` / `folderNameTags` (src/inherit.ts): tags shown in Obsidian, never written. */
  inheritFolderTags: boolean;
  folderNameTags: boolean;
  /** Tag -> items, over the folder and everything under it (ignored at the vault root). */
  folderTags: ReadonlyMap<string, number>;
  /** Tag -> items, over the whole vault. */
  vaultTags: ReadonlyMap<string, number>;
  /** Day the guide is written, `YYYY-MM-DD`. */
  date: string;
}

const isRoot = (folder: string): boolean => folder === "" || folder === "/";

/** Where the guide of `folder` goes. */
export function guidePath(folder: string): string {
  return isRoot(folder) ? GUIDE_FILE : `${folder}/${GUIDE_FILE}`;
}

/** True when one of these names is already a guide (case-insensitive: `claude.md` is the same file on Windows). */
export function hasGuide(names: Iterable<string>): boolean {
  for (const n of names) if (n.toLowerCase() === GUIDE_FILE.toLowerCase()) return true;
  return false;
}

/** "`tax` 12 · `receipt` 3 …and 5 more", most used first; "none yet" when empty. */
export function tagList(counts: ReadonlyMap<string, number>, max = MAX_LISTED): string {
  if (!counts.size) return "none yet.";
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, max).map(([t, n]) => `\`${t}\` ${n}`).join(" · ");
  return sorted.length > max ? `${shown} …and ${sorted.length - max} more (list them as above).` : shown;
}

/** The guide's Markdown, from the vault's settings and its tags at the time of writing. */
export function claudeGuide(g: GuideInput): string {
  const where = g.noteTagsInFrontmatter ? "the frontmatter `tags` property" : storageText(g.storage);
  const rows = [
    `| Markdown note | ${where} | ${g.noteTagsInFrontmatter ? "`tags: [tax, receipt]`" : example(g.storage)} |`,
    `| Any other file | ${storageText(g.storage)} | ${example(g.storage)} |`,
    "| Folder | always `<folder>/.ts/tsm.json`, never the folder name | `Clients/.ts/tsm.json` |",
  ];
  const lines = [
    "# Tags in this vault",
    "",
    `Written on ${g.date} by the TagEverything plugin for AI assistants working in this vault. It is never`,
    "overwritten: to refresh it (tag lists, settings), delete it and write it again in Obsidian (right-click the",
    "folder → *Write AI assistant guide*, or the command *Write AI assistant guide in the vault root*).",
    "",
    "Files and folders here carry tags, read by Obsidian and by other tag-aware file managers. When you tag, search,",
    "rename or move files, follow this guide so no tag is lost or written where nothing reads it.",
    "",
    "## Where tags live",
    "",
    "| Item | New tags go to | Example |",
    "|---|---|---|",
    ...rows,
    "",
    "An item's tags are **all** of these merged, wherever they are: the `[...]` group of its name, a note's frontmatter",
    "`tags` (or the older `tag`, a list or a comma / space string, `#` optional) and its sidecar",
    "`<folder>/.ts/<file name>.json` (`tags[].title`). Inline `#tags` in a note's text are **not** tags here.",
    ...(g.extensionTags
      ? [
          "In Obsidian each file also carries its extension as a tag, lower-cased (`pdf`, `md`): it is read from the",
          "name, so never write it as a tag; it is left out of the lists below.",
        ]
      : []),
    ...(g.inheritFolderTags || g.folderNameTags
      ? [
          `In Obsidian an item also carries, as inherited tags, ${[g.inheritFolderTags && "the tags of every folder above it", g.folderNameTags && "the words of its folders' names (`1. Projects/B27` gives `projects` and `b27`)"].filter(Boolean).join(" and ")}:`,
          "they are never written, so don't copy them onto the files; tag the folder instead. The lists below leave them out.",
        ]
      : []),
    "",
    "- **Name tags**: the text between the first `[` and the first `]` after it, anywhere in the name, separated by",
    "  one space: `2024-07-18 - [imac] steerco.md` carries `imac`; `B27_Board[b27 inc].docx` carries `b27` and `inc`.",
    "- **Finding them**: list names first (`rg --files | rg '\\['`), sidecars next (`rg --hidden -l '\"title\"' -g '**/.ts/*.json'`),",
    "  note frontmatter last. The vault may sit on a cloud drive with files kept online only: listing names is free,",
    "  reading a file's content downloads it, so read contents only where needed.",
    "",
    "## Choosing tags",
    "",
    "- **Reuse** a tag listed below before creating one; one meaning, one spelling.",
    ...ruleLines(g),
    "- Never in a tag: a space or `[ ] # ^ | \\ / : * ? \" < >`. A nested tag (`proj/alpha`) only goes in a note's",
    "  frontmatter, never in a file name.",
    "- A few tags that say what the item is or is about (client, project, kind of document, subject); not what its",
    "  folder or its name already says.",
    "",
    "## Writing tags",
    "",
    "The safest way is in Obsidian: right-click → *Edit tags*. Renames then go through Obsidian, which updates links.",
    "If you write them yourself:",
    "",
    ...writeLines(g),
    "- **Folder**: edit `tags` in `<folder>/.ts/tsm.json` (create `{ \"tags\": [...] }` if missing).",
    "- **A sidecar or `tsm.json`**: change only `tags` (`[{ \"title\": \"tax\", \"type\": \"sidecar\" }]`) and",
    "  `lastUpdated` (ms since 1970); keep every other field, and the existing tag objects (their colours). A file that",
    "  isn't valid JSON is never overwritten. Never write `.ts/tsi.json` or `.ts/tsl.json`; never delete a `.ts` folder.",
    "- A tag lives in one place: when you move it (e.g. sidecar → name), remove it from where it was.",
    "- **Many files**: show the plan (file → tags, old name → new name) and wait for approval before renaming.",
    "- **Afterwards**: Obsidian follows name and frontmatter changes live; after editing `.ts` files, ask the user to",
    "  run the command *Re-read all tags* in Obsidian.",
    "",
  ];
  if (!isRoot(g.folder)) {
    lines.push(`## Tags used in \`${g.folder}\` (when this guide was written)`, "", tagList(g.folderTags), "");
  }
  lines.push("## Most used tags in the vault (when this guide was written)", "", tagList(g.vaultTags), "");
  return lines.join("\n");
}

function storageText(storage: StorageMode): string {
  return storage === "filename" ? "the file name, in a `[...]` group" : "a sidecar `<folder>/.ts/<file name>.json`";
}

function example(storage: StorageMode): string {
  return storage === "filename" ? "`report[tax receipt].pdf`" : "`.ts/report.pdf.json`";
}

function ruleLines(g: GuideInput): string[] {
  if (!g.tagRule) {
    return [`- No naming rule is enforced${g.lowercase ? ", but new tags are lower-case" : ""}; stay consistent with the existing tags.`];
  }
  return [
    "- **Naming rule**: a tag is one lower-case word of letters and digits (accents allowed), no `/`, `-`, `_` or `.`, and",
    "  never a liaison word. `Tax-Receipt` is two tags, `tax` and `receipt`; `plan_de_charge` is `plan` and `charge`;",
    "  `R&D` is `rd`; no nested tag: `proj/alpha` is `proj` and `alpha`. Liaison words:",
    `  ${parseStopWords(g.stopWords).join(" ")}.`,
  ];
}

function writeLines(g: GuideInput): string[] {
  const rename = [
    "  - Rename `report.pdf` → `report[tax receipt].pdf`: a new group goes right before the extension with no space; an",
    "    existing group is rewritten in place; with no tag left the group goes, with the space before it. Names stay",
    "    under 255 characters. Never overwrite an existing file.",
    "  - Move its sidecar and thumbnail along: `.ts/report.pdf.json` → `.ts/report[tax receipt].pdf.json`, same for `.jpg`.",
    "  - A rename outside Obsidian does **not** update links: find the notes linking to the old name",
    "    (`[[report]]`, `![[report.pdf]]`, `](report.pdf)`) and fix them, or ask the user to tag it in Obsidian.",
  ];
  const sidecar = [
    "  - Write the tags in its sidecar `<folder>/.ts/<file name>.json` (see below); no rename. Tags already in the name",
    "    stay there; to remove one, rename the file (as for the name, links included).",
  ];
  const other = g.storage === "filename" ? rename : sidecar;
  const note = g.noteTagsInFrontmatter
    ? [
        "- **Markdown note**: edit only the frontmatter `tags` list (create the `---` block if there is none); keep every",
        "  other property. Never rewrite frontmatter that isn't valid YAML. Don't rename a note to add a tag; tags",
        "  already in its name stay there.",
      ]
    : ["- **Markdown note**: like any other file, below."];
  return [...note, "- **Any other file**:", ...other];
}
