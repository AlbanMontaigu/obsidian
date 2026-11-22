// Tag suggestions by Claude Code: the prompt, the command line, and reading the answer. Pure, no `obsidian` import
// (unit-tested under node --test). The process runs in claude.ts, the review dialog is suggest-modal.ts.
//
// Claude Code runs headless (`claude -p`) in the items' folder with read-only tools (Read, Glob, Grep), reads the
// files, and answers in a JSON schema: for each item, the tags to add. It is told the vault's existing tags (the
// dictionary) so it reuses them, and the naming rule so its tags can be written as they are.

import { dedupe, extensionTag, normalizeTag } from "./format.ts";
import { type NamingRule, parseStopWords, suggestFix } from "./naming.ts";
import { tagList } from "./guide.ts";

/** More items than this in one run: the first ones only (the time and the cost grow with every file read). */
export const MAX_SUGGEST_ITEMS = 50;
/** New tags suggested per item, at most. */
export const MAX_NEW_TAGS = 5;
/** Existing tags listed in the prompt, most used first. */
const MAX_DICTIONARY = 300;

export interface SuggestItem {
  /** Path relative to the working folder (`.` for the folder itself). */
  rel: string;
  isFolder: boolean;
  /** Tags the item already carries (stored ones, not the extension tag). */
  tags: readonly string[];
}

export interface SuggestInput {
  /** The working folder, vault-relative ("" = vault root). */
  folder: string;
  items: readonly SuggestItem[];
  /** Every stored tag of the vault with how many items carry it: the dictionary to reuse. */
  dictionary: ReadonlyMap<string, number>;
  tagRule: boolean;
  stopWords: string;
  lowercase: boolean;
}

/** The answer's shape, given to `claude --json-schema`. */
export const SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
        required: ["path", "tags"],
      },
    },
  },
  required: ["items"],
};

/** One kind of question asked to Claude Code: its system prompt, the answer's JSON schema, the tools it may use. */
export interface ClaudeTask {
  system: string;
  schema: object;
  /** Read-only built-in tools; none = it answers from the prompt alone. */
  tools: readonly ("Read" | "Glob" | "Grep")[];
}

/** Tag suggestions: Claude Code reads the files. */
export const SUGGEST_TASK: ClaudeTask = {
  system:
    "You suggest tags for files of a personal note vault. Read the files with your tools, never change anything, " +
    "then answer with the structured output only.",
  schema: SUGGEST_SCHEMA,
  tools: ["Read", "Glob", "Grep"],
};

/**
 * Command-line arguments: print mode, JSON answer, the task's read-only tools allowed without asking (or no tool at
 * all), and none of the user's customizations (MCP servers, plugins, skills, CLAUDE.md): they would cost tokens and
 * add nothing here. The prompt goes through stdin.
 */
export function claudeArgs(model = "", task: ClaudeTask = SUGGEST_TASK): string[] {
  const tools = task.tools.join(",");
  const args = [
    "-p",
    "--output-format", "json",
    "--tools", tools, // "" = no tool
    ...(tools ? ["--allowedTools", tools] : []),
    "--permission-mode", "dontAsk",
    "--no-session-persistence",
    "--safe-mode",
    "--strict-mcp-config",
    "--system-prompt", task.system,
    "--json-schema", JSON.stringify(task.schema),
  ];
  const m = model.trim();
  if (m) args.push("--model", m);
  return args;
}

/**
 * The commands to try, in order: the one set in the settings, else `claude` on the PATH, then the native
 * installer's place (`~/.local/bin`), which Obsidian's PATH may lack when it was started before the install.
 */
export function claudeCommands(setting: string, home: string, windows: boolean): string[] {
  const s = setting.trim();
  if (s) return [s];
  const sep = windows ? "\\" : "/";
  return ["claude", [home, ".local", "bin", windows ? "claude.exe" : "claude"].join(sep)];
}

/** The naming rule as told to Claude Code. */
export function ruleText(input: Pick<SuggestInput, "tagRule" | "stopWords" | "lowercase">): string {
  if (input.tagRule) {
    return (
      "- Each tag is ONE lower-case word: letters and digits only, no space, no -, _ or / (write two tags instead " +
      `of a compound), never a liaison word (${parseStopWords(input.stopWords).join(" ")}).`
    );
  }
  return `- A tag has no space and none of [ ] # ^ | \\ / : * ? " < >${input.lowercase ? "; lower-case" : ""}.`;
}

/** The prompt sent to Claude Code (stdin). */
export function suggestPrompt(input: SuggestInput): string {
  const where = input.folder ? `the folder \`${input.folder}\`` : "the root folder";
  const items = input.items.map((i) => {
    const name = i.isFolder ? `\`${i.rel}\` (a folder${i.rel === "." ? ": this one" : ""})` : `\`${i.rel}\``;
    return `- ${name}: ${i.tags.length ? i.tags.join(", ") : "no tag yet"}`;
  });
  return [
    `Suggest tags for the items listed below. They are in ${where} of a personal vault, which is your working directory.`,
    "",
    "How:",
    "- Read each file with your tools (text, Markdown, PDF and images can be read). For a file you cannot read " +
      "(Office documents, archives...), judge from its name, its folder and its neighbours.",
    "- Look at the other files of the folder for context. A folder's tags describe what it holds.",
    "- Never write, move or delete anything.",
    "",
    "Tags:",
    "- Reuse the existing tags listed below whenever one fits; create a new tag only when none does, in the language " +
      "the existing tags use.",
    ruleText(input),
    `- At most ${MAX_NEW_TAGS} tags per item, the most useful first; an empty list when nothing fits.`,
    "- Never repeat a tag the item already has, nor its file extension (pdf, md...).",
    "- A file name may hold tags in brackets: `report[tax receipt].pdf` already has the tags tax and receipt.",
    "",
    "Existing tags in the vault (most used first, with how many items carry them):",
    tagList(input.dictionary, MAX_DICTIONARY),
    "",
    "Items (path relative to the working directory: current tags):",
    ...items,
    "",
    'Answer: {"items": [{"path": "<path exactly as listed>", "tags": ["..."]}]}, one entry per item.',
  ].join("\n");
}

/** What a run of Claude Code returned: the raw answer per path, and what it took. */
export interface ClaudeAnswer {
  items: { path: string; tags: string[] }[];
  costUsd: number | null;
  durationMs: number | null;
}

/** What a run of Claude Code returned: its structured answer (any shape: the caller checks it), and what it took. */
export interface ClaudeResult {
  answer: unknown;
  costUsd: number | null;
  durationMs: number | null;
}

/**
 * Reads the JSON that `claude -p --output-format json` prints. The answer is in `structured_output`, else in the
 * `result` text (a JSON object somewhere in it; null if none). Throws a readable error when Claude Code reported one
 * or did not answer in JSON.
 */
export function readClaudeResult(stdout: string): ClaudeResult & { text: string } {
  let out: Record<string, unknown>;
  try {
    out = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    throw new Error(`Claude Code did not answer in JSON: ${firstLine(stdout) || "(empty output)"}`);
  }
  const result = typeof out.result === "string" ? out.result : "";
  if (out.is_error === true || (typeof out.subtype === "string" && out.subtype !== "success")) {
    throw new Error(`Claude Code: ${firstLine(result) || String(out.subtype ?? "error")}`);
  }
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return { answer: out.structured_output ?? jsonIn(result), text: result, costUsd: num(out.total_cost_usd), durationMs: num(out.duration_ms) };
}

/** Reads a tag-suggestion run (`readClaudeResult`); throws when the answer holds no item list. */
export function parseClaudeOutput(stdout: string): ClaudeAnswer {
  const { answer, text, costUsd, durationMs } = readClaudeResult(stdout);
  const raw = answer && typeof answer === "object" ? (answer as { items?: unknown }).items : undefined;
  if (!Array.isArray(raw)) throw new Error(`Claude Code gave no tag list: ${firstLine(text) || "(empty answer)"}`);
  const items: ClaudeAnswer["items"] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const { path, tags } = e as { path?: unknown; tags?: unknown };
    if (typeof path !== "string" || !Array.isArray(tags)) continue;
    items.push({ path, tags: tags.filter((t): t is string => typeof t === "string") });
  }
  return { items, costUsd, durationMs };
}

/** The first line of a text, at most 300 characters: for error messages. */
export function firstLine(text: string): string {
  return text.trim().split("\n")[0].slice(0, 300);
}

/** The first `{...}` of a text that parses as JSON, else null. */
function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Tags to add to one item, and which of them the vault has never used. */
export interface Suggestion {
  rel: string;
  tags: string[];
  fresh: Set<string>;
}

/**
 * The answer made safe to write: one entry per asked item, in the asked order (paths Claude made up are ignored).
 * Each tag is normalized (invalid ones dropped), put to the naming rule (a compound is split, a liaison word
 * dropped) or, without the rule, matched to the dictionary's spelling, and dropped when the item already has it or it is the item's
 * extension. At most `MAX_NEW_TAGS` per item.
 */
export function cleanSuggestions(
  answer: ClaudeAnswer["items"],
  input: Pick<SuggestInput, "items" | "dictionary" | "lowercase">,
  rule: NamingRule | null,
): Suggestion[] {
  const byPath = new Map<string, string[]>();
  for (const a of answer) byPath.set(cleanRel(a.path), [...(byPath.get(cleanRel(a.path)) ?? []), ...a.tags]);
  const known = new Map<string, string>();
  for (const t of input.dictionary.keys()) if (!known.has(t.toLowerCase())) known.set(t.toLowerCase(), t);
  return input.items.map((item) => {
    const has = new Set(item.tags.map((t) => t.toLowerCase()));
    const ext = item.isFolder ? null : extensionTag(item.rel);
    const tags: string[] = [];
    for (const raw of byPath.get(cleanRel(item.rel)) ?? []) {
      const { tag } = normalizeTag(raw.replace(/^#/, ""), !!rule || input.lowercase);
      if (!tag) continue;
      for (const word of rule ? suggestFix(tag, rule) : [tag]) {
        // Without the rule, the vault's spelling wins (`Tax` stays `Tax`); with it, the rule's lower case does.
        const t = rule ? word : (known.get(word.toLowerCase()) ?? word);
        if (!has.has(t.toLowerCase()) && t.toLowerCase() !== ext) tags.push(t);
      }
    }
    const kept = dedupe(tags).slice(0, MAX_NEW_TAGS);
    return { rel: item.rel, tags: kept, fresh: new Set(kept.filter((t) => !input.dictionary.has(t))) };
  });
}

/** `./a\b.md` -> `a/b.md`; `./`, `` -> `.` */
function cleanRel(path: string): string {
  const p = path.trim().replaceAll("\\", "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  return p === "" || p === "." ? "." : p;
}

/** Path of `path` relative to `folder` (both vault-relative; "" = root); the folder itself is `.`. */
export function relativeTo(folder: string, path: string): string {
  if (path === folder) return ".";
  return folder ? path.slice(folder.length + 1) : path;
}

/** The deepest folder holding every path ("" = vault root), for a selection spread over several folders. */
export function commonFolder(paths: readonly string[]): string {
  const parent = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  if (!paths.length) return "";
  let common = parent(paths[0]);
  for (const p of paths.slice(1)) {
    while (common && !(p === common || p.startsWith(`${common}/`))) common = parent(common);
  }
  return common;
}
