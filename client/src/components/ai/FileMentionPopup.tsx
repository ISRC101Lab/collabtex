import React, { useEffect, useRef } from 'react';
import './FileMentionPopup.css';

interface FileMentionPopupProps {
  query: string;
  files: string[];
  selectedIndex: number;
  onSelect: (file: string) => void;
  onClose: () => void;
}

function getFileName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

const MAX_RESULTS = 8;

const FileMentionPopup: React.FC<FileMentionPopupProps> = ({
  query,
  files,
  selectedIndex,
  onSelect,
  onClose,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = files
    .filter((f) => f.toLowerCase().includes(query.toLowerCase()))
    .slice(0, MAX_RESULTS);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (filtered.length === 0) {
    return (
      <div className="file-mention-popup">
        <div className="file-mention-popup__empty">No matching files</div>
      </div>
    );
  }

  return (
    <div className="file-mention-popup" ref={listRef}>
      {filtered.map((file, i) => (
        <button
          key={file}
          className={`file-mention-popup__item${i === selectedIndex ? ' file-mention-popup__item--active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(file);
          }}
          type="button"
        >
          <span className="file-mention-popup__icon">&#x1F4C4;</span>
          <span className="file-mention-popup__path">{file}</span>
          <span className="file-mention-popup__name">{getFileName(file)}</span>
        </button>
      ))}
    </div>
  );
};

export default FileMentionPopup;
