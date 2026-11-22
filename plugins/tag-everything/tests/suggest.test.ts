import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type SuggestInput,
  MAX_NEW_TAGS,
  claudeArgs,
  claudeCommands,
  cleanSuggestions,
  commonFolder,
  parseClaudeOutput,
  relativeTo,
  suggestPrompt,
} from "../src/suggest.ts";
import { makeRule } from "../src/naming.ts";

const input: SuggestInput = {
  folder: "Clients/B27",
  items: [
    { rel: ".", isFolder: true, tags: ["b27"] },
    { rel: "report[tax].pdf", isFolder: false, tags: ["tax"] },
    { rel: "sub/notes.md", isFolder: false, tags: [] },
  ],
  dictionary: new Map([["tax", 3], ["Finance", 9], ["b27", 2]]),
  tagRule: true,
  stopWords: "de la the",
  lowercase: false,
};
const rule = makeRule("de la the");

test("suggestPrompt: folder, items with their tags, dictionary most used first, the rule", () => {
  const p = suggestPrompt(input);
  assert.match(p, /in the folder `Clients\/B27` of a personal vault/);
  assert.match(p, /- `\.` \(a folder: this one\): b27\n- `report\[tax\]\.pdf`: tax\n- `sub\/notes\.md`: no tag yet\n/);
  assert.match(p, /`Finance` 9 · `tax` 3 · `b27` 2/);
  assert.match(p, /ONE lower-case word.*liaison word \(de la the\)/);
  assert.match(p, new RegExp(`At most ${MAX_NEW_TAGS} tags per item`));
  const loose = suggestPrompt({ ...input, folder: "", tagRule: false, lowercase: true, dictionary: new Map() });
  assert.match(loose, /in the root folder/);
  assert.match(loose, /none yet\./);
  assert.doesNotMatch(loose, /liaison/);
  assert.match(loose, /; lower-case\./);
});

test("claudeArgs: read-only tools, no customizations, JSON schema, model only when set", () => {
  const a = claudeArgs();
  assert.deepEqual(a.slice(a.indexOf("--tools"), a.indexOf("--tools") + 2), ["--tools", "Read,Glob,Grep"]);
  for (const flag of ["-p", "--safe-mode", "--strict-mcp-config", "--no-session-persistence"]) assert.ok(a.includes(flag), flag);
  assert.equal(a[a.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(JSON.parse(a[a.indexOf("--json-schema") + 1]).required[0], "items");
  assert.ok(!a.includes("--model"));
  assert.deepEqual(claudeArgs(" sonnet ").slice(-2), ["--model", "sonnet"]);
});

test("claudeCommands: the setting alone, else the PATH then ~/.local/bin", () => {
  assert.deepEqual(claudeCommands(" C:\\x\\claude.exe ", "C:\\Users\\me", true), ["C:\\x\\claude.exe"]);
  assert.deepEqual(claudeCommands("", "C:\\Users\\me", true), ["claude", "C:\\Users\\me\\.local\\bin\\claude.exe"]);
  assert.deepEqual(claudeCommands("", "/home/me", false), ["claude", "/home/me/.local/bin/claude"]);
});

const out = (o: Record<string, unknown>): string => JSON.stringify({ type: "result", subtype: "success", is_error: false, ...o });

test("parseClaudeOutput: structured output, else JSON in the result text; cost and time", () => {
  const a = parseClaudeOutput(out({ structured_output: { items: [{ path: "a.md", tags: ["x", 3, "y"] }, { path: 1 }, null] }, total_cost_usd: 0.04, duration_ms: 5300 }));
  assert.deepEqual(a, { items: [{ path: "a.md", tags: ["x", "y"] }], costUsd: 0.04, durationMs: 5300 });
  const b = parseClaudeOutput(out({ result: 'Here you go:\n{"items":[{"path":"b.md","tags":["z"]}]}\n' }));
  assert.deepEqual(b.items, [{ path: "b.md", tags: ["z"] }]);
  assert.equal(b.costUsd, null);
});

test("parseClaudeOutput: readable errors", () => {
  assert.throws(() => parseClaudeOutput("Invalid API key\n"), /did not answer in JSON: Invalid API key/);
  assert.throws(() => parseClaudeOutput(""), /\(empty output\)/);
  assert.throws(() => parseClaudeOutput(out({ is_error: true, result: "Not logged in\nRun /login" })), /^Error: Claude Code: Not logged in$/);
  assert.throws(() => parseClaudeOutput(out({ subtype: "error_max_turns" })), /error_max_turns/);
  assert.throws(() => parseClaudeOutput(out({ result: "I could not read the files." })), /gave no tag list: I could not/);
});

test("cleanSuggestions: asked items in order, rule applied, known and extension tags dropped, capped", () => {
  const s = cleanSuggestions(
    [
      { path: "./sub\\notes.md", tags: ["Meeting-Notes", "#roadmap", "de", "bad:tag", "Finance", "roadmap"] },
      { path: "report[tax].pdf", tags: ["TAX", "pdf", "invoice"] },
      { path: "./", tags: ["client"] },
      { path: "made-up.md", tags: ["x"] },
      { path: "sub/notes.md", tags: ["a", "b", "c", "d", "e"] },
    ],
    input,
    rule,
  );
  assert.deepEqual(s.map((x) => x.rel), [".", "report[tax].pdf", "sub/notes.md"]);
  assert.deepEqual(s[0].tags, ["client"]);
  assert.deepEqual(s[1].tags, ["invoice"]); // has tax already (any case); its extension is not a tag to add
  // split, # dropped, liaison word dropped, invalid dropped, lower-cased under the rule, once each, at most 5
  assert.deepEqual(s[2].tags, ["meeting", "notes", "roadmap", "finance", "a"]);
  assert.deepEqual([...s[2].fresh], ["meeting", "notes", "roadmap", "finance", "a"]); // `Finance` is not `finance`
});

test("cleanSuggestions: without the rule, the vault's spelling of a tag wins", () => {
  const s = cleanSuggestions([{ path: "sub/notes.md", tags: ["finance", "New-Tag"] }], input, null);
  assert.deepEqual(s[2].tags, ["Finance", "New-Tag"]);
  assert.deepEqual([...s[2].fresh], ["New-Tag"]);
  assert.deepEqual(s[0].tags, []);
});

test("relativeTo and commonFolder", () => {
  assert.equal(relativeTo("A/B", "A/B"), ".");
  assert.equal(relativeTo("A/B", "A/B/c.md"), "c.md");
  assert.equal(relativeTo("", "c.md"), "c.md");
  assert.equal(commonFolder(["A/B/x.md", "A/B/C/y.md"]), "A/B");
  assert.equal(commonFolder(["A/B/x.md", "A/Bc/y.md"]), "A");
  assert.equal(commonFolder(["A/B", "A/B/y.md"]), "A");
  assert.equal(commonFolder(["x.md", "A/y.md"]), "");
  assert.equal(commonFolder([]), "");
});

test("claudeArgs: a task without tools gets --tools \"\" and no allowed tools", () => {
  const a = claudeArgs("", { system: "s", schema: {}, tools: [] });
  assert.equal(a[a.indexOf("--tools") + 1], "");
  assert.ok(!a.includes("--allowedTools"));
  assert.equal(a[a.indexOf("--system-prompt") + 1], "s");
});
