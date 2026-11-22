// User-facing message text. Pure, no `obsidian` import (unit-tested under node --test).

import { NotFoundError } from "./claude.ts";

/** The plugin's name, on every menu, notice and window it shows, so the user knows where they come from. */
export const PLUGIN_NAME = "TagEverything";

/** "1 item", "3 items". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** One Notice for every item a batch could not change (`what`: tag, move): the first `shown`, then how many more. */
export function failureMessage(failures: readonly string[], total: number, shown = 5, what = "tags not changed on"): string {
  const more = failures.length - shown;
  return (
    `${PLUGIN_NAME}: ${what} ${failures.length} of ${plural(total, "item")}:\n` +
    failures.slice(0, shown).join("\n") +
    (more > 0 ? `\n…and ${more} more (details in the developer console, Ctrl+Shift+I)` : "")
  );
}

/** Progress of a batch, e.g. "Tagging 12 of 40 items…". */
export function progressMessage(done: number, total: number): string {
  return `${PLUGIN_NAME}: tagging ${done} of ${plural(total, "item")}…`;
}

/** Why a Claude Code run failed, for the user: `doing` is what it was asked ("suggest tags"). */
export function claudeError(err: Error, doing: string): string {
  return err instanceof NotFoundError
    ? "Claude Code was not found. Install it (claude.com/claude-code), or set the full path of claude.exe in the TagEverything settings."
    : `Claude Code could not ${doing}: ${err.message}`;
}

/** What a Claude Code run took, e.g. "4 s, API cost $0.03"; "" when it said nothing. */
export function claudeTook(durationMs: number | null, costUsd: number | null): string {
  const time = durationMs !== null ? `${Math.round(durationMs / 1000)} s` : "";
  const cost = costUsd !== null ? `API cost $${costUsd.toFixed(2)}` : "";
  return [time, cost].filter(Boolean).join(", ");
}
