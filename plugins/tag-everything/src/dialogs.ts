// Small dialogs of the TagEverything panel: a name (group, bookmark tab) and a group's search formula.

import { AbstractInputSuggest, App, Modal } from "obsidian";
import * as fx from "./formula.ts";
import { plural } from "./messages.ts";
import { matchTags, onEnter, renderTagSuggestion } from "./ui.ts";

/**
 * Cancel / Save under a dialog's input. Save (or Enter) runs `done` with the text; if it throws, its message goes in
 * `error` and the dialog stays open so the text can be fixed.
 */
function addSubmitButtons(modal: Modal, input: HTMLInputElement, error: HTMLElement, done: (text: string) => Promise<void>): void {
  const buttons = modal.contentEl.createDiv({ cls: "modal-button-container" });
  buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => modal.close());
  const submit = async (): Promise<void> => {
    try {
      await done(input.value);
      modal.close();
    } catch (err) {
      error.setText((err as Error).message);
    }
  };
  buttons.createEl("button", { cls: "mod-cta", text: "Save" }).addEventListener("click", () => void submit());
  onEnter(input, () => void submit());
  window.setTimeout(() => input.focus(), 0);
}

/** Asks for a group or tab name. If `done` throws (empty name), the message shows and the dialog stays open. */
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
    this.modalEl.addClass("tag-everything-group-modal");
    this.setTitle(this.heading);
    const input = this.contentEl.createEl("input", { type: "text", cls: "tag-everything-group-input", attr: { placeholder: this.placeholder } });
    input.value = this.initial;
    const error = this.contentEl.createDiv({ cls: "tag-everything-error" });
    addSubmitButtons(this, input, error, this.done);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Completes the tag being typed in a formula (the word before the caret), in the formula dialog and the explorer's
 * box. `tags` (most used first) and `count` are read at each keystroke, so they follow the vault.
 */
export class FormulaTagSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private input: HTMLInputElement,
    private tags: () => readonly string[],
    private count: (tag: string) => number,
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
  }
}

/** Edits a group's formula, with a live check: syntax error, or how many items it finds. */
export class FormulaModal extends Modal {
  constructor(
    app: App,
    private groupName: string,
    private initial: string,
    private tags: readonly string[],
    private counts: ReadonlyMap<string, number>,
    private countMatches: (expr: fx.Expr) => number,
    private done: (text: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("tag-everything-formula-modal");
    this.setTitle(`Formula of "${this.groupName}"`);
    this.contentEl.createDiv({
      cls: "tag-everything-where",
      text:
        "Combine the tags with AND, OR, NOT (or ET, OU, NON) and parentheses, e.g. (B27 OR INC) AND (q3 OR 2026). " +
        "Two tags side by side = AND. Empty: all the group's tags (AND).",
    });
    const input = this.contentEl.createEl("input", { type: "text", cls: "tag-everything-formula-input", attr: { placeholder: "(tag1 OR tag2) AND tag3", spellcheck: "false" } });
    input.value = this.initial;
    const preview = this.contentEl.createDiv({ cls: "tag-everything-formula-preview" });
    const error = this.contentEl.createDiv({ cls: "tag-everything-error" });
    new FormulaTagSuggest(this.app, input, () => this.tags, (t) => this.counts.get(t) ?? 0);

    const update = (): void => {
      preview.empty();
      error.setText("");
      if (!input.value.trim()) {
        preview.setText("No formula: the group searches for all its tags.");
        return;
      }
      const r = fx.tryParseFormula(input.value);
      if ("error" in r) {
        error.setText(r.error);
        return;
      }
      const expr = fx.resolveTags(r.expr, this.tags);
      preview.createDiv({ text: `${fx.formatFormula(expr)}  →  ${plural(this.countMatches(expr), "item")}` });
      const unknown = fx.formulaTags(expr).filter((t) => !this.counts.has(t));
      if (unknown.length) preview.createDiv({ cls: "tag-everything-formula-unknown", text: `No item carries ${unknown.join(", ")} (left out of the search).` });
    };
    input.addEventListener("input", update);
    update();
    addSubmitButtons(this, input, error, this.done);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
