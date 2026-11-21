// Small DOM helpers shared by the panel, the dialogs and the explorer badges. No `obsidian` import: the element
// methods used here (`setAttr`, `setCssProps`, `createSpan`...) are Obsidian's global DOM extensions.

/** A DOM node of any window: `instanceof Node` is false for a node of a pop-out window, which has its own `Node`. */
export function isNode(target: EventTarget | null): target is Node {
  return !!target && typeof (target as Partial<Node>).nodeType === "number";
}

/** Makes `el` a button for the keyboard too: focusable, Enter / Space run `fn` like a click. */
export function clickable(el: HTMLElement, fn: (evt: MouseEvent | KeyboardEvent) => void): void {
  el.tabIndex = 0;
  el.setAttr("role", "button");
  el.addEventListener("click", fn);
  el.addEventListener("keydown", (evt) => {
    if ((evt.key === "Enter" || evt.key === " ") && evt.target === el) {
      evt.preventDefault();
      fn(evt);
    }
  });
}

/** Gives a chip its tag colour through the CSS variable `styles.css` reads; no colour = the theme's default. */
export function paintTag(el: HTMLElement, color: string | undefined): void {
  if (color) el.setCssProps({ "--tag-everything-color": color });
}

/**
 * Autocomplete: the tags containing `query` (any case), those starting with it first, the others in the order
 * given (most used first). Empty query -> nothing, so Enter on an empty box submits instead of picking.
 */
export function matchTags(tags: readonly string[], query: string, limit = 50): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const later = (t: string): number => Number(!t.toLowerCase().startsWith(q));
  return tags
    .filter((t) => t.toLowerCase().includes(q))
    .sort((a, b) => later(a) - later(b))
    .slice(0, limit);
}

/** One autocomplete row: the tag and how many items carry it. */
export function renderTagSuggestion(el: HTMLElement, tag: string, count: number): void {
  el.addClass("tag-everything-suggestion");
  el.createSpan({ text: tag });
  el.createSpan({ cls: "tag-everything-suggestion-count", text: String(count) });
}

/** Enter in `input` runs `fn`, unless an open autocomplete list or an IME composition already took the key. */
export function onEnter(input: HTMLInputElement, fn: () => void): void {
  input.addEventListener("keydown", (evt) => {
    if (evt.key !== "Enter" || evt.defaultPrevented || evt.isComposing) return;
    evt.preventDefault();
    fn();
  });
}
