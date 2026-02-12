import React, { useState, useCallback } from 'react';
import ChevronIcon from '@/components/common/ChevronIcon';
import './EditorToolbar.css';

interface EditorToolbarProps {
  onInsert: (text: string, wrapSelection?: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  disabled?: boolean;
}

function Separator() {
  return <div className="editor-toolbar__sep" />;
}

function DropdownBtn({
  label,
  items,
  onSelect,
  disabled,
}: {
  label: string;
  items: { label: string; value: string }[];
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="editor-toolbar__dropdown">
      <button
        className="editor-toolbar__btn editor-toolbar__btn--dropdown"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        type="button"
        disabled={disabled}
      >
        <span className="editor-toolbar__dropdown-label">{label}</span>
        <span
          className={`editor-toolbar__dropdown-caret${open ? ' editor-toolbar__dropdown-caret--open' : ''}`}
          aria-hidden
        >
          <ChevronIcon className="editor-toolbar__dropdown-caret-icon" />
        </span>
      </button>
      {open && (
        <div className="editor-toolbar__dropdown-menu">
          {items.map((it) => (
            <button
              key={it.value}
              className="editor-toolbar__dropdown-item"
              onMouseDown={(e) => {
                e.preventDefault();
                if (!disabled) {
                  onSelect(it.value);
                  setOpen(false);
                }
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
  { label: 'Display \\[...]', value: '\\[\n\n\\]' },
  { label: 'Equation', value: '\\begin{equation}\n\n\\label{eq:}\n\\end{equation}' },
  { label: 'Align', value: '\\begin{align}\n\n\\end{align}' },
];

const EditorToolbar: React.FC<EditorToolbarProps> = ({
  onInsert,
  onUndo,
  onRedo,
  fontSize,
  onFontSizeChange,
  disabled,
}) => {
  const wrap = useCallback(
    (before: string, after: string) => {
      onInsert(before + '$' + after, true);
    },
    [onInsert],
  );

  const canShrink = fontSize > 12;
  const canGrow = fontSize < 28;

  return (
    <div className="editor-toolbar">
      <div className="editor-toolbar__row">
        <button
        className="editor-toolbar__btn editor-toolbar__btn--bold"
        onClick={() => wrap('\\textbf{', '}')}
        title="Bold (\\textbf)"
        type="button"
        disabled={disabled}
      >
        B
        </button>
        <button
        className="editor-toolbar__btn editor-toolbar__btn--italic"
        onClick={() => wrap('\\textit{', '}')}
        title="Italic (\\textit)"
        type="button"
        disabled={disabled}
      >
        I
        </button>
        <button
        className="editor-toolbar__btn"
        onClick={() => wrap('\\underline{', '}')}
        title="Underline"
        type="button"
        disabled={disabled}
      >
        U
        </button>
        <button
        className="editor-toolbar__btn"
        onClick={() => wrap('\\texttt{', '}')}
        title="Monospace (\\texttt)"
        type="button"
        disabled={disabled}
      >
        TT
        </button>

        <Separator />

        <button
        className="editor-toolbar__btn"
        onClick={onUndo}
        title="Undo (Ctrl+Z)"
        type="button"
        disabled={disabled}
      >
        Undo
        </button>
        <button
        className="editor-toolbar__btn"
        onClick={onRedo}
        title="Redo (Ctrl+Y)"
        type="button"
        disabled={disabled}
      >
        Redo
        </button>

        <div className="editor-toolbar__font">
        <button
          className="editor-toolbar__font-btn"
          onClick={() => onFontSizeChange(fontSize - 1)}
          disabled={disabled || !canShrink}
          title="Decrease editor font size"
          type="button"
        >
          A-
        </button>
        <span className="editor-toolbar__font-label">{fontSize}px</span>
        <button
          className="editor-toolbar__font-btn"
          onClick={() => onFontSizeChange(fontSize + 1)}
          disabled={disabled || !canGrow}
          title="Increase editor font size"
          type="button"
        >
          A+
        </button>
        </div>

        <Separator />

        <DropdownBtn label="Section" items={SECTION_ITEMS} onSelect={onInsert} disabled={disabled} />
        <DropdownBtn label="List" items={LIST_ITEMS} onSelect={onInsert} disabled={disabled} />
        <DropdownBtn label="Math" items={MATH_ITEMS} onSelect={onInsert} disabled={disabled} />

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
        disabled={disabled}
      >
        Fig
        </button>
        <button
        className="editor-toolbar__btn"
        onClick={() =>
          onInsert(
            '\\begin{table}[htbp]\n\\centering\n\\begin{tabular}{lll}\n\\hline\n & & \\\\n\\hline\n\\end{tabular}\n\\caption{}\n\\label{tab:}\n\\end{table}',
          )
        }
        title="Insert table"
        type="button"
        disabled={disabled}
      >
        Tab
        </button>
      </div>
    </div>
  );
};

export default EditorToolbar;
