import React, { useEffect } from 'react';
import { usePendingChangesStore } from '@/stores/pendingChangesStore';
import './UndoBar.css';

const AUTO_DISMISS_MS = 15_000;

const UndoBar: React.FC = () => {
  const undoable = usePendingChangesStore((s) => s.undoable);
  const undoChange = usePendingChangesStore((s) => s.undoChange);
  const dismissUndo = usePendingChangesStore((s) => s.dismissUndo);
  const dismissAllUndo = usePendingChangesStore((s) => s.dismissAllUndo);

  // Auto-dismiss after 15s
  useEffect(() => {
    if (undoable.length === 0) return;
    const oldest = undoable[0];
    const age = Date.now() - oldest.timestamp;
    const delay = Math.max(AUTO_DISMISS_MS - age, 500);
    const timer = setTimeout(() => dismissUndo(oldest.id), delay);
    return () => clearTimeout(timer);
  }, [undoable, dismissUndo]);

  if (undoable.length === 0) return null;

  return (
    <div className="undo-bar">
      <span className="undo-bar__text">
        AI modified {undoable.length} file{undoable.length > 1 ? 's' : ''}
      </span>
      <div className="undo-bar__actions">
        {undoable.length === 1 ? (
          <button
            className="undo-bar__btn undo-bar__btn--undo"
            onClick={() => undoChange(undoable[0].id)}
            type="button"
          >
            Undo {undoable[0].change.path}
          </button>
        ) : (
          <>
            <button
              className="undo-bar__btn undo-bar__btn--undo"
              onClick={() => undoChange(undoable[0].id)}
              type="button"
            >
              Undo {undoable[0].change.path}
            </button>
            <button
              className="undo-bar__btn undo-bar__btn--undo-all"
              onClick={() => {
                for (const u of [...undoable]) undoChange(u.id);
              }}
              type="button"
            >
              Undo All ({undoable.length})
            </button>
          </>
        )}
        <button
          className="undo-bar__btn undo-bar__btn--dismiss"
          onClick={dismissAllUndo}
          type="button"
          title="Dismiss"
        >
          &#x2715;
        </button>
      </div>
    </div>
  );
};

export default UndoBar;
