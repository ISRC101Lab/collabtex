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
  const pdfPanelOpen = useUiStore((s) => s.pdfPanelOpen);
  const aiPanelOpen = useUiStore((s) => s.aiPanelOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const togglePdfPanel = useUiStore((s) => s.togglePdfPanel);
  const toggleAiPanel = useUiStore((s) => s.toggleAiPanel);

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
          className={'tabbar__toggle' + (sidebarOpen ? ' tabbar__toggle--active' : '')}
          onClick={toggleSidebar}
          title="Toggle file tree"
        >
          &#x2630;
        </button>
        <button
          className={'tabbar__toggle' + (pdfPanelOpen ? ' tabbar__toggle--active' : '')}
          onClick={togglePdfPanel}
          title="Toggle PDF"
        >
          &#x25A8;
        </button>
        <button
          className={'tabbar__toggle' + (aiPanelOpen ? ' tabbar__toggle--active' : '')}
          onClick={toggleAiPanel}
          title="Toggle AI"
        >
          &#x2606;
        </button>
      </div>
    </div>
  );
};

export default TabBar;
