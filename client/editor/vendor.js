import * as Y from "yjs";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { StreamLanguage, foldService, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { autocompletion } from "@codemirror/autocomplete";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { yCollab } from "y-codemirror.next";
import { tags as hl } from "@lezer/highlight";

const WARM_HIGHLIGHT = HighlightStyle.define([
  { tag: hl.comment, color: "#8ec07c" },
  { tag: hl.number, color: "#f4a261" },
  { tag: hl.string, color: "#ffe9cc" },
  { tag: hl.link, color: "#e76f51" },
  { tag: hl.url, color: "#e76f51" },
  { tag: hl.keyword, color: "#ffd166" },
  { tag: hl.controlKeyword, color: "#ffd166" },
  { tag: hl.definitionKeyword, color: "#ffd166" },
  { tag: hl.modifier, color: "#ffd166" },
  { tag: hl.operatorKeyword, color: "#ffedd4" },
  { tag: hl.atom, color: "#ffe3be" },
  { tag: hl.bool, color: "#ffdcb0" },
  { tag: hl.null, color: "#ffdcb0" },
  { tag: hl.name, color: "#fff2de" },
  { tag: hl.typeName, color: "#ffe6c8" },
  { tag: hl.className, color: "#ffe6c8" },
  { tag: hl.propertyName, color: "#ffe0bf" },
  { tag: hl.attributeName, color: "#ffe0bf" },
  { tag: hl.tagName, color: "#ffd9b6" },
  { tag: hl.function(hl.variableName), color: "#fff2de" },
  { tag: hl.labelName, color: "#ffe6c8" },
  { tag: hl.quote, color: "#e76f51" },
  { tag: hl.heading, color: "#ffe6c8" },
  { tag: hl.emphasis, color: "#ffe6c8", fontStyle: "italic" },
  { tag: hl.strong, color: "#ffe6c8", fontWeight: "700" },
  { tag: hl.literal, color: "#ffdcb0" },
  { tag: hl.unit, color: "#ffdcb0" },
]);

export {
  Y,
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  StreamLanguage,
  stex,
  EditorView,
  EditorState,
  basicSetup,
  autocompletion,
  foldService,
  yCollab,
  syntaxHighlighting,
  WARM_HIGHLIGHT,
};
