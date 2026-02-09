import { useState, useCallback, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { getPdfUrl, getDownloadUrl } from '@/api/client';
import ChevronIcon from '@/components/common/ChevronIcon';
import CompileLog from './CompileLog';
import './PdfPreview.css';

// Set worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

interface PdfPreviewProps {
  projectId: string;
  pdfExists: boolean;
  compileLog: string;
  onRefresh: () => void;
  onJumpToLine?: (file: string | undefined, line: number) => void;
}


function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M16 10A6 6 0 1 1 10 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10 2.8V5.1H12.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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

export default function PdfPreview({
  projectId,
  pdfExists,
  compileLog,
  onRefresh,
  onJumpToLine,
}: PdfPreviewProps) {
  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const [logVisible, setLogVisible] = useState(false);

  // PDF state
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit-width');
  const [pageInput, setPageInput] = useState('1');
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<Map<number, pdfjsLib.RenderTask>>(new Map());

  const handleRefresh = useCallback(() => {
    setCacheBuster(Date.now());
    onRefresh();
  }, [onRefresh]);

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

    const loadingTask = pdfjsLib.getDocument(url);
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

    const renderPage = async (pageNum: number) => {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-preview__page';
      wrapper.dataset.page = String(pageNum);

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * window.devicePixelRatio);
      canvas.height = Math.floor(viewport.height * window.devicePixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      wrapper.appendChild(canvas);
      container.appendChild(wrapper);

      const ctx = canvas.getContext('2d')!;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      const renderTask = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current.set(pageNum, renderTask);

      try {
        await renderTask.promise;
      } catch {
        // render cancelled
      }
      renderTaskRef.current.delete(pageNum);
    };

    // Render all pages
    for (let i = 1; i <= doc.numPages; i++) {
      renderPage(i);
    }
  }, [pdfDocRef.current, scale]);

  // Compute scale from zoom mode
  useEffect(() => {
    const doc = pdfDocRef.current;
    const container = containerRef.current;
    if (!doc || !container || zoomMode === 'custom') return;

    doc.getPage(1).then((page) => {
      const unscaledViewport = page.getViewport({ scale: 1 });
      const containerWidth = container.clientWidth - 24; // padding
      const containerHeight = container.clientHeight - 24;

      if (zoomMode === 'fit-width') {
        setScale(containerWidth / unscaledViewport.width);
      } else if (zoomMode === 'fit-page') {
        const scaleW = containerWidth / unscaledViewport.width;
        const scaleH = containerHeight / unscaledViewport.height;
        setScale(Math.min(scaleW, scaleH));
      }
    });
  }, [pdfDocRef.current, zoomMode, numPages]);

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

  return (
    <div className="pdf-preview">
      {/* Toolbar */}
      <div className="pdf-preview__toolbar">
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
          onClick={() => setZoomMode('fit-width')}
          title="Fit width"
        >
          Fit Width
        </button>
        <button
          className={'pdf-preview__toolbar-btn' + (zoomMode === 'fit-page' ? ' pdf-preview__toolbar-btn--active' : '')}
          onClick={() => setZoomMode('fit-page')}
          title="Fit page"
        >
          Fit Page
        </button>

        <div className="pdf-preview__toolbar-spacer" />

        <button className="pdf-preview__toolbar-btn" onClick={handleRefresh} title="Refresh PDF">
          <RefreshIcon className="pdf-preview__toolbar-icon" />
        </button>
        <a
          className="pdf-preview__toolbar-btn"
          href={getDownloadUrl(projectId).replace('/download', '/pdf')}
          download
          title="Download PDF"
        >
          <DownloadIcon className="pdf-preview__toolbar-icon" />
        </a>
        <button
          className={'pdf-preview__toolbar-btn' + (logVisible ? ' pdf-preview__toolbar-btn--active' : '')}
          onClick={toggleLog}
          title="Toggle compile log"
        >
          {logVisible ? 'Hide Log' : 'Show Log'}
        </button>
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
