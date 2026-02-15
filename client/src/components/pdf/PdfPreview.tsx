import { useState, useCallback, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer';
import { getPdfUrl, getDownloadUrl, synctexInverse } from '@/api/client';
import ChevronIcon from '@/components/common/ChevronIcon';
import { useUiStore } from '@/stores/uiStore';
import CompileLog from './CompileLog';
import './PdfPreview.css';

// Set worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PDFJS_VERSION = (pdfjsLib as { version?: string }).version || '4.10.38';
const CMAP_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/cmaps/`;
const STANDARD_FONT_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`;

type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

const COMPILERS = [
  { value: 'pdflatex', label: 'pdfLaTeX' },
  { value: 'xelatex', label: 'XeLaTeX' },
  { value: 'lualatex', label: 'LuaLaTeX' },
  { value: 'latexmk', label: 'Latexmk' },
] as const;

interface PdfPreviewProps {
  projectId: string;
  pdfExists: boolean;
  compileLog: string;
  syncTarget?: { page: number; x: number; y: number } | null;
  onJumpToLine?: (file: string | undefined, line: number) => void;
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M10 4.2V12.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6.8 9.6L10 12.8L13.2 9.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.4 15.2H14.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PdfIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M6 3.5H11.5L15 7V16.5H6V3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M11.5 3.5V7H15" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.5 12H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7.5 9.5H11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LogIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="3.5" width="12" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 7H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7 10H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M7 13H11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FitWidthIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="4" y="5" width="12" height="10" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 10H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 10H17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5 8L2.5 10L5 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 8L17.5 10L15 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PdfPreview({
  projectId,
  pdfExists,
  compileLog,
  syncTarget,
  onJumpToLine,
}: PdfPreviewProps) {
  const [cacheBuster] = useState(Date.now());
  const [logVisible, setLogVisible] = useState(false);

  // PDF state
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit-width');
  const [pageInput, setPageInput] = useState('1');
  const [loading, setLoading] = useState(false);
  const [compilerMenuOpen, setCompilerMenuOpen] = useState(false);

  const compileStatus = useUiStore((s) => s.compileStatus);
  const compiler = useUiStore((s) => s.compiler);
  const setCompiler = useUiStore((s) => s.setCompiler);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<Map<number, pdfjsLib.RenderTask>>(new Map());
  const pageViewportRef = useRef<Map<number, pdfjsLib.PageViewport>>(new Map());
  const syncMarkerRef = useRef<HTMLDivElement | null>(null);

  const toggleLog = useCallback(() => {
    setLogVisible((v) => !v);
  }, []);


  // Load PDF document
  useEffect(() => {
    if (!pdfExists) {
      pdfDocRef.current = null;
      setNumPages(0);
      setCurrentPage(1);
      return;
    }

    const url = `${getPdfUrl(projectId)}&t=${cacheBuster}`;
    setLoading(true);

    const loadingTask = pdfjsLib.getDocument({
      url,
      // Enable CMaps/standard fonts so CJK glyphs render correctly.
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_URL,
    });
    let cancelled = false;

    loadingTask.promise.then(
      (doc) => {
        if (cancelled) { doc.destroy(); return; }
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setCurrentPage((prev) => Math.min(prev, doc.numPages));
        setLoading(false);
      },
      () => {
        if (!cancelled) setLoading(false);
      },
    );

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [projectId, pdfExists, cacheBuster]);

  const handleInverseSync = useCallback(
    async (page: number, x: number, y: number) => {
      try {
        const result = await synctexInverse(projectId, { page, x, y });
        if (result?.file && result?.line) {
          onJumpToLine?.(result.file, result.line);
        }
      } catch {
        // ignore sync errors
      }
    },
    [projectId, onJumpToLine],
  );

  const placeSyncMarker = useCallback((page: number, x: number, y: number) => {
    const container = containerRef.current;
    if (!container) return;
    const pageEl = container.querySelector(`[data-page="${page}"]`) as HTMLElement | null;
    if (!pageEl) return;
    const viewport = pageViewportRef.current.get(page);
    if (!viewport) return;

    const [vx, vy] = viewport.convertToViewportPoint(x, y);
    const marker = syncMarkerRef.current ?? document.createElement('div');
    marker.className = 'pdf-preview__sync-marker';
    marker.style.left = `${vx}px`;
    marker.style.top = `${vy}px`;
    marker.style.opacity = '1';

    if (marker.parentElement !== pageEl) {
      marker.parentElement?.removeChild(marker);
      pageEl.appendChild(marker);
    }

    marker.animate([
      { transform: 'translate(-50%, -50%) scale(0.9)', opacity: 1 },
      { transform: 'translate(-50%, -50%) scale(1.15)', opacity: 0.15 },
    ], { duration: 900, easing: 'ease-out' });
  }, []);

  // Render visible pages when doc/scale changes
  useEffect(() => {
    const doc = pdfDocRef.current;
    const container = canvasContainerRef.current;
    if (!doc || !container) return;

    // Cancel previous renders
    for (const task of renderTaskRef.current.values()) {
      task.cancel();
    }
    renderTaskRef.current.clear();

    // Clear container
    container.innerHTML = '';
    pageViewportRef.current.clear();

    const renderPage = async (pageNum: number) => {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      pageViewportRef.current.set(pageNum, viewport);

      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-preview__page';
      wrapper.dataset.page = String(pageNum);
      wrapper.style.width = `${viewport.width}px`;
      wrapper.style.height = `${viewport.height}px`;

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * window.devicePixelRatio);
      canvas.height = Math.floor(viewport.height * window.devicePixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      wrapper.appendChild(canvas);
      container.appendChild(wrapper);

      wrapper.addEventListener('click', (event) => {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        const rect = wrapper.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y);
        handleInverseSync(pageNum, pdfX, pdfY);
      });

      const ctx = canvas.getContext('2d')!;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      const renderTask = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current.set(pageNum, renderTask);

      try {
        await renderTask.promise;
        const textLayerBuilder = new TextLayerBuilder({
          pdfPage: page,
          onAppend: (div) => {
            div.classList.add('pdf-preview__text-layer');
            div.style.width = `${viewport.width}px`;
            div.style.height = `${viewport.height}px`;
            wrapper.appendChild(div);
          },
        });
        await textLayerBuilder.render(viewport);
      } catch {
        // render cancelled
      }
      renderTaskRef.current.delete(pageNum);
    };

    // Render all pages
    for (let i = 1; i <= doc.numPages; i++) {
      renderPage(i);
    }
  }, [pdfDocRef.current, scale, handleInverseSync]);

  useEffect(() => {
    if (!syncTarget) return;
    const container = containerRef.current;
    if (!container) return;
    const target = container.querySelector(`[data-page="${syncTarget.page}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    placeSyncMarker(syncTarget.page, syncTarget.x, syncTarget.y);
  }, [syncTarget, placeSyncMarker, numPages]);

  const recomputeScale = useCallback(() => {
    const doc = pdfDocRef.current;
    const container = containerRef.current;
    if (!doc || !container || zoomMode === 'custom') return;

    doc.getPage(1).then((page) => {
      const unscaledViewport = page.getViewport({ scale: 1 });
      const containerWidth = Math.max(0, container.clientWidth - 24); // padding
      const containerHeight = Math.max(0, container.clientHeight - 24);

      if (zoomMode === 'fit-width') {
        setScale(containerWidth / unscaledViewport.width);
      } else if (zoomMode === 'fit-page') {
        const scaleW = containerWidth / unscaledViewport.width;
        const scaleH = containerHeight / unscaledViewport.height;
        setScale(Math.min(scaleW, scaleH));
      }
    });
  }, [zoomMode, numPages]);

  // Compute scale from zoom mode
  useEffect(() => {
    recomputeScale();
  }, [recomputeScale]);

  const handleFitWidth = useCallback(() => {
    setZoomMode('fit-width');
    recomputeScale();
  }, [recomputeScale]);

  // Track current page on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const pages = container.querySelectorAll('.pdf-preview__page');
      const scrollTop = container.scrollTop + container.clientHeight / 3;

      for (let i = pages.length - 1; i >= 0; i--) {
        const el = pages[i] as HTMLElement;
        if (el.offsetTop <= scrollTop) {
          const pageNum = Number(el.dataset.page);
          if (pageNum && pageNum !== currentPage) {
            setCurrentPage(pageNum);
            setPageInput(String(pageNum));
          }
          break;
        }
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [currentPage]);

  // Navigation
  const goToPage = useCallback((page: number) => {
    const clamped = Math.max(1, Math.min(page, numPages));
    setCurrentPage(clamped);
    setPageInput(String(clamped));

    const container = containerRef.current;
    if (!container) return;
    const target = container.querySelector(`[data-page="${clamped}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [numPages]);

  const handlePageInputSubmit = useCallback(() => {
    const num = parseInt(pageInput, 10);
    if (!isNaN(num)) goToPage(num);
    else setPageInput(String(currentPage));
  }, [pageInput, goToPage, currentPage]);

  // Zoom controls
  const zoomIn = useCallback(() => {
    setZoomMode('custom');
    setScale((s) => Math.min(s * 1.25, 5));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomMode('custom');
    setScale((s) => Math.max(s / 1.25, 0.25));
  }, []);

  const zoomPercent = Math.round(scale * 100);
  const pageDisplayTotal = numPages || 1;
  const isCompiling = compileStatus === 'compiling';

  function renderCompileIcon() {
    if (isCompiling) {
      return <span className="pdf-preview__compile-icon pdf-preview__compile-icon--spinning">&#x21BB;</span>;
    }
    if (compileStatus === 'success') {
      return <span className="pdf-preview__compile-icon pdf-preview__compile-icon--success">&#x2713;</span>;
    }
    if (compileStatus === 'error') {
      return <span className="pdf-preview__compile-icon pdf-preview__compile-icon--error">&#x2717;</span>;
    }
    return <span className="pdf-preview__compile-icon">&#x25B6;</span>;
  }

  return (
    <div className="pdf-preview">
      {/* Toolbar */}
      <div className="pdf-preview__toolbar">
        <div className="pdf-preview__toolbar-left">
          <div className="pdf-preview__compile-group">
            <button
              className="pdf-preview__compile-btn"
              onClick={() => window.dispatchEvent(new CustomEvent('aitex:compile'))}
              disabled={isCompiling}
              title="Compile (Ctrl+Shift+B)"
            >
              {renderCompileIcon()}
              {isCompiling ? 'Compiling...' : 'Compile'}
            </button>
            <button
              className="pdf-preview__compile-dropdown"
              onClick={() => setCompilerMenuOpen((v) => !v)}
              disabled={isCompiling}
              title="Select compiler"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 6l5 5 5-5H3z" />
              </svg>
            </button>
            {compilerMenuOpen && (
              <div className="pdf-preview__compiler-menu">
                {COMPILERS.map((c) => (
                  <button
                    key={c.value}
                    className={`pdf-preview__compiler-opt${compiler === c.value ? ' pdf-preview__compiler-opt--active' : ''}`}
                    onClick={() => { setCompiler(c.value as typeof compiler); setCompilerMenuOpen(false); }}
                  >
                    {compiler === c.value && <span className="pdf-preview__compiler-check">&#x2713;</span>}
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <a
            className="pdf-preview__toolbar-btn"
            href={getDownloadUrl(projectId).replace('/download', '/pdf')}
            download
            title="Download PDF"
          >
            <PdfIcon className="pdf-preview__toolbar-icon" />
          </a>
          <button
            className={'pdf-preview__toolbar-btn' + (logVisible ? ' pdf-preview__toolbar-btn--active' : '')}
            onClick={toggleLog}
            title="Toggle compile log"
          >
            <LogIcon className="pdf-preview__toolbar-icon" />
          </button>
        </div>

        <div className="pdf-preview__toolbar-spacer" />

        <div className="pdf-preview__toolbar-right">
          <button
            className="pdf-preview__toolbar-btn"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            title="Previous page"
          >
            <ChevronIcon className="pdf-preview__toolbar-icon" direction="left" />
          </button>
          <div className="pdf-preview__page-nav">
            <input
              className="pdf-preview__page-input"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={handlePageInputSubmit}
              onKeyDown={(e) => e.key === 'Enter' && handlePageInputSubmit()}
              size={3}
            />
            <span className="pdf-preview__page-total">of {pageDisplayTotal}</span>
          </div>
          <button
            className="pdf-preview__toolbar-btn"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= numPages}
            title="Next page"
          >
            <ChevronIcon className="pdf-preview__toolbar-icon" direction="right" />
          </button>

          <span className="pdf-preview__toolbar-sep" />

          <button className="pdf-preview__toolbar-btn" onClick={zoomOut} title="Zoom out">
            −
          </button>
          <span className="pdf-preview__zoom-label">{zoomPercent}%</span>
          <button className="pdf-preview__toolbar-btn" onClick={zoomIn} title="Zoom in">
            +
          </button>
          <button
            className={'pdf-preview__toolbar-btn' + (zoomMode === 'fit-width' ? ' pdf-preview__toolbar-btn--active' : '')}
            onClick={handleFitWidth}
            title="Fit width"
          >
            <FitWidthIcon className="pdf-preview__toolbar-icon" />
          </button>
        </div>
      </div>

      {/* PDF canvas area */}
      {pdfExists ? (
        <div className="pdf-preview__scroll" ref={containerRef}>
          {loading && (
            <div className="pdf-preview__loading">Loading PDF...</div>
          )}
          <div className="pdf-preview__canvas-container" ref={canvasContainerRef} />
        </div>
      ) : (
        <div className="pdf-preview__placeholder">
          <div className="pdf-preview__placeholder-icon">&#x1F4C4;</div>
          <div className="pdf-preview__placeholder-text">
            Compile your project to see the PDF preview here.
          </div>
        </div>
      )}

      <CompileLog
        log={compileLog}
        visible={logVisible}
        onClose={toggleLog}
        onJumpToLine={onJumpToLine}
      />
    </div>
  );
}
