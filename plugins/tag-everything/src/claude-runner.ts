import { App, FileSystemAdapter, TFolder } from "obsidian";
import { type Spawn, runFirstFound } from "./claude.ts";
import { type ClaudeTask, claudeArgs, claudeCommands } from "./suggest.ts";
import type { TagEverythingSettings } from "./config.ts";

/** Claude Code may read for a long time (many files, PDFs); past this, it is stopped. */
const CLAUDE_TIMEOUT_MS = 10 * 60_000;

/** Node modules of the desktop app, reached through Electron's `require` (not bundled: esbuild targets the browser). */
function nodeModules(): { spawn: Spawn; homedir: () => string } {
  const req = (window as unknown as { require: (id: string) => unknown }).require;
  const { spawn } = req("child_process") as { spawn: Spawn };
  const { homedir } = req("os") as { homedir: () => string };
  return { spawn, homedir };
}

/**
 * Runs Claude Code in `folder` with `prompt` on stdin for `task` (default: tag suggestions) and resolves to what it
 * printed (src/suggest.ts reads it). The program and model come from the settings.
 */
export function runClaudeIn(app: App, settings: TagEverythingSettings, folder: TFolder, prompt: string, signal: AbortSignal, task?: ClaudeTask): Promise<string> {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return Promise.reject(new Error("the vault is not on this computer's disk"));
  const cwd = folder.isRoot() ? adapter.getBasePath() : `${adapter.getBasePath()}/${folder.path}`;
  const { spawn, homedir } = nodeModules();
  const commands = claudeCommands(settings.claudeCommand, homedir(), navigator.platform.startsWith("Win"));
  return runFirstFound(spawn, commands, claudeArgs(settings.claudeModel, task), { cwd, input: prompt, timeoutMs: CLAUDE_TIMEOUT_MS, signal });
}
