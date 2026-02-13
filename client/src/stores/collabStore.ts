import { create } from 'zustand';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { useAuthStore } from '@/stores/authStore';

export interface CollabUser {
  clientId: number;
  name: string;
  color: string;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface CollabState {
  provider: HocuspocusProvider | null;
  ydoc: Y.Doc | null;
  onlineUsers: CollabUser[];
  connectionStatus: ConnectionStatus;
  connectToDocument: (projectId: string, filePath: string) => void;
  disconnect: () => void;
}

const COLORS = [
  '#e06c75', '#61afef', '#98c379', '#c678dd', '#e5c07b',
  '#56b6c2', '#be5046', '#d19a66', '#7ec8e3', '#c3e88d',
];

function usernameColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function getWsUrl(): string {
  const { hostname, protocol } = window.location;
  const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
  // In development, Hocuspocus runs on port 4093
  // In production behind a reverse proxy, use the same host
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${wsProto}//${hostname}:4093`;
  }
  return `${wsProto}//${hostname}:4093`;
}

export const useCollabStore = create<CollabState>((set, get) => ({
  provider: null,
  ydoc: null,
  onlineUsers: [],
  connectionStatus: 'disconnected',

  connectToDocument(projectId: string, filePath: string) {
    const { provider: existing } = get();
    if (existing) {
      existing.destroy();
    }

    const token = sessionStorage.getItem('token') || '';
    const ydoc = new Y.Doc();
    const documentName = `${projectId}/${filePath}`;

    const provider = new HocuspocusProvider({
      url: getWsUrl(),
      name: documentName,
      document: ydoc,
      token,
      connect: true,
      preserveConnection: false,
      onStatus({ status }: { status: string }) {
        const mapped: ConnectionStatus =
          status === 'connected' ? 'connected' :
          status === 'connecting' ? 'connecting' :
          'disconnected';
        set({ connectionStatus: mapped });
      },
      onAwarenessUpdate({ states }: { states: { clientId: number; [key: string]: any }[] }) {
        const users: CollabUser[] = [];
        for (const state of states) {
          if (state.user?.name) {
            users.push({
              clientId: state.clientId,
              name: state.user.name,
              color: state.user.color || usernameColor(state.user.name),
            });
          }
        }
        set({ onlineUsers: users });
      },
      onDisconnect() {
        set({ connectionStatus: 'disconnected' });
      },
    });

    // Set local awareness state with username and color
    const username = useAuthStore.getState().user?.username || 'Anonymous';

    provider.setAwarenessField('user', {
      name: username,
      color: usernameColor(username),
    });

    set({ provider, ydoc, connectionStatus: 'connecting' });
  },

  disconnect() {
    const { provider } = get();
    if (provider) {
      provider.destroy();
    }
    set({
      provider: null,
      ydoc: null,
      onlineUsers: [],
      connectionStatus: 'disconnected',
    });
  },
}));
