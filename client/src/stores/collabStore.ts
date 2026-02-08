import { create } from 'zustand';

export interface CollabUser {
  clientId: number;
  name: string;
  color: string;
}

interface CollabState {
  onlineUsers: CollabUser[];
  setOnlineUsers: (users: CollabUser[]) => void;
}

export const useCollabStore = create<CollabState>((set) => ({
  onlineUsers: [],
  setOnlineUsers(users) {
    set({ onlineUsers: users });
  },
}));
