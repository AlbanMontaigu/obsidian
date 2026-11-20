/**
 * Automatic tag colours. Pure, no Obsidian import, so `node --test` can run it.
 * A tag without a colour of its own (set in a `.ts` sidecar) gets one of the theme's named colours, chosen from its
 * name: always the same for the same tag, in the panel, the badges and the editor. Nested tags share their root's
 * colour (`proj/alpha` and `proj/beta` look related). The theme variables follow light / dark mode.
 */

export const TAG_PALETTE: readonly string[] = [
  "var(--color-blue)",
  "var(--color-orange)",
  "var(--color-green)",
  "var(--color-purple)",
  "var(--color-red)",
  "var(--color-cyan)",
  "var(--color-yellow)",
  "var(--color-pink)",
];

/** The part of a tag that decides its colour: the root of a nested tag, case-insensitive. */
export function colorKey(tag: string): string {
  return tag.trim().replace(/^#/, "").split("/")[0].toLowerCase();
}

/** FNV-1a 32-bit hash: stable across runs and machines, well spread for short strings. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function autoColorIndex(tag: string, size = TAG_PALETTE.length): number {
  return hash(colorKey(tag)) % size;
}

export function autoColor(tag: string): string {
  return TAG_PALETTE[autoColorIndex(tag)];
}
