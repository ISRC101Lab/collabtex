import React, { useState, useCallback } from 'react';
import './EditorToolbar.css';

interface EditorToolbarProps {
  onInsert: (text: string, wrapSelection?: boolean) => void;
}

function Separator() {
  return <div className="editor-toolbar__sep" />;
}

function DropdownBtn({
  label,
  items,
  onSelect,
}: {
  label: string;
  items: { label: string; value: string }[];
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="editor-toolbar__dropdown">
      <button
        className="editor-toolbar__btn"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        type="button"
      >
        {label} &#x25BE;
      </button>
      {open && (
        <div className="editor-toolbar__dropdown-menu">
          {items.map((it) => (
            <button
              key={it.value}
              className="editor-toolbar__dropdown-item"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(it.value);
                setOpen(false);
              }}
              type="button"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SECTION_ITEMS = [
  { label: '\\section', value: '\\section{$}' },
  { label: '\\subsection', value: '\\subsection{$}' },
  { label: '\\subsubsection', value: '\\subsubsection{$}' },
  { label: '\\paragraph', value: '\\paragraph{$}' },
];

const LIST_ITEMS = [
  { label: 'Itemize', value: '\\begin{itemize}\n\\item \n\\end{itemize}' },
  { label: 'Enumerate', value: '\\begin{enumerate}\n\\item \n\\end{enumerate}' },
  { label: 'Description', value: '\\begin{description}\n\\item[] \n\\end{description}' },
];

const MATH_ITEMS = [
  { label: 'Inline $...$', value: '$$' },
  { label: 'Display \\[...\\]', value: '\\[\n\n\\]' },
  { label: 'Equation', value: '\\begin{equation}\n\n\\label{eq:}\n\\end{equation}' },
  { label: 'Align', value: '\\begin{align}\n\n\\end{align}' },
];

const EditorToolbar: React.FC<EditorToolbarProps> = ({ onInsert }) => {
  const wrap = useCallback(
    (before: string, after: string) => {
      onInsert(before + after, true);
    },
    [onInsert],
  );

  return (
    <div className="editor-toolbar">
      <button
        className="editor-toolbar__btn editor-toolbar__btn--bold"
        onClick={() => wrap('\\textbf{', '}')}
        title="Bold (\\textbf)"
        type="button"
      >
        B
      </button>
      <button
        className="editor-toolbar__btn editor-toolbar__btn--italic"
        onClick={() => wrap('\\textit{', '}')}
        title="Italic (\\textit)"
        type="button"
      >
        I
      </button>
      <button
        className="editor-toolbar__btn"
        onClick={() => wrap('\\underline{', '}')}
        title="Underline"
        type="button"
      >
        U
      </button>
      <button
        className="editor-toolbar__btn"
        onClick={() => wrap('\\texttt{', '}')}
        title="Monospace (\\texttt)"
        type="button"
      >
        TT
      </button>

      <Separator />

      <DropdownBtn label="Section" items={SECTION_ITEMS} onSelect={onInsert} />
      <DropdownBtn label="List" items={LIST_ITEMS} onSelect={onInsert} />
      <DropdownBtn label="Math" items={MATH_ITEMS} onSelect={onInsert} />

      <Separator />

      <button
        className="editor-toolbar__btn"
        onClick={() =>
          onInsert(
            '\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=0.8\\textwidth]{}\n\\caption{}\n\\label{fig:}\n\\end{figure}',
          )
        }
        title="Insert figure"
        type="button"
      >
        Fig
      </button>
      <button
        className="editor-toolbar__btn"
        onClick={() =>
          onInsert(
            '\\begin{table}[htbp]\n\\centering\n\\begin{tabular}{lll}\n\\hline\n & & \\\\\n\\hline\n\\end{tabular}\n\\caption{}\n\\label{tab:}\n\\end{table}',
          )
        }
        title="Insert table"
        type="button"
      >
        Tab
      </button>
    </div>
  );
};

export default EditorToolbar;
