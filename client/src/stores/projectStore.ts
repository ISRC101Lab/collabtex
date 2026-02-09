import { create } from 'zustand';
import * as api from '@/api/client';
import type { Project } from '@/api/client';

interface ProjectQuery {
  q?: string;
  scope?: 'all' | 'owned' | 'shared';
  sort?: 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';
}

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  loading: boolean;
  fetchProjects: () => Promise<void>;
  fetchProjectsWithQuery: (query?: ProjectQuery) => Promise<void>;
  prefetchProjectsWithQuery: (query?: ProjectQuery) => Promise<void>;
  createProject: (name: string) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  selectProject: (id: string) => void;
  updateMeta: (
    id: string,
    data: { name?: string; compiler?: string; mainFile?: string },
  ) => Promise<void>;
}

interface ListCacheEntry {
  projects: Project[];
  fetchedAt: number;
}

const LIST_CACHE_TTL_MS = 45_000;
const listCache = new Map<string, ListCacheEntry>();
const listInFlight = new Map<string, Promise<Project[]>>();
let latestListRequestId = 0;

function safeSessionKey(): string {
  try {
    return localStorage.getItem('token') ?? 'anon';
  } catch {
    return 'anon';
  }
}

function queryCacheKey(query?: ProjectQuery): string {
  const normalized: ProjectQuery = {
    q: query?.q?.trim() || undefined,
    scope: query?.scope,
    sort: query?.sort,
  };
  return JSON.stringify({
    session: safeSessionKey(),
    q: normalized.q ?? '',
    scope: normalized.scope ?? '',
    sort: normalized.sort ?? '',
  });
}

function getCachedProjects(query?: ProjectQuery): Project[] | null {
  const key = queryCacheKey(query);
  const entry = listCache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.fetchedAt > LIST_CACHE_TTL_MS) {
    listCache.delete(key);
    return null;
  }

  return entry.projects;
}

function putCachedProjects(query: ProjectQuery | undefined, projects: Project[]) {
  const key = queryCacheKey(query);
  listCache.set(key, {
    projects,
    fetchedAt: Date.now(),
  });
}

function readQueryCache(query?: ProjectQuery): { key: string; cached: Project[] | null } {
  const key = queryCacheKey(query);
  const entry = listCache.get(key);
  if (!entry) return { key, cached: null };

  if (Date.now() - entry.fetchedAt > LIST_CACHE_TTL_MS) {
    listCache.delete(key);
    return { key, cached: null };
  }

  return { key, cached: entry.projects };
}

function fetchQueryToCache(query?: ProjectQuery): Promise<Project[]> {
  const { key, cached } = readQueryCache(query);
  if (cached) return Promise.resolve(cached);

  const inFlight = listInFlight.get(key);
  if (inFlight) return inFlight;

  const nextRequest = api
    .getProjectsWithQuery(query || {})
    .then((res) => {
      putCachedProjects(query, res.projects);
      return res.projects;
    })
    .finally(() => {
      const current = listInFlight.get(key);
      if (current === nextRequest) {
        listInFlight.delete(key);
      }
    });

  listInFlight.set(key, nextRequest);
  return nextRequest;
}

function clearListCache() {
  listCache.clear();
  listInFlight.clear();
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  loading: false,

  async fetchProjects() {
    const requestId = ++latestListRequestId;
    set({ loading: true });

    try {
      const res = await api.getProjects();
      clearListCache();
      if (requestId !== latestListRequestId) return;
      set({ projects: res.projects });
    } finally {
      if (requestId === latestListRequestId) {
        set({ loading: false });
      }
    }
  },

  async fetchProjectsWithQuery(query) {
    const requestId = ++latestListRequestId;

    const cached = getCachedProjects(query);
    if (cached) {
      if (requestId !== latestListRequestId) return;
      set({ projects: cached, loading: false });
      return;
    }

    set({ loading: true });

    try {
      const projects = await fetchQueryToCache(query);

      if (requestId !== latestListRequestId) return;
      set({ projects });
    } finally {
      if (requestId === latestListRequestId) {
        set({ loading: false });
      }
    }
  },

  async prefetchProjectsWithQuery(query) {
    if (getCachedProjects(query)) return;
    try {
      await fetchQueryToCache(query);
    } catch {
      // silent prefetch failure should not impact active UI
    }
  },

  async createProject(name) {
    const res = await api.createProject(name);
    clearListCache();
    set((s) => ({ projects: [...s.projects, res.project] }));
    return res.project;
  },

  async deleteProject(id) {
    await api.deleteProject(id);
    clearListCache();
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
    clearListCache();
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? res.project : p)),
      currentProject: s.currentProject?.id === id ? res.project : s.currentProject,
    }));
  },
}));

export type { Project };
