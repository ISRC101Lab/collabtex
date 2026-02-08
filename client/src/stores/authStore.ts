import { create } from 'zustand';
import * as api from '@/api/client';

interface User {
  username: string;
  isAdmin: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  async login(username, password) {
    const res = await api.login(username, password);
    if (res.token) {
      localStorage.setItem('token', res.token);
    }
    set({ user: { username: res.username, isAdmin: res.isAdmin } });
  },

  async logout() {
    await api.logout();
    localStorage.removeItem('token');
    set({ user: null });
  },

  async checkAuth() {
    set({ loading: true });
    try {
      const res = await api.getMe();
      if (res.authenticated) {
        set({ user: { username: res.username, isAdmin: res.isAdmin } });
      } else {
        set({ user: null });
      }
    } catch {
      set({ user: null });
    } finally {
      set({ loading: false });
    }
  },
}));
