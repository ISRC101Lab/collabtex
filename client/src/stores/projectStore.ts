import { create } from 'zustand';
import * as api from '@/api/client';
import type { Project } from '@/api/client';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  loading: boolean;
  fetchProjects: () => Promise<void>;
  createProject: (name: string) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  selectProject: (id: string) => void;
  updateMeta: (
    id: string,
    data: { name?: string; compiler?: string; mainFile?: string },
  ) => Promise<void>;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  loading: false,

  async fetchProjects() {
    set({ loading: true });
    try {
      const res = await api.getProjects();
      set({ projects: res.projects });
    } finally {
      set({ loading: false });
    }
  },

  async createProject(name) {
    const res = await api.createProject(name);
    set((s) => ({ projects: [...s.projects, res.project] }));
    return res.project;
  },

  async deleteProject(id) {
    await api.deleteProject(id);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      currentProject: s.currentProject?.id === id ? null : s.currentProject,
    }));
  },

  selectProject(id) {
    const project = get().projects.find((p) => p.id === id) ?? null;
    set({ currentProject: project });
  },

  async updateMeta(id, data) {
    const res = await api.updateProjectMeta(id, data);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? res.project : p)),
      currentProject: s.currentProject?.id === id ? res.project : s.currentProject,
    }));
  },
}));

export type { Project };
