// User-facing message text. Pure, no `obsidian` import (unit-tested under node --test).

/** "1 item", "3 items". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** One Notice for every item a batch could not tag: the first `shown`, then how many more. */
export function failureMessage(failures: readonly string[], total: number, shown = 5): string {
  const more = failures.length - shown;
  return (
    `Tags not changed on ${failures.length} of ${plural(total, "item")}:\n` +
    failures.slice(0, shown).join("\n") +
    (more > 0 ? `\n…and ${more} more (details in the developer console, Ctrl+Shift+I)` : "")
  );
}

/** Progress of a batch, e.g. "Tagging 12 of 40 items…". */
export function progressMessage(done: number, total: number): string {
  return `Tagging ${done} of ${plural(total, "item")}…`;
}
