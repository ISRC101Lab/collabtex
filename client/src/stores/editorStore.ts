import { create } from 'zustand';
import * as api from '@/api/client';
import { useCollabStore } from '@/stores/collabStore';

interface EditorState {
  openFiles: Map<string, string>;
  activeFile: string | null;
  fileTree: string[];
  dirty: Set<string>;
  cachedPdfExists: boolean;

  fetchTree: (projectId: string) => Promise<void>;
  openFile: (projectId: string, path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  saveFile: (projectId: string, path: string, content: string) => Promise<void>;
  refreshFile: (projectId: string, path: string) => Promise<void>;
  createFile: (projectId: string, path: string) => Promise<void>;
  createFolder: (projectId: string, folderPath: string) => Promise<void>;
  deleteFile: (projectId: string, path: string) => Promise<void>;
  renameFile: (projectId: string, from: string, to: string) => Promise<void>;
  markDirty: (path: string) => void;
  markClean: (path: string) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFiles: new Map(),
  activeFile: null,
  fileTree: [],
  dirty: new Set(),
  cachedPdfExists: false,

  async fetchTree(projectId) {
    const res = await api.getProjectTree(projectId);
    set({ fileTree: res.tree, cachedPdfExists: !!res.pdfExists });
  },

  async openFile(projectId, path) {
    const { openFiles } = get();
    if (!openFiles.has(path)) {
      const res = await api.getFile(projectId, path);
      const next = new Map(openFiles);
      next.set(path, res.content);
      set({ openFiles: next, activeFile: path });
    } else {
      set({ activeFile: path });
    }
    // Connect Y.js for the active file
    useCollabStore.getState().connectToDocument(projectId, path);
  },

  closeFile(path) {
    const next = new Map(get().openFiles);
    next.delete(path);

    const nextDirty = new Set(get().dirty);
    nextDirty.delete(path);

    const activeFile =
      get().activeFile === path
        ? (next.keys().next().value ?? null)
        : get().activeFile;

    set({ openFiles: next, dirty: nextDirty, activeFile });

    // Disconnect Y.js if no more files are open
    if (next.size === 0) {
      useCollabStore.getState().disconnect();
    }
  },

  setActiveFile(path) {
    set({ activeFile: path });
  },

  async refreshFile(projectId, path) {
    const { openFiles } = get();
    // Only refresh if the file is currently open in the editor
    if (openFiles.has(path)) {
      try {
        const res = await api.getFile(projectId, path);
        const next = new Map(get().openFiles);
        next.set(path, res.content);
        const nextDirty = new Set(get().dirty);
        nextDirty.delete(path);
        set({ openFiles: next, dirty: nextDirty });
      } catch {
        // File may have been deleted — close it
        const next = new Map(get().openFiles);
        next.delete(path);
        const nextDirty = new Set(get().dirty);
        nextDirty.delete(path);
        const activeFile =
          get().activeFile === path
            ? (next.keys().next().value ?? null)
            : get().activeFile;
        set({ openFiles: next, dirty: nextDirty, activeFile });
      }
    }
  },

  async saveFile(projectId, path, content) {
    await api.putFile(projectId, path, content);

    const next = new Map(get().openFiles);
    next.set(path, content);

    const nextDirty = new Set(get().dirty);
    nextDirty.delete(path);

    set({ openFiles: next, dirty: nextDirty });
  },

  async createFile(projectId, path) {
    await api.putFile(projectId, path, '');
    await get().fetchTree(projectId);
    await get().openFile(projectId, path);
  },

  async createFolder(projectId, folderPath) {
    await api.createFolder(projectId, folderPath);
    await get().fetchTree(projectId);
  },

  async deleteFile(projectId, path) {
    await api.deleteFile(projectId, path);
    get().closeFile(path);
    await get().fetchTree(projectId);
  },

  async renameFile(projectId, from, to) {
    await api.renameFile(projectId, from, to);
    const { openFiles, activeFile } = get();
    if (openFiles.has(from)) {
      const content = openFiles.get(from)!;
      const next = new Map(openFiles);
      next.delete(from);
      next.set(to, content);
      const nextDirty = new Set(get().dirty);
      if (nextDirty.has(from)) {
        nextDirty.delete(from);
        nextDirty.add(to);
      }
      set({
        openFiles: next,
        dirty: nextDirty,
        activeFile: activeFile === from ? to : activeFile,
      });
    }
    await get().fetchTree(projectId);
  },

  markDirty(path) {
    const nextDirty = new Set(get().dirty);
    nextDirty.add(path);
    set({ dirty: nextDirty });
  },

  markClean(path) {
    const nextDirty = new Set(get().dirty);
    nextDirty.delete(path);
    set({ dirty: nextDirty });
  },
}));
