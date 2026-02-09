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

function SidebarPanelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="3.5" y="3.5" width="4.8" height="13" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.8 5.5H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10.8 10H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10.8 14.5H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PdfPanelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M6 3.5H12.4L15 6.1V16.5H6V3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12.4 3.5V6.1H15" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.9 9.3H13.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.9 12H13.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.9 14.7H11.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AiPanelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M10 4.1L11.4 7.1L14.4 8.5L11.4 9.9L10 12.9L8.6 9.9L5.6 8.5L8.6 7.1L10 4.1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M4.2 12.5L4.75 13.75L6 14.3L4.75 14.85L4.2 16.1L3.65 14.85L2.4 14.3L3.65 13.75L4.2 12.5Z" fill="currentColor" />
    </svg>
  );
}

const TabBar: React.FC = () => {
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
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);
  const setInspectorView = useUiStore((s) => s.setInspectorView);

  const [compilerMenuOpen, setCompilerMenuOpen] = useState(false);
  const isCompiling = compileStatus === 'compiling';
  const paths = Array.from(openFiles.keys());

  function renderCompileIcon() {
    if (isCompiling) {
      return <span className="tabbar__compile-icon tabbar__compile-icon--spinning">&#x21BB;</span>;
    }
    if (compileStatus === 'success') {
      return <span className="tabbar__compile-icon tabbar__compile-icon--success">&#x2713;</span>;
    }
    if (compileStatus === 'error') {
      return <span className="tabbar__compile-icon tabbar__compile-icon--error">&#x2717;</span>;
    }
    return <span className="tabbar__compile-icon">&#x25B6;</span>;
  }

  const openPdfInspector = () => {
    setInspectorView('pdf');
    if (!inspectorOpen) {
      setInspectorOpen(true);
    }
  };

  const openAiInspector = () => {
    setInspectorView('ai');
    if (!inspectorOpen) {
      setInspectorOpen(true);
    }
  };

  const toggleInspector = () => {
    setInspectorOpen(!inspectorOpen);
  };

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
            {isCompiling ? 'Compiling...' : 'Compile'}
          </button>
          <button
            className="tabbar__compile-dropdown"
            onClick={() => setCompilerMenuOpen((v) => !v)}
            disabled={isCompiling}
            title="Select compiler"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 6l5 5 5-5H3z" />
            </svg>
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

        {/* Panel toggles */}
        <button
          className={'tabbar__toggle tabbar__toggle--icon' + (sidebarOpen ? ' tabbar__toggle--active' : '')}
          onClick={toggleSidebar}
          title="Toggle file tree"
        >
          <SidebarPanelIcon className="tabbar__toggle-icon" />
        </button>
        <div className="tabbar__inspector-switch" role="group" aria-label="Inspector view">
          <button
            className={'tabbar__inspector-btn' + (inspectorOpen && inspectorView === 'pdf' ? ' tabbar__inspector-btn--active' : '')}
            onClick={openPdfInspector}
            title="Show PDF"
          >
            <PdfPanelIcon className="tabbar__inspector-icon" />
            PDF
          </button>
          <button
            className={'tabbar__inspector-btn' + (inspectorOpen && inspectorView === 'ai' ? ' tabbar__inspector-btn--active' : '')}
            onClick={openAiInspector}
            title="Show AI"
          >
            <AiPanelIcon className="tabbar__inspector-icon" />
            AI
          </button>
        </div>
        <button
          className={'tabbar__toggle tabbar__toggle--icon' + (inspectorOpen ? ' tabbar__toggle--active' : '')}
          onClick={toggleInspector}
          title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
        >
          {inspectorOpen ? '−' : '+'}
        </button>
      </div>
    </div>
  );
};

export default TabBar;
