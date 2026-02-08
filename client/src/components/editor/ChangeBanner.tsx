import React from 'react';
import { usePendingChangesStore } from '@/stores/pendingChangesStore';
import './ChangeBanner.css';

const ChangeBanner: React.FC = () => {
  const changes = usePendingChangesStore((s) => s.changes);
  const currentIndex = usePendingChangesStore((s) => s.currentIndex);
  const acceptChange = usePendingChangesStore((s) => s.acceptChange);
  const rejectChange = usePendingChangesStore((s) => s.rejectChange);
  const acceptAll = usePendingChangesStore((s) => s.acceptAll);
  const rejectAll = usePendingChangesStore((s) => s.rejectAll);
  const navigateNext = usePendingChangesStore((s) => s.navigateNext);
  const navigatePrev = usePendingChangesStore((s) => s.navigatePrev);

  const pending = changes.filter((c) => c.status === 'pending');
  if (pending.length === 0) return null;

  const safeIndex = Math.min(currentIndex, pending.length - 1);
  const current = pending[safeIndex];
  const total = pending.length;

  return (
    <div className="change-banner">
      <div className="change-banner__info">
        <span className="change-banner__icon">AI</span>
        <span className="change-banner__label">wants to delete</span>
        <span className="change-banner__path">{current.change.path}</span>
      </div>

      <div className="change-banner__right">
        {total > 1 && (
          <div className="change-banner__nav">
            <button
              className="change-banner__nav-btn"
              onClick={navigatePrev}
              disabled={safeIndex <= 0}
              type="button"
              aria-label="Previous change"
            >&#x2190;</button>
            <span className="change-banner__counter">{safeIndex + 1} / {total}</span>
            <button
              className="change-banner__nav-btn"
              onClick={navigateNext}
              disabled={safeIndex >= total - 1}
              type="button"
              aria-label="Next change"
            >&#x2192;</button>
          </div>
        )}

        <div className="change-banner__actions">
          <button
            className="change-banner__btn change-banner__btn--accept"
            onClick={() => acceptChange(current.id)}
            type="button"
          >&#x2713; Accept</button>
          <button
            className="change-banner__btn change-banner__btn--reject"
            onClick={() => rejectChange(current.id)}
            type="button"
          >&#x2717; Reject</button>
          {total > 1 && (
            <>
              <button
                className="change-banner__btn change-banner__btn--accept-all"
                onClick={acceptAll}
                type="button"
              >Accept All ({total})</button>
              <button
                className="change-banner__btn change-banner__btn--reject-all"
                onClick={rejectAll}
                type="button"
              >Reject All</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChangeBanner;
