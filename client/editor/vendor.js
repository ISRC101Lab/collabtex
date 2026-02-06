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
  { tag: hl.comment, color: "#8fd4a8" },
  { tag: hl.number, color: "#d4bfff" },
  { tag: hl.string, color: "#d8f3e6" },
  { tag: hl.link, color: "#cdb7ff" },
  { tag: hl.url, color: "#cdb7ff" },
  { tag: hl.keyword, color: "#decaff" },
  { tag: hl.controlKeyword, color: "#decaff" },
  { tag: hl.definitionKeyword, color: "#decaff" },
  { tag: hl.modifier, color: "#decaff" },
  { tag: hl.operatorKeyword, color: "#edf5ff" },
  { tag: hl.atom, color: "#d5c1ff" },
  { tag: hl.bool, color: "#d0eede" },
  { tag: hl.null, color: "#d0eede" },
  { tag: hl.name, color: "#f4fbff" },
  { tag: hl.typeName, color: "#dbf7ea" },
  { tag: hl.className, color: "#dbf7ea" },
  { tag: hl.propertyName, color: "#d0f0df" },
  { tag: hl.attributeName, color: "#d0f0df" },
  { tag: hl.tagName, color: "#dfccff" },
  { tag: hl.function(hl.variableName), color: "#f2fbff" },
  { tag: hl.labelName, color: "#e1f9ee" },
  { tag: hl.quote, color: "#ccbeff" },
  { tag: hl.heading, color: "#e5fbf1" },
  { tag: hl.emphasis, color: "#e5fbf1", fontStyle: "italic" },
  { tag: hl.strong, color: "#e5fbf1", fontWeight: "700" },
  { tag: hl.literal, color: "#caebda" },
  { tag: hl.unit, color: "#caebda" },
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
