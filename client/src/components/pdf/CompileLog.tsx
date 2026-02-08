import { useState, useMemo } from 'react';
import { parseLatexLog, type LogLevel, type LogEntry } from '@/lib/parse-latex-log';
import './CompileLog.css';

interface CompileLogProps {
  log: string;
  visible: boolean;
  onClose: () => void;
  onJumpToLine?: (file: string | undefined, line: number) => void;
}

const LEVEL_ICON: Record<LogLevel, string> = {
  error: '\u2716',
  warning: '\u26A0',
  info: '\u2139',
};

function FilterBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`compile-log__filter-btn${active ? ' compile-log__filter-btn--active' : ''}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function LogEntryRow({
  entry,
  onJump,
}: {
  entry: LogEntry;
  onJump?: (file: string | undefined, line: number) => void;
}) {
  const clickable = !!entry.line;
  return (
    <div
      className={`compile-log__entry compile-log__entry--${entry.level}`}
      onClick={() => clickable && onJump?.(entry.file, entry.line!)}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <span className="compile-log__entry-icon">{LEVEL_ICON[entry.level]}</span>
      <span className="compile-log__entry-msg">{entry.message}</span>
      {entry.line && (
        <span className="compile-log__entry-loc">
          {entry.file ? `${entry.file}:` : 'l.'}
          {entry.line}
        </span>
      )}
    </div>
  );
}

export default function CompileLog({ log, visible, onClose, onJumpToLine }: CompileLogProps) {
  const [filter, setFilter] = useState<LogLevel | 'all'>('all');
  const [showRaw, setShowRaw] = useState(false);

  const entries = useMemo(() => parseLatexLog(log), [log]);

  const errorCount = entries.filter((e) => e.level === 'error').length;
  const warnCount = entries.filter((e) => e.level === 'warning').length;

  const filtered = filter === 'all'
    ? entries
    : entries.filter((e) => e.level === filter);

  if (!visible) return null;

  return (
    <div className="compile-log">
      <div className="compile-log__header">
        <span className="compile-log__title">
          Compile Output
          {errorCount > 0 && (
            <span className="compile-log__badge compile-log__badge--error">{errorCount}</span>
          )}
          {warnCount > 0 && (
            <span className="compile-log__badge compile-log__badge--warning">{warnCount}</span>
          )}
        </span>
        <div className="compile-log__header-right">
          <FilterBtn label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterBtn label="Errors" active={filter === 'error'} onClick={() => setFilter('error')} />
          <FilterBtn label="Warnings" active={filter === 'warning'} onClick={() => setFilter('warning')} />
          <button className="compile-log__close-btn" onClick={onClose} title="Close log">
            &#x2715;
          </button>
        </div>
      </div>
      <div className="compile-log__body">
        {!log ? (
          <span className="compile-log__empty">No compile output yet.</span>
        ) : entries.length === 0 || showRaw ? (
          <pre className="compile-log__output">{log}</pre>
        ) : (
          <>
            <div className="compile-log__entries">
              {filtered.map((entry, i) => (
                <LogEntryRow key={i} entry={entry} onJump={onJumpToLine} />
              ))}
              {filtered.length === 0 && (
                <span className="compile-log__empty">No {filter} messages.</span>
              )}
            </div>
            <button
              className="compile-log__raw-toggle"
              onClick={() => setShowRaw(true)}
              type="button"
            >
              Show raw log
            </button>
          </>
        )}
        {showRaw && entries.length > 0 && (
          <button
            className="compile-log__raw-toggle"
            onClick={() => setShowRaw(false)}
            type="button"
          >
            Show structured view
          </button>
        )}
      </div>
    </div>
  );
}
