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

const aiDiffEffect = StateEffect.define();
const clearAiDiffEffect = StateEffect.define();

class AiInsertWidget extends WidgetType {
  constructor(lines) {
    super();
    this.lines = Array.isArray(lines) ? lines : [];
  }
  toDOM() {
    const block = document.createElement("div");
    block.className = "cm-aiDiffBlock";
    for (const line of this.lines) {
      const row = document.createElement("div");
      const type = line && line.type ? line.type : "same";
      row.className = `cm-aiDiffLine ${type}`;
      const prefix = type === "add" ? "+ " : type === "del" ? "- " : "  ";
      if (Array.isArray(line.segments) && line.segments.length) {
        const pre = document.createElement("span");
        pre.className = "cm-aiDiffPrefix";
        pre.textContent = prefix;
        row.appendChild(pre);
        for (const seg of line.segments) {
          const span = document.createElement("span");
          span.className = `cm-aiDiffSeg ${seg.type || "same"}`;
          span.textContent = seg.text || "";
          row.appendChild(span);
        }
      } else {
        row.textContent = `${prefix}${line.text || ""}`;
      }
      block.appendChild(row);
    }
    return block;
  }
  ignoreEvent() {
    return true;
  }
}

const aiDiffField = StateField.define({
  create() {
    return { from: null, to: null, lines: [], deco: Decoration.none };
  },
  update(value, tr) {
    let { from, to, lines, deco } = value;
    deco = deco.map(tr.changes);
    if (from != null && to != null) {
      from = tr.changes.mapPos(from);
      to = tr.changes.mapPos(to);
    }
    for (const e of tr.effects) {
      if (e.is(aiDiffEffect)) {
        const v = e.value || {};
        from = v.from;
        to = v.to;
        lines = Array.isArray(v.lines) ? v.lines : [];
        if (from == null || to == null || !lines.length) {
          deco = Decoration.none;
        } else {
          const widget = new AiInsertWidget(lines);
          deco = Decoration.set([
            Decoration.mark({ class: "cm-aiDelete" }).range(from, to),
            Decoration.widget({ widget, side: 1 }).range(to),
          ]);
        }
      } else if (e.is(clearAiDiffEffect)) {
        from = null;
        to = null;
        lines = [];
        deco = Decoration.none;
      }
    }
    return { from, to, lines, deco };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

function setAiDiff(view, from, to, lines) {
  if (!view) return;
  view.dispatch({ effects: aiDiffEffect.of({ from, to, lines }) });
}

function clearAiDiff(view) {
  if (!view) return;
  view.dispatch({ effects: clearAiDiffEffect.of(null) });
}

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
  aiDiffField,
  setAiDiff,
  clearAiDiff,
  clearAiDiffEffect,
};
