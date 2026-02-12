import React, { useCallback, useRef, useEffect } from 'react';

interface ResizeHandleProps {
  /** Called continuously while dragging with the delta-x in pixels */
  onResize: (delta: number) => void;
  /** Called once when drag ends */
  onResizeEnd?: () => void;
  className?: string;
  axis?: 'x' | 'y';
}

const ResizeHandle: React.FC<ResizeHandleProps> = ({
  onResize,
  onResizeEnd,
  className = '',
  axis = 'x',
}) => {
  const dragging = useRef(false);
  const lastPos = useRef(0);
  const onResizeRef = useRef(onResize);
  const onResizeEndRef = useRef(onResizeEnd);

  useEffect(() => {
    onResizeRef.current = onResize;
    onResizeEndRef.current = onResizeEnd;
  }, [onResize, onResizeEnd]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastPos.current = axis === 'y' ? e.clientY : e.clientX;
    document.body.style.cursor = axis === 'y' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  }, [axis]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const current = axis === 'y' ? e.clientY : e.clientX;
      const delta = current - lastPos.current;
      lastPos.current = current;
      onResizeRef.current(delta);
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
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
    />
  );
};

export default ResizeHandle;
