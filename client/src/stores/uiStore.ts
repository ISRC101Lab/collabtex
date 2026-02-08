import { create } from 'zustand';

type CompileStatus = 'idle' | 'compiling' | 'success' | 'error';
type Compiler = 'pdflatex' | 'xelatex' | 'lualatex' | 'latexmk';

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface PanelWidths {
  sidebar: number;
  pdf: number;
  ai: number;
}

const DEFAULT_WIDTHS: PanelWidths = { sidebar: 220, pdf: 500, ai: 360 };

function loadPanelWidths(): PanelWidths {
  try {
    const raw = localStorage.getItem('aitex-panel-widths');
    if (raw) return { ...DEFAULT_WIDTHS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_WIDTHS };
}

function savePanelWidths(w: PanelWidths) {
  try { localStorage.setItem('aitex-panel-widths', JSON.stringify(w)); } catch { /* ignore */ }
}

interface UiState {
  sidebarOpen: boolean;
  pdfPanelOpen: boolean;
  aiPanelOpen: boolean;
  compileStatus: CompileStatus;
  compiler: Compiler;
  toasts: Toast[];
  panelWidths: PanelWidths;
  collabManagerOpen: boolean;
  cursorLine: number;
  cursorCol: number;
  wordCount: number;

  toggleCollabManager: () => void;
  toggleSidebar: () => void;
  togglePdfPanel: () => void;
  toggleAiPanel: () => void;
  setCompileStatus: (status: CompileStatus) => void;
  setCompiler: (compiler: Compiler) => void;
  addToast: (message: string, type: Toast['type']) => void;
  removeToast: (id: string) => void;
  setPanelWidth: (panel: keyof PanelWidths, width: number) => void;
  setCursor: (line: number, col: number) => void;
  setWordCount: (count: number) => void;
}

let toastCounter = 0;

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  pdfPanelOpen: true,
  aiPanelOpen: false,
  collabManagerOpen: false,
  compileStatus: 'idle',
  compiler: (localStorage.getItem('aitex-compiler') as Compiler) || 'xelatex',
  toasts: [],
  panelWidths: loadPanelWidths(),
  cursorLine: 1,
  cursorCol: 1,
  wordCount: 0,

  toggleCollabManager() {
    set((s) => ({ collabManagerOpen: !s.collabManagerOpen }));
  },

  toggleSidebar() {
    set((s) => ({ sidebarOpen: !s.sidebarOpen }));
  },

  togglePdfPanel() {
    set((s) => ({ pdfPanelOpen: !s.pdfPanelOpen }));
  },

  toggleAiPanel() {
    set((s) => ({ aiPanelOpen: !s.aiPanelOpen }));
  },

  setCompileStatus(status) {
    set({ compileStatus: status });
  },

  setCompiler(compiler) {
    localStorage.setItem('aitex-compiler', compiler);
    set({ compiler });
  },

  addToast(message, type) {
    const id = `toast-${++toastCounter}`;
    set((s) => ({
      toasts: [...s.toasts, { id, message, type }],
    }));
  },

  removeToast(id) {
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    }));
  },

  setPanelWidth(panel, width) {
    set((s) => {
      const updated = { ...s.panelWidths, [panel]: width };
      savePanelWidths(updated);
      return { panelWidths: updated };
    });
  },

  setCursor(line, col) {
    set({ cursorLine: line, cursorCol: col });
  },

  setWordCount(count) {
    set({ wordCount: count });
  },
}));
