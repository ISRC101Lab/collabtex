import React, { useState } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { useUiStore } from '@/stores/uiStore';
import './TabBar.css';

const COMPILERS = [
  { value: 'pdflatex', label: 'pdfLaTeX' },
  { value: 'xelatex',  label: 'XeLaTeX' },
  { value: 'lualatex', label: 'LuaLaTeX' },
  { value: 'latexmk',  label: 'Latexmk' },
] as const;

function getFileName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/* ── Clean SVG icons (Claude Code style: 16×16, 1.5px stroke, round caps) ── */

function SidebarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" />
    </svg>
  );
}

function PdfIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1.5H4.5a1.5 1.5 0 0 0-1.5 1.5v10a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V5.5L9 1.5z" />
      <polyline points="9 1.5 9 5.5 13 5.5" />
      <line x1="5.5" y1="8.5" x2="10.5" y2="8.5" />
      <line x1="5.5" y1="11" x2="8.5" y2="11" />
    </svg>
  );
}

function AiIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5l1.2 3.3 3.3 1.2-3.3 1.2L8 10.5 6.8 7.2 3.5 6 6.8 4.8z" />
      <path d="M12 10l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L10 12l1.4-.6z" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.5 2.5v11l9-5.5z" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M8 2a6 6 0 1 1-5.2 3" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}

function LogsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <line x1="4.5" y1="6" x2="11.5" y2="6" />
      <line x1="4.5" y1="8.5" x2="9.5" y2="8.5" />
      <line x1="4.5" y1="11" x2="7.5" y2="11" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 6 8 10 12 6" />
    </svg>
  );
}

interface TabBarProps {
  compileLogOpen?: boolean;
  onToggleCompileLog?: () => void;
}

const TabBar: React.FC<TabBarProps> = ({ compileLogOpen, onToggleCompileLog }) => {
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFile = useEditorStore((s) => s.activeFile);
  const dirty = useEditorStore((s) => s.dirty);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeFile = useEditorStore((s) => s.closeFile);

  const compileStatus = useUiStore((s) => s.compileStatus);
  const compiler = useUiStore((s) => s.compiler);
  const setCompiler = useUiStore((s) => s.setCompiler);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  const inspectorView = useUiStore((s) => s.inspectorView);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const togglePdfPanel = useUiStore((s) => s.togglePdfPanel);
  const toggleAiPanel = useUiStore((s) => s.toggleAiPanel);

  const [compilerMenuOpen, setCompilerMenuOpen] = useState(false);
  const isCompiling = compileStatus === 'compiling';
  const paths = Array.from(openFiles.keys());

  function renderCompileIcon() {
    if (isCompiling) {
      return <SpinnerIcon className="tabbar__compile-icon tabbar__compile-icon--spinning" />;
    }
    if (compileStatus === 'success') {
      return <CheckIcon className="tabbar__compile-icon tabbar__compile-icon--success" />;
    }
    if (compileStatus === 'error') {
      return <XIcon className="tabbar__compile-icon tabbar__compile-icon--error" />;
    }
    return <PlayIcon className="tabbar__compile-icon" />;
  }

  return (
    <div className="tabbar">
      {/* ── Tabs ── */}
      <div className="tabbar__tabs">
        {paths.map((path) => {
          const isActive = path === activeFile;
          const isDirty = dirty.has(path);
          return (
            <div
              key={path}
              className={`tabbar__tab${isActive ? ' tabbar__tab--active' : ''}`}
              onClick={() => setActiveFile(path)}
            >
              <span className="tabbar__label">
                {getFileName(path)}
                {isDirty && <span className="tabbar__dirty" title="Unsaved changes" />}
              </span>
              <button
                className="tabbar__close"
                onClick={(e) => { e.stopPropagation(); closeFile(path); }}
                aria-label={`Close ${getFileName(path)}`}
              >
                &times;
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Right actions ── */}
      <div className="tabbar__actions">
        {/* Compile split button */}
        <div className="tabbar__compile-group">
          <button
            className="tabbar__compile-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('aitex:compile'))}
            disabled={isCompiling}
            title="Compile (Ctrl+Shift+B)"
          >
            {renderCompileIcon()}
            {isCompiling ? 'Compiling' : 'Compile'}
          </button>
          <button
            className="tabbar__compile-dropdown"
            onClick={() => setCompilerMenuOpen((v) => !v)}
            disabled={isCompiling}
            title="Select compiler"
          >
            <ChevronDownIcon />
          </button>
          {compilerMenuOpen && (
            <div className="tabbar__compiler-menu">
              {COMPILERS.map((c) => (
                <button
                  key={c.value}
                  className={`tabbar__compiler-opt${compiler === c.value ? ' tabbar__compiler-opt--active' : ''}`}
                  onClick={() => { setCompiler(c.value as typeof compiler); setCompilerMenuOpen(false); }}
                >
                  {compiler === c.value && <span className="tabbar__compiler-check">&#x2713;</span>}
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Separator */}
        <span className="tabbar__sep" />

        {/* Logs toggle */}
        <button
          className={'tabbar__toggle' + (compileLogOpen ? ' tabbar__toggle--active' : '')}
          onClick={onToggleCompileLog}
          title="Toggle compile log"
        >
          <LogsIcon />
        </button>

        {/* Separator */}
        <span className="tabbar__sep" />

        {/* Panel toggles — clean SVG icons */}
        <button
          className={'tabbar__toggle' + (sidebarOpen ? ' tabbar__toggle--active' : '')}
          onClick={toggleSidebar}
          title="Toggle sidebar"
        >
          <SidebarIcon />
        </button>
        <button
          className={'tabbar__toggle' + (inspectorOpen && inspectorView === 'pdf' ? ' tabbar__toggle--active' : '')}
          onClick={togglePdfPanel}
          title="Toggle PDF preview"
        >
          <PdfIcon />
        </button>
        <button
          className={'tabbar__toggle' + (inspectorOpen && inspectorView === 'ai' ? ' tabbar__toggle--active' : '')}
          onClick={toggleAiPanel}
          title="Toggle AI assistant"
        >
          <AiIcon />
        </button>
      </div>
    </div>
  );
};

export default TabBar;
