import { useState, useCallback, useRef } from 'react';
import { searchProject, type SearchResult } from '@/api/client';
import './SearchPanel.css';

interface SearchPanelProps {
  projectId: string;
  visible: boolean;
  onClose: () => void;
  onJump: (file: string, line: number) => void;
}

export default function SearchPanel({ projectId, visible, onClose, onJump }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const res = await searchProject(projectId, q.trim());
      setResults(res.results);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const handleChange = useCallback((val: string) => {
    setQuery(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 300);
  }, [doSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      clearTimeout(timerRef.current);
      doSearch(query);
    }
    if (e.key === 'Escape') onClose();
  }, [query, doSearch, onClose]);

  if (!visible) return null;

  // Group results by file
  const grouped = new Map<string, SearchResult[]>();
  for (const r of results) {
    const arr = grouped.get(r.file) || [];
    arr.push(r);
    grouped.set(r.file, arr);
  }

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <input
          ref={inputRef}
          className="search-panel__input"
          placeholder="Search in project..."
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button className="search-panel__close" onClick={onClose} title="Close">
          &#x2715;
        </button>
      </div>

      <div className="search-panel__body">
        {loading && (
          <div className="search-panel__status">Searching...</div>
        )}
        {!loading && searched && results.length === 0 && (
          <div className="search-panel__status">No results found.</div>
        )}
        {!loading && results.length > 0 && (
          <>
            <div className="search-panel__count">
              {results.length} result{results.length !== 1 ? 's' : ''} in {grouped.size} file{grouped.size !== 1 ? 's' : ''}
            </div>
            {[...grouped.entries()].map(([file, items]) => (
              <div key={file} className="search-panel__file-group">
                <div className="search-panel__file-name">{file}</div>
                {items.map((r, i) => (
                  <button
                    key={i}
                    className="search-panel__result"
                    onClick={() => onJump(r.file, r.line)}
                  >
                    <span className="search-panel__line-num">L{r.line}</span>
                    <span className="search-panel__context">{r.context}</span>
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
