import React, { useCallback, useRef, useEffect } from 'react';

interface ResizeHandleProps {
  /** Called continuously while dragging with the delta-x in pixels */
  onResize: (deltaX: number) => void;
  /** Called once when drag ends */
  onResizeEnd?: () => void;
  className?: string;
}

const ResizeHandle: React.FC<ResizeHandleProps> = ({
  onResize,
  onResizeEnd,
  className = '',
}) => {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onResizeRef = useRef(onResize);
  const onResizeEndRef = useRef(onResizeEnd);

  useEffect(() => {
    onResizeRef.current = onResize;
    onResizeEndRef.current = onResizeEnd;
  }, [onResize, onResizeEnd]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onResizeRef.current(dx);
    };

    const handleMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onResizeEndRef.current?.();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div
      className={`resize-handle ${className}`}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
    />
  );
};

export default ResizeHandle;
