import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';

// ── LaTeX command completions ────────────────────────────────────

const LATEX_COMMANDS = [
  // Sectioning
  { label: '\\section', type: 'keyword', detail: 'Section heading', apply: '\\section{$}' },
  { label: '\\subsection', type: 'keyword', detail: 'Subsection heading', apply: '\\subsection{$}' },
  { label: '\\subsubsection', type: 'keyword', detail: 'Subsubsection', apply: '\\subsubsection{$}' },
  { label: '\\chapter', type: 'keyword', detail: 'Chapter heading', apply: '\\chapter{$}' },
  { label: '\\part', type: 'keyword', detail: 'Part heading', apply: '\\part{$}' },
  { label: '\\paragraph', type: 'keyword', detail: 'Paragraph heading', apply: '\\paragraph{$}' },

  // Text formatting
  { label: '\\textbf', type: 'function', detail: 'Bold text', apply: '\\textbf{$}' },
  { label: '\\textit', type: 'function', detail: 'Italic text', apply: '\\textit{$}' },
  { label: '\\texttt', type: 'function', detail: 'Monospace text', apply: '\\texttt{$}' },
  { label: '\\underline', type: 'function', detail: 'Underlined text', apply: '\\underline{$}' },
  { label: '\\emph', type: 'function', detail: 'Emphasized text', apply: '\\emph{$}' },
  { label: '\\textrm', type: 'function', detail: 'Roman text', apply: '\\textrm{$}' },
  { label: '\\textsf', type: 'function', detail: 'Sans-serif text', apply: '\\textsf{$}' },
  { label: '\\textsc', type: 'function', detail: 'Small caps', apply: '\\textsc{$}' },

  // References
  { label: '\\label', type: 'function', detail: 'Set label', apply: '\\label{$}' },
  { label: '\\ref', type: 'function', detail: 'Reference', apply: '\\ref{$}' },
  { label: '\\eqref', type: 'function', detail: 'Equation ref', apply: '\\eqref{$}' },
  { label: '\\cite', type: 'function', detail: 'Citation', apply: '\\cite{$}' },
  { label: '\\pageref', type: 'function', detail: 'Page reference', apply: '\\pageref{$}' },
  { label: '\\footnote', type: 'function', detail: 'Footnote', apply: '\\footnote{$}' },

  // Includes
  { label: '\\usepackage', type: 'function', detail: 'Use package', apply: '\\usepackage{$}' },
  { label: '\\input', type: 'function', detail: 'Input file', apply: '\\input{$}' },
  { label: '\\include', type: 'function', detail: 'Include file', apply: '\\include{$}' },
  { label: '\\includegraphics', type: 'function', detail: 'Include image', apply: '\\includegraphics[width=0.8\\textwidth]{$}' },
  { label: '\\bibliography', type: 'function', detail: 'Bibliography', apply: '\\bibliography{$}' },
  { label: '\\bibliographystyle', type: 'function', detail: 'Bib style', apply: '\\bibliographystyle{$}' },
];

// Math commands
const MATH_COMMANDS = [
  { label: '\\frac', type: 'function', detail: 'Fraction', apply: '\\frac{$}{}' },
  { label: '\\sqrt', type: 'function', detail: 'Square root', apply: '\\sqrt{$}' },
  { label: '\\sum', type: 'function', detail: 'Summation', apply: '\\sum_{$}^{}' },
  { label: '\\prod', type: 'function', detail: 'Product', apply: '\\prod_{$}^{}' },
  { label: '\\int', type: 'function', detail: 'Integral', apply: '\\int_{$}^{}' },
  { label: '\\lim', type: 'function', detail: 'Limit', apply: '\\lim_{$ \\to }' },
  { label: '\\partial', type: 'function', detail: 'Partial derivative' },
  { label: '\\nabla', type: 'function', detail: 'Nabla' },
  { label: '\\infty', type: 'function', detail: 'Infinity' },
  { label: '\\alpha', type: 'variable', detail: 'Greek alpha' },
  { label: '\\beta', type: 'variable', detail: 'Greek beta' },
  { label: '\\gamma', type: 'variable', detail: 'Greek gamma' },
  { label: '\\delta', type: 'variable', detail: 'Greek delta' },
  { label: '\\epsilon', type: 'variable', detail: 'Greek epsilon' },
  { label: '\\lambda', type: 'variable', detail: 'Greek lambda' },
  { label: '\\mu', type: 'variable', detail: 'Greek mu' },
  { label: '\\sigma', type: 'variable', detail: 'Greek sigma' },
  { label: '\\theta', type: 'variable', detail: 'Greek theta' },
  { label: '\\omega', type: 'variable', detail: 'Greek omega' },
  { label: '\\pi', type: 'variable', detail: 'Greek pi' },
  { label: '\\phi', type: 'variable', detail: 'Greek phi' },
  { label: '\\leq', type: 'function', detail: 'Less or equal' },
  { label: '\\geq', type: 'function', detail: 'Greater or equal' },
  { label: '\\neq', type: 'function', detail: 'Not equal' },
  { label: '\\approx', type: 'function', detail: 'Approximately' },
  { label: '\\rightarrow', type: 'function', detail: 'Right arrow' },
  { label: '\\leftarrow', type: 'function', detail: 'Left arrow' },
  { label: '\\Rightarrow', type: 'function', detail: 'Double right arrow' },
  { label: '\\Leftrightarrow', type: 'function', detail: 'Double arrow' },
  { label: '\\mathbb', type: 'function', detail: 'Blackboard bold', apply: '\\mathbb{$}' },
  { label: '\\mathcal', type: 'function', detail: 'Calligraphic', apply: '\\mathcal{$}' },
  { label: '\\mathrm', type: 'function', detail: 'Roman math', apply: '\\mathrm{$}' },
];

const ALL_COMMANDS = [...LATEX_COMMANDS, ...MATH_COMMANDS];

// ── Environment names (for \begin{...} completion) ───────────────

const ENVIRONMENTS = [
  { label: 'document', detail: 'Document body' },
  { label: 'figure', detail: 'Float figure' },
  { label: 'table', detail: 'Float table' },
  { label: 'equation', detail: 'Numbered equation' },
  { label: 'equation*', detail: 'Unnumbered equation' },
  { label: 'align', detail: 'Aligned equations' },
  { label: 'align*', detail: 'Unnumbered aligned' },
  { label: 'itemize', detail: 'Bullet list' },
  { label: 'enumerate', detail: 'Numbered list' },
  { label: 'description', detail: 'Description list' },
  { label: 'tabular', detail: 'Table content' },
  { label: 'abstract', detail: 'Abstract' },
  { label: 'verbatim', detail: 'Verbatim text' },
  { label: 'lstlisting', detail: 'Code listing' },
  { label: 'minipage', detail: 'Mini page' },
  { label: 'center', detail: 'Centered content' },
  { label: 'flushleft', detail: 'Left-aligned' },
  { label: 'flushright', detail: 'Right-aligned' },
  { label: 'theorem', detail: 'Theorem' },
  { label: 'proof', detail: 'Proof' },
  { label: 'lemma', detail: 'Lemma' },
  { label: 'definition', detail: 'Definition' },
  { label: 'cases', detail: 'Piecewise cases' },
  { label: 'matrix', detail: 'Matrix' },
  { label: 'bmatrix', detail: 'Bracket matrix' },
  { label: 'pmatrix', detail: 'Parenthesis matrix' },
  { label: 'tikzpicture', detail: 'TikZ drawing' },
];

// ── CompletionSource: backslash commands ─────────────────────────

function latexCommandCompletion(ctx: CompletionContext): CompletionResult | null {
  // Match \word at cursor
  const word = ctx.matchBefore(/\\[a-zA-Z]*/);
  if (!word || word.from === word.to) return null;

  const query = word.text.toLowerCase();
  const options = ALL_COMMANDS
    .filter((c) => c.label.toLowerCase().startsWith(query))
    .map((c) => ({
      label: c.label,
      type: c.type,
      detail: c.detail,
      apply: c.apply ?? c.label,
    }));

  if (options.length === 0) return null;
  return { from: word.from, options, validFor: /^\\[a-zA-Z]*$/ };
}

// ── CompletionSource: environment names after \begin{ ────────────

function latexEnvCompletion(ctx: CompletionContext): CompletionResult | null {
  // Match \begin{word or \end{word
  const match = ctx.matchBefore(/\\(?:begin|end)\{[a-zA-Z*]*/);
  if (!match) return null;

  const braceIdx = match.text.indexOf('{');
  if (braceIdx < 0) return null;

  const envStart = match.from + braceIdx + 1;
  const query = match.text.slice(braceIdx + 1).toLowerCase();

  const options = ENVIRONMENTS
    .filter((e) => e.label.toLowerCase().startsWith(query))
    .map((e) => ({
      label: e.label,
      type: 'type' as const,
      detail: e.detail,
    }));

  if (options.length === 0) return null;
  return { from: envStart, options, validFor: /^[a-zA-Z*]*$/ };
}

// ── CompletionSource: \ref{} / \cite{} with project data ─────────

type DataGetter = () => { labels: string[]; bibKeys: string[] };

function createRefCompletion(getData: DataGetter) {
  return function refCompletion(ctx: CompletionContext): CompletionResult | null {
    const match = ctx.matchBefore(/\\(?:ref|eqref|pageref|autoref)\{[^}]*/);
    if (!match) return null;
    const braceIdx = match.text.indexOf('{');
    if (braceIdx < 0) return null;
    const start = match.from + braceIdx + 1;
    const query = match.text.slice(braceIdx + 1).toLowerCase();
    const { labels } = getData();
    const options = labels
      .filter((l) => l.toLowerCase().startsWith(query))
      .map((l) => ({ label: l, type: 'variable' as const, detail: 'label' }));
    if (options.length === 0) return null;
    return { from: start, options, validFor: /^[^}]*$/ };
  };
}

function createCiteCompletion(getData: DataGetter) {
  return function citeCompletion(ctx: CompletionContext): CompletionResult | null {
    const match = ctx.matchBefore(/\\(?:cite|citep|citet|parencite|textcite)\{[^}]*/);
    if (!match) return null;
    const braceIdx = match.text.indexOf('{');
    if (braceIdx < 0) return null;
    const start = match.from + braceIdx + 1;
    const query = match.text.slice(braceIdx + 1).toLowerCase();
    const { bibKeys } = getData();
    const options = bibKeys
      .filter((k) => k.toLowerCase().startsWith(query))
      .map((k) => ({ label: k, type: 'text' as const, detail: 'citation' }));
    if (options.length === 0) return null;
    return { from: start, options, validFor: /^[^}]*$/ };
  };
}

// ── Export ─────────────────────────────────────────────────────────

export {
  latexCommandCompletion,
  latexEnvCompletion,
  createRefCompletion,
  createCiteCompletion,
};
