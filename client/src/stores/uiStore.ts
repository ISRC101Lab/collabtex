import { create } from 'zustand';

type CompileStatus = 'idle' | 'compiling' | 'success' | 'error';
type Compiler = 'pdflatex' | 'xelatex' | 'lualatex' | 'latexmk';
type InspectorView = 'pdf' | 'ai';

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface PanelWidths {
  sidebar: number;
  inspector: number;
  pdf: number;
  ai: number;
}

const DEFAULT_WIDTHS: PanelWidths = {
  sidebar: 248,
  inspector: 420,
  pdf: 420,
  ai: 420,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function loadPanelWidths(): PanelWidths {
  try {
    const raw = localStorage.getItem('aitex-panel-widths');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PanelWidths>;
      const inspectorWidth = parsed.inspector ?? parsed.pdf ?? parsed.ai ?? DEFAULT_WIDTHS.inspector;
      const sidebarWidth = parsed.sidebar ?? DEFAULT_WIDTHS.sidebar;
      const pdfWidth = parsed.pdf ?? inspectorWidth;
      const aiWidth = parsed.ai ?? inspectorWidth;
      return {
        sidebar: clamp(sidebarWidth, 160, 480),
        inspector: clamp(inspectorWidth, 240, 900),
        pdf: clamp(pdfWidth, 240, 900),
        ai: clamp(aiWidth, 280, 600),
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_WIDTHS };
}

function savePanelWidths(widths: PanelWidths) {
  try {
    localStorage.setItem('aitex-panel-widths', JSON.stringify(widths));
  } catch {
    // ignore
  }
}

function loadInspectorView(): InspectorView {
  try {
    const stored = localStorage.getItem('aitex-inspector-view');
    if (stored === 'pdf' || stored === 'ai') return stored;
  } catch {
    // ignore
  }
  return 'pdf';
}

function saveInspectorView(view: InspectorView) {
  try {
    localStorage.setItem('aitex-inspector-view', view);
  } catch {
    // ignore
  }
}

interface UiState {
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  inspectorView: InspectorView;
  pdfPanelOpen: boolean;
  aiPanelOpen: boolean;
  aiBottomPanelOpen: boolean;
  aiBottomPanelHeight: number;
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
  toggleInspector: () => void;
  setInspectorOpen: (open: boolean) => void;
  setInspectorView: (view: InspectorView) => void;
  toggleAiBottomPanel: () => void;
  setAiBottomPanelHeight: (h: number) => void;
  setCompileStatus: (status: CompileStatus) => void;
  setCompiler: (compiler: Compiler) => void;
  addToast: (message: string, type: Toast['type']) => void;
  removeToast: (id: string) => void;
  setPanelWidth: (panel: keyof PanelWidths, width: number) => void;
  setCursor: (line: number, col: number) => void;
  setWordCount: (count: number) => void;
}

let toastCounter = 0;

function panelFlags(open: boolean, view: InspectorView) {
  return {
    inspectorOpen: open,
    inspectorView: view,
    pdfPanelOpen: open && view === 'pdf',
    aiPanelOpen: open && view === 'ai',
  };
}

const initialInspectorView = loadInspectorView();

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  ...panelFlags(true, initialInspectorView),
  aiBottomPanelOpen: false,
  aiBottomPanelHeight: 250,
  collabManagerOpen: false,
  compileStatus: 'idle',
  compiler: (localStorage.getItem('aitex-compiler') as Compiler) || 'xelatex',
  toasts: [],
  panelWidths: loadPanelWidths(),
  cursorLine: 1,
  cursorCol: 1,
  wordCount: 0,

  toggleCollabManager() {
    set((state) => ({ collabManagerOpen: !state.collabManagerOpen }));
  },

  toggleSidebar() {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },

  togglePdfPanel() {
    set((state) => {
      const nextView: InspectorView = 'pdf';
      const nextOpen = state.inspectorView === 'pdf' ? !state.inspectorOpen : true;
      saveInspectorView(nextView);
      return panelFlags(nextOpen, nextView);
    });
  },

  toggleAiPanel() {
    set((state) => {
      const nextView: InspectorView = 'ai';
      const nextOpen = state.inspectorView === 'ai' ? !state.inspectorOpen : true;
      saveInspectorView(nextView);
      return panelFlags(nextOpen, nextView);
    });
  },

  toggleInspector() {
    set((state) => panelFlags(!state.inspectorOpen, state.inspectorView));
  },

  setInspectorOpen(open) {
    set((state) => panelFlags(open, state.inspectorView));
  },

  setInspectorView(view) {
    saveInspectorView(view);
    set((state) => panelFlags(state.inspectorOpen, view));
  },

  toggleAiBottomPanel() {
    set((state) => ({ aiBottomPanelOpen: !state.aiBottomPanelOpen }));
  },

  setAiBottomPanelHeight(h) {
    set({ aiBottomPanelHeight: clamp(h, 120, 600) });
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
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }],
    }));
  },

  removeToast(id) {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },

  setPanelWidth(panel, width) {
    set((state) => {
      const updated: PanelWidths = { ...state.panelWidths };

      if (panel === 'inspector') {
        updated.inspector = width;
        updated.pdf = width;
        updated.ai = width;
      } else if (panel === 'pdf' || panel === 'ai') {
        updated[panel] = width;
        updated.inspector = width;
      } else {
        updated.sidebar = width;
      }

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
