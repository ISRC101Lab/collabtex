import { create } from 'zustand';
import type { ChatMessage } from '@/components/ai/AiMessage';
import { useAuthStore } from '@/stores/authStore';

export interface ConvoMeta {
  id: string;
  title: string;
  updatedAt: number;
}

function getUsername(): string {
  return useAuthStore.getState().user?.username || 'anon';
}

const CONVOS_KEY = (pid: string) => `aitex-convos-${getUsername()}-${pid}`;
const CONV_KEY = (pid: string, cid: string) => `aitex-conv-${getUsername()}-${pid}-${cid}`;
const MAX_PERSISTED = 50;

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadList(projectId: string): ConvoMeta[] {
  try {
    const raw = localStorage.getItem(CONVOS_KEY(projectId));
    return raw ? (JSON.parse(raw) as ConvoMeta[]) : [];
  } catch { return []; }
}

function saveList(projectId: string, list: ConvoMeta[]) {
  try {
    localStorage.setItem(CONVOS_KEY(projectId), JSON.stringify(list));
  } catch { /* ignore */ }
}

export function loadConvoMessages(projectId: string, convoId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CONV_KEY(projectId, convoId));
    if (!raw) return [];
    const all = (JSON.parse(raw) as ChatMessage[]).map((m) => ({ ...m, streaming: false }));
    // Load only the tail for faster perceived restore on long conversations
    if (all.length > MAX_PERSISTED) {
      return all.slice(-MAX_PERSISTED);
    }
    return all;
  } catch { return []; }
}

export function saveConvoMessages(projectId: string, convoId: string, msgs: ChatMessage[]) {
  try {
    const toSave = msgs
      .filter((m) => !m.streaming)
      .slice(-MAX_PERSISTED)
      .map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        thinking: m.thinking,
        toolCalls: m.toolCalls,
        fileChanges: m.fileChanges?.map((fc) => ({
          action: fc.action,
          path: fc.path,
          oldContent: null,
          newContent: null,
        })),
      }));
    localStorage.setItem(CONV_KEY(projectId, convoId), JSON.stringify(toSave));
  } catch { /* quota exceeded */ }
}

interface ConversationState {
  projectId: string;
  convoList: ConvoMeta[];
  activeConvoId: string;

  // AI provider state (shared across all AI panels)
  aiConfigured: boolean | null;
  aiProvider: string;
  models: string[];
  selectedModel: string;

  initProject: (projectId: string) => void;
  newConvo: () => void;
  switchConvo: (convoId: string) => void;
  deleteConvo: (convoId: string) => void;
  updateConvoMeta: (convoId: string, title: string) => void;
  setAiConfig: (configured: boolean, provider: string, models: string[]) => void;
  setSelectedModel: (model: string) => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  projectId: '',
  convoList: [],
  activeConvoId: genId(),
  aiConfigured: null,
  aiProvider: '',
  models: [],
  selectedModel: '',

  initProject(projectId) {
    if (get().projectId === projectId) return;
    const list = loadList(projectId);
    // Always start a fresh conversation — user can restore old ones from the list
    set({ projectId, convoList: list, activeConvoId: genId() });
  },

  newConvo() {
    set({ activeConvoId: genId() });
  },

  switchConvo(convoId) {
    set({ activeConvoId: convoId });
  },

  deleteConvo(convoId) {
    const { projectId, activeConvoId, convoList } = get();
    localStorage.removeItem(CONV_KEY(projectId, convoId));
    const updated = convoList.filter((c) => c.id !== convoId);
    saveList(projectId, updated);
    if (convoId === activeConvoId) {
      set({ convoList: updated, activeConvoId: genId() });
    } else {
      set({ convoList: updated });
    }
  },

  updateConvoMeta(convoId, title) {
    const { projectId, convoList } = get();
    const exists = convoList.find((c) => c.id === convoId);
    let updated: ConvoMeta[];
    if (exists) {
      updated = convoList.map((c) =>
        c.id === convoId ? { ...c, title, updatedAt: Date.now() } : c,
      );
    } else {
      updated = [{ id: convoId, title, updatedAt: Date.now() }, ...convoList];
    }
    saveList(projectId, updated);
    set({ convoList: updated });
  },

  setAiConfig(configured, provider, models) {
    set({ aiConfigured: configured, aiProvider: provider, models, selectedModel: provider });
  },

  setSelectedModel(model) {
    set({ selectedModel: model });
  },
}));
