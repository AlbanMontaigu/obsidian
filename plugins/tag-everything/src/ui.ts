// Small DOM helpers shared by the panel, the dialogs and the explorer badges. No `obsidian` import: the element
// methods used here (`setAttr`, `setCssProps`, `createSpan`...) are Obsidian's global DOM extensions.

import type { DateExpr, Expr } from "./formula.ts";
import { criterionText } from "./dates.ts";
import { type CountRange, parseBound } from "./cloud.ts";

/** A DOM node of any window: `instanceof Node` is false for a node of a pop-out window, which has its own `Node`. */
export function isNode(target: EventTarget | null): target is Node {
  return !!target && typeof (target as Partial<Node>).nodeType === "number";
}

/** Drag payloads inside the panel (lower-case: DataTransfer.types lower-cases custom types). */
export const TAG_MIME = "application/x-tag-everything-tag";
export const GROUP_MIME = "application/x-tag-everything-group";

/** Accepts tags (and, with `onGroup`, groups) dragged within the panel. */
export function dropZone(el: HTMLElement, onTag: (tag: string) => void, onGroup?: (id: string) => void): void {
  const accepts = (evt: DragEvent): boolean => {
    const types = [...(evt.dataTransfer?.types ?? [])];
    return types.includes(TAG_MIME) || (!!onGroup && types.includes(GROUP_MIME));
  };
  el.addEventListener("dragover", (evt) => {
    if (!accepts(evt)) return;
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = [...evt.dataTransfer.types].includes(TAG_MIME) ? "copy" : "move";
    el.addClass("is-drop-target");
  });
  el.addEventListener("dragleave", (evt) => {
    const to = evt.relatedTarget;
    if (!(isNode(to) && el.contains(to))) el.removeClass("is-drop-target");
  });
  el.addEventListener("drop", (evt) => {
    el.removeClass("is-drop-target");
    if (!accepts(evt)) return;
    evt.preventDefault();
    evt.stopPropagation();
    const tag = evt.dataTransfer?.getData(TAG_MIME);
    const group = evt.dataTransfer?.getData(GROUP_MIME);
    if (tag) onTag(tag);
    else if (group && onGroup) onGroup(group);
  });
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

/** Draws one tag of a formula; `negated` when it is written `NOT tag`. */
export type TagChipFn = (parent: HTMLElement, tag: string, negated: boolean) => void;

/** Draws one date term of a formula (src/formula.ts `DateExpr`); `negated` when it is written `NOT created:30d`. */
export type DateChipFn = (parent: HTMLElement, term: DateExpr, negated: boolean) => HTMLElement;

/** A date term as a chip: `created in the last 30 days`, with `.tag-everything-date-chip`. */
export function dateChip(parent: HTMLElement, term: DateExpr, negated: boolean): HTMLElement {
  const el = parent.createDiv({ cls: "tag-everything-chip is-small is-selected tag-everything-date-chip" + (negated ? " is-negated" : "") });
  el.dataset.date = term.field;
  el.createSpan({ text: criterionText(term.field, term.range) });
  return el;
}

/**
 * Draws a formula: chips (from `chip`, told when the tag is negated; date terms from `date`) between AND / OR / NOT
 * and the parentheses it needs.
 */
export function renderExpr(parent: HTMLElement, e: Expr, chip: TagChipFn, date: DateChipFn = dateChip, outer: Expr["k"] | null = null): void {
  const op = (text: string, cls = ""): void => void parent.createSpan({ cls: "tag-everything-op " + cls, text });
  if (e.k === "tag") return chip(parent, e.tag, false);
  if (e.k === "date") return void date(parent, e, false);
  if (e.k === "not") {
    op("NOT");
    if (e.item.k === "tag") return chip(parent, e.item.tag, true);
    if (e.item.k === "date") return void date(parent, e.item, true);
    return renderExpr(parent, e.item, chip, date, "not");
  }
  const parens = (e.k === "or" && (outer === "and" || outer === "not")) || (e.k === "and" && outer === "not");
  if (parens) op("(", "is-paren");
  e.items.forEach((item, i) => {
    if (i) op(e.k === "and" ? "AND" : "OR");
    renderExpr(parent, item, chip, date, e.k);
  });
  if (parens) op(")", "is-paren");
}

/** The tag count range's boxes (src/ui.ts `countRangeControl`). */
export interface CountRangeControl {
  el: HTMLElement;
  /** Shows the stored range again, except in the box being typed in. */
  update(r: CountRange): void;
}

/**
 * The tag count range as two number boxes and a See all switch, for the panel's All tab and the explorer's root:
 * "used [10] to [100] times  See all" (a sentence: two bare boxes read as nothing). A readable number typed changes the range at once (`change(r, false)`: redraw the tags,
 * the box keeps the focus) and turns See all off; Enter, Escape or leaving the box commits it (`change(r, true)`: save),
 * an unreadable one goes back to the last readable value. See all shows every tag and keeps the numbers.
 */
export function countRangeControl(parent: HTMLElement, initial: CountRange, change: (r: CountRange, save: boolean) => void): CountRangeControl {
  let current: CountRange = { ...initial };
  const el = parent.createDiv({ cls: "tag-everything-range" });
  el.createSpan({ cls: "tag-everything-range-label", text: "used" });
  const boxes: HTMLInputElement[] = [];
  const box = (bound: "min" | "max", label: string, placeholder: string): HTMLInputElement => {
    const input = el.createEl("input", {
      type: "text",
      cls: "tag-everything-range-input",
      attr: { inputmode: "numeric", "aria-label": label, placeholder, spellcheck: "false" },
    });
    input.dataset.bound = bound;
    const read = (): CountRange | null => {
      const n = parseBound(input.value, bound);
      return n === null ? null : { ...current, on: true, [bound]: n };
    };
    input.addEventListener("input", () => {
      const r = read();
      if (!r) return;
      current = r;
      paint(input);
      change(current, false);
    });
    input.addEventListener("change", () => {
      current = read() ?? current;
      paint();
      change(current, true);
    });
    input.addEventListener("keydown", (evt) => {
      if (evt.isComposing) return;
      if (evt.key === "Enter" || evt.key === "Escape") {
        evt.preventDefault();
        evt.stopPropagation();
        input.blur();
      }
    });
    boxes.push(input);
    return input;
  };
  const min = box("min", "Minimum: hide the tags used fewer times", "1");
  el.createSpan({ cls: "tag-everything-range-label", text: "to" });
  const max = box("max", "Maximum: hide the tags used more times (empty: no limit)", "∞");
  el.createSpan({ cls: "tag-everything-range-label", text: "times" });
  const all = el.createEl("button", { cls: "tag-everything-range-all", text: "See all" });
  all.addEventListener("click", () => {
    current = { ...current, on: !current.on };
    paint();
    change(current, true);
  });
  /** Puts `current` in the boxes (not into `typing`, the box being typed in) and the switch. */
  function paint(typing?: HTMLInputElement): void {
    if (typing !== min) min.value = String(current.min);
    if (typing !== max) max.value = current.max ? String(current.max) : "";
    all.toggleClass("is-active", !current.on);
    all.setAttr("aria-pressed", String(!current.on));
    all.setAttr("aria-label", current.on ? "Show every tag, whatever its count" : "Every tag is shown: click to keep to the range again");
    el.toggleClass("is-off", !current.on);
  }
  paint();
  return {
    el,
    update(r: CountRange): void {
      current = { ...r };
      const doc = el.ownerDocument;
      paint(boxes.find((b) => b === doc.activeElement));
    },
  };
}
