import { create } from 'zustand';
import type { FileChange } from '@/api/client';

export interface PendingChange {
  id: string;
  change: FileChange;
  status: 'pending' | 'accepted' | 'rejected';
}

/** Non-blocking undo entry for write/edit/create changes */
export interface UndoEntry {
  id: string;
  change: FileChange;
  timestamp: number;
}

interface PendingChangesState {
  /** Only delete operations go here (blocking confirmation) */
  changes: PendingChange[];
  currentIndex: number;

  /** Write/edit/create go here (non-blocking, user can undo) */
  undoable: UndoEntry[];

  addChanges: (fileChanges: FileChange[]) => void;
  acceptChange: (id: string) => void;
  rejectChange: (id: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  navigateNext: () => void;
  navigatePrev: () => void;

  /** Undo a non-blocking change (revert file) */
  undoChange: (id: string) => void;
  /** Dismiss an undo entry (user accepts it) */
  dismissUndo: (id: string) => void;
  /** Dismiss all undo entries */
  dismissAllUndo: () => void;
}

let counter = 0;

export const usePendingChangesStore = create<PendingChangesState>((set, get) => ({
  changes: [],
  currentIndex: 0,
  undoable: [],

  addChanges(fileChanges) {
    const deletes = fileChanges.filter((fc) => fc.action === 'delete');
    const nonDeletes = fileChanges.filter((fc) => fc.action !== 'delete');

    const newPending: PendingChange[] = deletes.map((fc) => ({
      id: `pc-${Date.now()}-${counter++}`,
      change: fc,
      status: 'pending' as const,
    }));

    const newUndo: UndoEntry[] = nonDeletes.map((fc) => ({
      id: `undo-${Date.now()}-${counter++}`,
      change: fc,
      timestamp: Date.now(),
    }));

    set((s) => ({
      changes: newPending.length > 0 ? [...s.changes, ...newPending] : s.changes,
      currentIndex: newPending.length > 0 ? 0 : s.currentIndex,
      undoable: newUndo.length > 0 ? [...s.undoable, ...newUndo] : s.undoable,
    }));
  },

  acceptChange(id) {
    set((s) => {
      const next = s.changes.filter((c) => c.id !== id);
      const maxIdx = next.filter((c) => c.status === 'pending').length - 1;
      return {
        changes: next,
        currentIndex: Math.min(s.currentIndex, Math.max(0, maxIdx)),
      };
    });
  },

  rejectChange(id) {
    const item = get().changes.find((c) => c.id === id);
    if (item) {
      window.dispatchEvent(
        new CustomEvent('aitex:revert-file', {
          detail: { path: item.change.path, content: item.change.oldContent },
        }),
      );
    }
    set((s) => {
      const next = s.changes.filter((c) => c.id !== id);
      const maxIdx = next.filter((c) => c.status === 'pending').length - 1;
      return {
        changes: next,
        currentIndex: Math.min(s.currentIndex, Math.max(0, maxIdx)),
      };
    });
  },

  acceptAll() {
    set({ changes: [], currentIndex: 0 });
  },

  rejectAll() {
    const pending = get().changes.filter((c) => c.status === 'pending');
    for (const item of pending) {
      window.dispatchEvent(
        new CustomEvent('aitex:revert-file', {
          detail: { path: item.change.path, content: item.change.oldContent },
        }),
      );
    }
    set({ changes: [], currentIndex: 0 });
  },

  navigateNext() {
    set((s) => {
      const max = s.changes.filter((c) => c.status === 'pending').length - 1;
      return { currentIndex: Math.min(s.currentIndex + 1, max) };
    });
  },

  navigatePrev() {
    set((s) => ({
      currentIndex: Math.max(s.currentIndex - 1, 0),
    }));
  },

  undoChange(id) {
    const item = get().undoable.find((u) => u.id === id);
    if (item && item.change.oldContent !== null) {
      window.dispatchEvent(
        new CustomEvent('aitex:revert-file', {
          detail: { path: item.change.path, content: item.change.oldContent },
        }),
      );
    }
    set((s) => ({ undoable: s.undoable.filter((u) => u.id !== id) }));
  },

  dismissUndo(id) {
    set((s) => ({ undoable: s.undoable.filter((u) => u.id !== id) }));
  },

  dismissAllUndo() {
    set({ undoable: [] });
  },
}));
