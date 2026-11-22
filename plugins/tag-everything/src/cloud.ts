/**
 * Tag cloud sizing. Pure, no Obsidian import, so `node --test` can run it.
 * A tag's weight is 0 (least used shown) to 1 (most used shown), on a log scale: in a real vault a few tags
 * carry most of the uses, and a linear scale would leave every other tag at the minimum. The weight is rounded
 * to a few levels so the cloud stays tidy; the stylesheet turns it into a bounded font size.
 */

export const CLOUD_LEVELS = 5;

export function cloudWeight(count: number, min: number, max: number, levels = CLOUD_LEVELS): number {
  if (!(max > min) || !(count > min)) return 0;
  if (count >= max) return 1;
  const lo = Math.log(Math.max(min, 1));
  const w = (Math.log(count) - lo) / (Math.log(max) - lo);
  const steps = Math.max(levels - 1, 1);
  return Math.round(Math.min(Math.max(w, 0), 1) * steps) / steps;
}

/** Weight of every tag in `counts`, relative to the smallest and largest count among them. */
export function cloudWeights(counts: ReadonlyMap<string, number> | Iterable<[string, number]>): Map<string, number> {
  const rows = [...counts];
  const values = rows.map(([, n]) => n);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return new Map(rows.map(([t, n]) => [t, cloudWeight(n, min, max)]));
}

/**
 * The tags that can still narrow a search finding `total` items, from their `counts` within it: on some of them but
 * not on all (a tag on every item would change nothing), and not already in the search (`taken`). Most used first.
 */
export function narrowingTags(counts: ReadonlyMap<string, number>, total: number, taken: readonly string[]): [string, number][] {
  return [...counts]
    .filter(([t, n]) => n > 0 && n < total && !taken.includes(t))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
