import { snippet, type Completion } from '@codemirror/autocomplete';

// ── LaTeX snippet definitions ────────────────────────────────────

const SNIPPETS: readonly Completion[] = [
  {
    label: 'fig',
    type: 'text',
    detail: 'Figure environment',
    apply: snippet(
      '\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=0.8\\\\textwidth]{${image}}\n\\caption{${caption}}\n\\label{fig:${label}}\n\\end{figure}'
    ),
  },
  {
    label: 'tab',
    type: 'text',
    detail: 'Table environment',
    apply: snippet(
      '\\begin{table}[htbp]\n\\centering\n\\begin{tabular}{${cols}}\n\\hline\n${content}\n\\hline\n\\end{tabular}\n\\caption{${caption}}\n\\label{tab:${label}}\n\\end{table}'
    ),
  },
  {
    label: 'eq',
    type: 'text',
    detail: 'Equation environment',
    apply: snippet(
      '\\begin{equation}\n${equation}\n\\label{eq:${label}}\n\\end{equation}'
    ),
  },
  {
    label: 'ali',
    type: 'text',
    detail: 'Align environment',
    apply: snippet(
      '\\begin{align}\n${equations}\n\\end{align}'
    ),
  },
  {
    label: 'enum',
    type: 'text',
    detail: 'Enumerate list',
    apply: snippet(
      '\\begin{enumerate}\n\\item ${item}\n\\end{enumerate}'
    ),
  },
  {
    label: 'item',
    type: 'text',
    detail: 'Itemize list',
    apply: snippet(
      '\\begin{itemize}\n\\item ${item}\n\\end{itemize}'
    ),
  },
  {
    label: 'beg',
    type: 'text',
    detail: 'Generic \\begin...\\end',
    apply: snippet(
      '\\begin{${env}}\n${}\n\\end{${env}}'
    ),
  },
  {
    label: 'frm',
    type: 'text',
    detail: 'Beamer frame',
    apply: snippet(
      '\\begin{frame}{${title}}\n${content}\n\\end{frame}'
    ),
  },
  {
    label: 'mini',
    type: 'text',
    detail: 'Minipage',
    apply: snippet(
      '\\begin{minipage}{${width}\\\\textwidth}\n${content}\n\\end{minipage}'
    ),
  },
  {
    label: 'lst',
    type: 'text',
    detail: 'Code listing',
    apply: snippet(
      '\\begin{lstlisting}[language=${language}]\n${code}\n\\end{lstlisting}'
    ),
  },
];

export default SNIPPETS;
