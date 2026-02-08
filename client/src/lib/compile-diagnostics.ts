import { type Diagnostic } from '@codemirror/lint';
import { type EditorView } from 'codemirror';
import { parseLatexLog, type LogEntry } from './parse-latex-log';

/**
 * Convert parsed LaTeX log entries into CodeMirror Diagnostics
 * that can be displayed as inline markers in the editor.
 */
export function logEntriesToDiagnostics(
  entries: LogEntry[],
  view: EditorView,
  activeFile?: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const doc = view.state.doc;

  for (const entry of entries) {
    if (!entry.line) continue;

    // Skip entries for other files
    if (entry.file && activeFile && entry.file !== activeFile) continue;

    const lineNum = Math.min(entry.line, doc.lines);
    if (lineNum < 1) continue;

    const line = doc.line(lineNum);

    diagnostics.push({
      from: line.from,
      to: line.to,
      severity: entry.level === 'error' ? 'error' : 'warning',
      message: entry.message,
      source: entry.file || 'LaTeX',
    });
  }

  return diagnostics;
}
