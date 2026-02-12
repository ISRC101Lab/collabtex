import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { autocompletion } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import {
  latexCommandCompletion,
  latexEnvCompletion,
  createRefCompletion,
  createCiteCompletion,
} from '@/lib/cm-latex-completion';
import SNIPPETS from '@/lib/cm-latex-snippets';
import { latexBeginEndExtension } from '@/lib/cm-latex-brackets';
import { latexFoldExtension } from '@/lib/cm-latex-fold';
import { linter, type Diagnostic } from '@codemirror/lint';
import { logEntriesToDiagnostics } from '@/lib/compile-diagnostics';
import { parseLatexLog } from '@/lib/parse-latex-log';
import { useUiStore } from '@/stores/uiStore';
import './CodeEditor.css';

interface CodeEditorProps {
  content: string;
  onChange: (value: string) => void;
  language?: string;
  labels?: string[];
  bibKeys?: string[];
  compileLog?: string;
  activeFile?: string;
}

export interface CodeEditorHandle {
  insertText: (text: string, wrapSelection?: boolean) => void;
  jumpToLine: (line: number) => void;
  undo: () => void;
  redo: () => void;
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(({ content, onChange, language, labels, bibKeys, compileLog, activeFile }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const projectDataRef = useRef({ labels: labels ?? [], bibKeys: bibKeys ?? [] });
  const compileLogRef = useRef(compileLog ?? '');
  const editorFontSize = useUiStore((s) => s.editorFontSize);

  useImperativeHandle(ref, () => ({
    insertText(text: string, wrapSelection?: boolean) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      const hasPlaceholder = text.includes('$');
      const selected = wrapSelection ? view.state.doc.sliceString(from, to) : '';
      let insert = text;
      let cursorPos: number | null = null;

      if (hasPlaceholder) {
        const placeholderIndex = text.indexOf('$');
        insert = text.replace('$', selected);
        cursorPos = from + placeholderIndex + selected.length;
      }

      view.dispatch({
        changes: { from, to, insert },
        selection: cursorPos === null ? undefined : { anchor: cursorPos },
      });
      view.focus();
    },
    jumpToLine(lineNum: number) {
      const view = viewRef.current;
      if (!view) return;
      const doc = view.state.doc;
      const clamped = Math.max(1, Math.min(lineNum, doc.lines));
      const line = doc.line(clamped);
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      });
      view.focus();
    },
    undo() {
      const view = viewRef.current;
      if (!view) return;
      if (undo(view)) view.focus();
    },
    redo() {
      const view = viewRef.current;
      if (!view) return;
      if (redo(view)) view.focus();
    },
  }));

  // Keep refs up to date without recreating the editor
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    projectDataRef.current = { labels: labels ?? [], bibKeys: bibKeys ?? [] };
  }, [labels, bibKeys]);

  useEffect(() => {
    compileLogRef.current = compileLog ?? '';
  }, [compileLog]);

  useEffect(() => {
    if (!containerRef.current) return;

    const isTex = language === 'tex' || language === 'latex';

    // ── Extensions ──
    const extensions = [
      basicSetup,
      keymap.of([
        { key: 'Mod-z', run: undo },
        { key: 'Mod-y', run: redo },
        { key: 'Shift-Mod-z', run: redo },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          const col = pos - line.from + 1;
          useUiStore.getState().setCursor(line.number, col);
          if (update.docChanged) {
            const text = update.state.doc.toString();
            const wc = text.trim() ? text.trim().split(/\s+/).length : 0;
            useUiStore.getState().setWordCount(wc);
          }
        }
      }),
    ];

    if (isTex) {
      extensions.push(StreamLanguage.define(stex));
      const snippetSource = (ctx: import('@codemirror/autocomplete').CompletionContext) => {
        const word = ctx.matchBefore(/[a-zA-Z]+/);
        if (!word || word.from === word.to) return null;
        const q = word.text.toLowerCase();
        const opts = SNIPPETS.filter((s) => s.label.toLowerCase().startsWith(q));
        if (!opts.length) return null;
        return { from: word.from, options: opts, validFor: /^[a-zA-Z]*$/ };
      };

      const refSource = createRefCompletion(() => projectDataRef.current);
      const citeSource = createCiteCompletion(() => projectDataRef.current);

      extensions.push(
        autocompletion({
          override: [latexCommandCompletion, latexEnvCompletion, refSource, citeSource, snippetSource],
        }),
      );
      extensions.push(latexBeginEndExtension);
      extensions.push(...latexFoldExtension);

      extensions.push(
        linter((view) => {
          const log = compileLogRef.current;
          if (!log) return [];
          return logEntriesToDiagnostics(
            parseLatexLog(log),
            view,
            activeFile,
          );
        }),
      );
    }

    const state = EditorState.create({
      doc: content,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, language]);

  return (
    <div
      className="code-editor"
      ref={containerRef}
      style={{ '--editor-font-size': `${editorFontSize}px` } as React.CSSProperties}
    />
  );
});

export default CodeEditor;
