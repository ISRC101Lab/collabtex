import { foldService } from '@codemirror/language';

/**
 * LaTeX fold strategy:
 * 1. \begin{env} ... \end{env} blocks
 * 2. \section{} ... next \section (or end of file)
 * 3. % fold comments: lines starting with %% fold until next %%
 */

const SECTION_CMDS = [
  '\\part',
  '\\chapter',
  '\\section',
  '\\subsection',
  '\\subsubsection',
  '\\paragraph',
];

const SECTION_RE = new RegExp(
  `^\\s*(${SECTION_CMDS.map((s) => s.replace('\\', '\\\\')).join('|')})\\b`,
);

const BEGIN_RE = /^(\s*)\\begin\{([^}]+)\}/;
const END_RE = /\\end\{([^}]+)\}/;

const latexFoldService = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text;

  // Fold \begin{env} ... \end{env}
  const beginMatch = text.match(BEGIN_RE);
  if (beginMatch) {
    const envName = beginMatch[2];
    let depth = 1;
    for (let i = line.number + 1; i <= state.doc.lines; i++) {
      const l = state.doc.line(i).text;
      // Count nested begins of same env
      if (l.match(new RegExp(`\\\\begin\\{${envName}\\}`))) depth++;
      if (l.match(new RegExp(`\\\\end\\{${envName}\\}`))) {
        depth--;
        if (depth === 0) {
          const endLine = state.doc.line(i);
          return { from: line.to, to: endLine.to };
        }
      }
    }
  }

  // Fold \section ... next \section (same or higher level)
  const secMatch = text.match(SECTION_RE);
  if (secMatch) {
    const cmd = secMatch[1];
    const level = SECTION_CMDS.indexOf(cmd);

    for (let i = line.number + 1; i <= state.doc.lines; i++) {
      const l = state.doc.line(i).text;
      const nextMatch = l.match(SECTION_RE);
      if (nextMatch) {
        const nextLevel = SECTION_CMDS.indexOf(nextMatch[1]);
        if (nextLevel <= level) {
          // Fold up to the line before the next section
          const foldEnd = state.doc.line(i - 1);
          if (foldEnd.number > line.number) {
            return { from: line.to, to: foldEnd.to };
          }
          return null;
        }
      }
    }

    // Fold to end of document
    const lastLine = state.doc.line(state.doc.lines);
    if (lastLine.number > line.number) {
      return { from: line.to, to: lastLine.to };
    }
  }

  return null;
});

export const latexFoldExtension = [
  latexFoldService,
];
