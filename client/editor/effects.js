import { EditorView, Decoration, WidgetType } from "@codemirror/view";
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

const ghostSuggestEffect = StateEffect.define();
const clearGhostSuggestEffect = StateEffect.define();

class GhostTextWidget extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-ghostText";
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() {
    return true;
  }
}

const ghostSuggestField = StateField.define({
  create() {
    return { text: "", deco: Decoration.none };
  },
  update(value, tr) {
    let text = value.text;
    let deco = value.deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(ghostSuggestEffect)) {
        text = String(e.value || "");
        if (!text) {
          deco = Decoration.none;
        } else {
          const pos = tr.state.selection.main.head;
          const widget = new GhostTextWidget(text);
          deco = Decoration.set([Decoration.widget({ widget, side: 1 }).range(pos)]);
        }
      } else if (e.is(clearGhostSuggestEffect)) {
        text = "";
        deco = Decoration.none;
      }
    }
    if (text && (tr.docChanged || tr.selection)) {
      text = "";
      deco = Decoration.none;
    }
    return { text, deco };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

function getGhostSuggestion(view) {
  try {
    return view.state.field(ghostSuggestField).text || "";
  } catch {
    return "";
  }
}

function setGhostSuggestion(view, text) {
  if (!view) return;
  view.dispatch({ effects: ghostSuggestEffect.of(String(text || "")) });
}

function clearGhostSuggestion(view) {
  if (!view) return;
  view.dispatch({ effects: clearGhostSuggestEffect.of(null) });
}

export {
  flashLineEffect,
  clearFlashLineEffect,
  flashLineField,
  ghostSuggestField,
  getGhostSuggestion,
  setGhostSuggestion,
  clearGhostSuggestion,
  clearGhostSuggestEffect,
};
