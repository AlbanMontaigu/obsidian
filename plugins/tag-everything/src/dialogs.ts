// Small dialogs and input completions: a name (bookmark tab), a group (name and formula); tag and folder completion.

import { AbstractInputSuggest, App, Modal, TFolder } from "obsidian";
import * as fx from "./formula.ts";
import { plural } from "./messages.ts";
import { matchTags, onEnter, renderTagSuggestion } from "./ui.ts";

/**
 * Cancel / Save under a dialog's inputs. Save (or Enter in any of them) runs `done`; if it throws, its message goes in
 * `error` and the dialog stays open so the text can be fixed.
 */
function addSubmitButtons(modal: Modal, inputs: HTMLInputElement[], error: HTMLElement, done: () => Promise<void>): void {
  const buttons = modal.contentEl.createDiv({ cls: "modal-button-container" });
  buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => modal.close());
  const submit = async (): Promise<void> => {
    try {
      await done();
      modal.close();
    } catch (err) {
      error.setText((err as Error).message);
    }
  };
  buttons.createEl("button", { cls: "mod-cta", text: "Save" }).addEventListener("click", () => void submit());
  for (const input of inputs) onEnter(input, () => void submit());
}

/** Asks for a tab name. If `done` throws (empty name), the message shows and the dialog stays open. */
export class NameModal extends Modal {
  constructor(
    app: App,
    private heading: string,
    private initial: string,
    private placeholder: string,
    private done: (name: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tag-everything-dialog", "tag-everything-group-modal");
    this.setTitle(this.heading);
    const input = this.contentEl.createEl("input", { type: "text", cls: "tag-everything-group-input", attr: { placeholder: this.placeholder } });
    input.value = this.initial;
    const error = this.contentEl.createDiv({ cls: "tag-everything-error" });
    addSubmitButtons(this, [input], error, () => this.done(input.value));
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Completes the tag being typed in a formula (the word before the caret), in the formula dialog and the explorer's
 * box. `tags` (most used first) and `count` are read at each keystroke, so they follow the vault; `onPick` runs after a
 * tag is picked (the explorer turns it into a chip).
 */
export class FormulaTagSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private input: HTMLInputElement,
    private tags: () => readonly string[],
    private count: (tag: string) => number,
    private onPick?: () => void,
  ) {
    super(app, input);
  }

  private partial(): { start: number; word: string } {
    const caret = this.input.selectionStart ?? this.input.value.length;
    const before = this.input.value.slice(0, caret);
    const m = /[^\s()"!]*$/.exec(before)!; // always matches, possibly empty
    return { start: caret - m[0].length, word: m[0].replace(/^#/, "") };
  }

  protected getSuggestions(): string[] {
    const q = this.partial().word.toLowerCase();
    return matchTags(this.tags(), q).filter((t) => t.toLowerCase() !== q); // a complete word needs no suggestion
  }

  renderSuggestion(tag: string, el: HTMLElement): void {
    renderTagSuggestion(el, tag, this.count(tag));
  }

  selectSuggestion(tag: string): void {
    const { start } = this.partial();
    const caret = this.input.selectionStart ?? this.input.value.length;
    const text = fx.formatFormula(fx.tagExpr(tag)) + " "; // quoted when it needs to be
    this.input.value = this.input.value.slice(0, start) + text + this.input.value.slice(caret);
    this.input.setSelectionRange(start + text.length, start + text.length);
    this.close();
    this.input.dispatchEvent(new Event("input")); // refreshes the preview
    this.onPick?.();
  }
}

/** Completes a vault folder path in a text box (the auto-tag rule dialog). */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    private input: HTMLInputElement,
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): TFolder[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && !f.isRoot() && f.path.toLowerCase().includes(q))
      .slice(0, 50);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.setValue(folder.path);
    this.close();
    this.input.dispatchEvent(new Event("input")); // refreshes the preview
  }
}

/** What the group dialog needs: the vault's tags (most used first), their counts, and how many items a formula finds. */
export interface FormulaContext {
  tags: readonly string[];
  counts: ReadonlyMap<string, number>;
  countMatches: (expr: fx.Expr) => number;
}

const OPERATORS: { text: string; label: string }[] = [
  { text: "AND", label: "Both tags (also: two tags side by side)" },
  { text: "OR", label: "Either tag" },
  { text: "NOT", label: "Without the next tag" },
  { text: "(", label: "Open a group of terms" },
  { text: ")", label: "Close it" },
];

/**
 * Creates or edits a tag group in one place: its name and what it searches for, written as a formula (tags with AND,
 * OR, NOT, parentheses), with operator buttons, tag completion and a live check (syntax error, or how many items it
 * finds). `done(name, formula)` saves; if it throws, the message shows and the dialog stays open.
 */
export class GroupModal extends Modal {
  constructor(
    app: App,
    private heading: string,
    private name: string,
    private formula: string,
    private ctx: FormulaContext,
    private done: (name: string, formula: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tag-everything-dialog", "tag-everything-group-modal");
    this.setTitle(this.heading);
    const { tags, counts, countMatches } = this.ctx;
    const nameInput = this.contentEl.createEl("input", { type: "text", cls: "tag-everything-group-input", attr: { placeholder: "Group name", "aria-label": "Group name" } });
    nameInput.value = this.name;
    this.contentEl.createEl("h4", { cls: "tag-everything-section", text: "Searches for" });
    this.contentEl.createDiv({
      cls: "tag-everything-where",
      text: "Type tags (they complete) and join them: AND = all of them, OR = any, NOT = without. Parentheses group terms, e.g. (b27 OR inc) AND NOT draft.",
    });
    const ops = this.contentEl.createDiv({ cls: "tag-everything-formula-ops" });
    const input = this.contentEl.createEl("input", { type: "text", cls: "tag-everything-formula-input", attr: { placeholder: "(tag1 OR tag2) AND tag3", spellcheck: "false", "aria-label": "Formula" } });
    input.value = this.formula;
    for (const op of OPERATORS) {
      const b = ops.createEl("button", { cls: "tag-everything-formula-op", text: op.text, attr: { "aria-label": op.label, type: "button" } });
      b.addEventListener("click", () => insertAtCaret(input, op.text));
    }
    const preview = this.contentEl.createDiv({ cls: "tag-everything-formula-preview" });
    const error = this.contentEl.createDiv({ cls: "tag-everything-error" });
    new FormulaTagSuggest(this.app, input, () => tags, (t) => counts.get(t) ?? 0);

    const update = (): void => {
      preview.empty();
      error.setText("");
      if (!input.value.trim()) {
        preview.setText("No tag: an empty group, to fill by dragging tags onto it.");
        return;
      }
      const r = fx.tryParseFormula(input.value);
      if ("error" in r) {
        error.setText(r.error);
        return;
      }
      const expr = fx.resolveTags(r.expr, tags);
      preview.createDiv({ text: `${fx.formatFormula(expr)}  →  ${plural(countMatches(expr), "item")}` });
      const unknown = fx.formulaTags(expr).filter((t) => !counts.has(t));
      if (unknown.length) preview.createDiv({ cls: "tag-everything-formula-unknown", text: `No item carries ${unknown.join(", ")} (left out of the search).` });
    };
    input.addEventListener("input", update);
    update();
    addSubmitButtons(this, [nameInput, input], error, () => this.done(nameInput.value, input.value));
    window.setTimeout(() => (nameInput.value ? input : nameInput).focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Inserts an operator at the caret, with the spaces around it, and refreshes the preview. */
function insertAtCaret(input: HTMLInputElement, op: string): void {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const text = (op === ")" || !before || before.endsWith(" ") || before.endsWith("(") ? "" : " ") + op + (op === "(" ? "" : " ");
  input.value = before + text + after.replace(/^ /, "");
  const caret = start + text.length;
  input.setSelectionRange(caret, caret);
  input.focus();
  input.dispatchEvent(new Event("input"));
}
