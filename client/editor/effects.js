import { EditorView, Decoration } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

const flashLineEffect = StateEffect.define();
const clearFlashLineEffect = StateEffect.define();
const flashLineField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashLineEffect)) {
        value = Decoration.set([Decoration.line({ class: "cm-flashLine" }).range(e.value)]);
      } else if (e.is(clearFlashLineEffect)) {
        value = Decoration.none;
      }
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export {
  flashLineEffect,
  clearFlashLineEffect,
  flashLineField,
};
