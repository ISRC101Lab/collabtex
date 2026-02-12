import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { getPdfUrl } from '@/api/client';
import './ProjectThumbnail.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const PDFJS_VERSION = (pdfjsLib as { version?: string }).version || '4.10.38';
const CMAP_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/cmaps/`;
const STANDARD_FONT_URL = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`;

type ThumbnailVariant = 'list' | 'card';

interface ProjectThumbnailProps {
  projectId: string;
  updatedAt?: string;
  variant?: ThumbnailVariant;
  className?: string;
}

const SIZE_BY_VARIANT: Record<ThumbnailVariant, { width: number; height: number }> = {
  list: { width: 22, height: 30 },
  card: { width: 62, height: 84 },
};

const CARD_OBSERVER_MARGIN = '160px';

export default function ProjectThumbnail({
  projectId,
  updatedAt,
  variant = 'list',
  className,
}: ProjectThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paperRef = useRef<HTMLSpanElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shouldRenderCardPreview, setShouldRenderCardPreview] = useState(variant !== 'card');

  const size = SIZE_BY_VARIANT[variant];
  const cacheBuster = useMemo(() => encodeURIComponent(updatedAt || ''), [updatedAt]);

  useEffect(() => {
    if (variant !== 'card') {
      setShouldRenderCardPreview(false);
      return;
    }

    setShouldRenderCardPreview(false);
    const element = paperRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldRenderCardPreview(true);
          observer.disconnect();
        }
      },
      { rootMargin: CARD_OBSERVER_MARGIN },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [variant, projectId, cacheBuster]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (variant !== 'card' || !shouldRenderCardPreview || !canvas) {
      setReady(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    setReady(false);
    setFailed(false);

    const baseUrl = getPdfUrl(projectId);
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}thumb=1&t=${cacheBuster || Date.now()}`;
    const loadingTask = pdfjsLib.getDocument({
      url,
      // Keep thumbnails consistent with preview for CJK glyphs.
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: STANDARD_FONT_URL,
    });

    (async () => {
      try {
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const page = await pdf.getPage(1);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(size.width / viewport.width, size.height / viewport.height);
        const renderViewport = page.getViewport({
          scale: Number.isFinite(scale) && scale > 0 ? scale : 0.1,
        });

        const context = canvas.getContext('2d');
        if (!context) throw new Error('canvas context unavailable');

        const ratio = window.devicePixelRatio || 1;
        const cssWidth = Math.max(1, Math.floor(renderViewport.width));
        const cssHeight = Math.max(1, Math.floor(renderViewport.height));

        canvas.width = Math.max(1, Math.floor(cssWidth * ratio));
        canvas.height = Math.max(1, Math.floor(cssHeight * ratio));
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, cssWidth, cssHeight);

        renderTask = page.render({ canvasContext: context, viewport: renderViewport });
        await renderTask.promise;

        if (cancelled) return;
        setReady(true);
      } catch {
        if (cancelled) return;
        setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore cancel errors
      }
      try {
        loadingTask.destroy();
      } catch {
        // ignore destroy errors
      }
    };
  }, [projectId, cacheBuster, variant, shouldRenderCardPreview, size.width, size.height]);

  const classes = ['project-thumbnail', `project-thumbnail--${variant}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} aria-hidden>
      <span className="project-thumbnail__paper" ref={paperRef}>
        {!ready && (
          <>
            <span className="project-thumbnail__line project-thumbnail__line--1" />
            <span className="project-thumbnail__line project-thumbnail__line--2" />
            <span className="project-thumbnail__line project-thumbnail__line--3" />
            <span className="project-thumbnail__line project-thumbnail__line--4" />
            <span className="project-thumbnail__line project-thumbnail__line--5" />
          </>
        )}
        {variant === 'card' && (
          <canvas
            ref={canvasRef}
            className={`project-thumbnail__canvas${ready ? ' project-thumbnail__canvas--visible' : ''}`}
          />
        )}
        {variant === 'card' && failed && <span className="project-thumbnail__fallback-mark">⋯</span>}
      </span>
    </span>
  );
}
