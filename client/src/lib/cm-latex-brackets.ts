import { EditorView, KeyBinding, keymap } from '@codemirror/view';
import { EditorState, Transaction } from '@codemirror/state';

/**
 * When the user types \begin{envname} and presses Enter,
 * auto-insert \end{envname} with proper indentation.
 */
function beginEndHandler(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  if (from !== to) return false;

  const line = state.doc.lineAt(from);
  const textBefore = line.text.slice(0, from - line.from);

  // Match \begin{envname} at end of line (possibly with trailing spaces)
  const match = textBefore.match(/\\begin\{([^}]+)\}\s*$/);
  if (!match) return false;

  const envName = match[1];
  const indent = textBefore.match(/^(\s*)/)?.[1] ?? '';

  const insert = `\n${indent}  \n${indent}\\end{${envName}}`;
  view.dispatch({
    changes: { from, to: from, insert },
    selection: { anchor: from + 1 + indent.length + 2 }, // cursor on the blank line
  });
  return true;
}

const beginEndKeymap: KeyBinding[] = [
  { key: 'Enter', run: beginEndHandler },
];

export const latexBeginEndExtension = keymap.of(beginEndKeymap);
