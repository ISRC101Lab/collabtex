const BASE = '/api';

interface ApiError extends Error {
  status: number;
  body?: unknown;
}

function createApiError(message: string, status: number, body?: unknown): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  err.body = body;
  return err;
}

function getToken(): string | null {
  return sessionStorage.getItem('token');
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      // response wasn't JSON
    }
    throw createApiError(
      `API ${method} ${path} failed (${res.status})`,
      res.status,
      parsed,
    );
  }

  // Handle empty responses (204, etc.)
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// ── Auth ────────────────────────────────────────────────────────────

export function login(username: string, password: string) {
  return request<{ ok: boolean; username: string; isAdmin: boolean; token: string }>(
    'POST', '/login', { username, password },
  );
}

export function logout() {
  return request<{ ok: boolean }>('POST', '/logout');
}

export function getMe() {
  return request<{ authenticated: boolean; username: string; isAdmin: boolean; token?: string }>(
    'GET', '/me',
  );
}

export function ping() {
  return request<{ ok: boolean; time: string }>('GET', '/ping');
}

// ── Projects ────────────────────────────────────────────────────────

export function getProjects() {
  return request<{ projects: Project[]; prefs?: ProjectListPreferences }>('GET', '/projects');
}

export type ProjectListScope = 'all' | 'owned' | 'shared';
export type ProjectListSort = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';
export type ProjectListView = 'list' | 'card';

export interface ProjectListPreferences {
  scope: ProjectListScope;
  sort: ProjectListSort;
  view: ProjectListView;
}

export function getProjectsWithQuery(query: {
  q?: string;
  scope?: ProjectListScope;
  sort?: ProjectListSort;
}) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.scope) params.set('scope', query.scope);
  if (query.sort) params.set('sort', query.sort);
  const qs = params.toString();
  return request<{ projects: Project[]; prefs?: ProjectListPreferences }>(
    'GET', `/projects${qs ? `?${qs}` : ''}`,
  );
}

export function getProjectListPreferences() {
  return request<{ prefs: ProjectListPreferences }>('GET', '/projects/preferences');
}

export function setProjectListPreferences(
  updates: Partial<ProjectListPreferences>,
) {
  return request<{ ok: boolean; prefs: ProjectListPreferences }>(
    'POST', '/projects/preferences', updates,
  );
}

export function importProject(params: {
  name?: string;
  sourceType: 'zip' | 'snapshot';
  fileName?: string;
  contentBase64: string;
}) {
  return request<{ ok: boolean; project: Project; importedCount: number }>(
    'POST', '/projects/import', params,
  );
}

export function createProject(name: string, mainFile = 'main.tex') {
  return request<{ project: Project }>(
    'POST', '/projects', { name, mainFile },
  );
}

export function getProjectTree(id: string) {
  return request<{ tree: string[]; mainFile: string; compiler: string; pdfExists?: boolean }>(
    'GET', `/projects/${id}/tree`,
  );
}

export function deleteProject(id: string) {
  return request<{ ok: boolean }>('DELETE', `/projects/${id}`);
}

export function updateProjectMeta(
  id: string,
  data: { name?: string; compiler?: string; mainFile?: string },
) {
  return request<{ ok: boolean; project: Project }>(
    'POST', `/projects/${id}/meta`, data,
  );
}

// ── Files ───────────────────────────────────────────────────────────

export function getFile(projectId: string, path: string) {
  return request<{ path: string; content: string }>(
    'GET', `/projects/${projectId}/files/${path}`,
  );
}

export function putFile(projectId: string, path: string, content: string) {
  return request<{ ok: boolean; path: string }>(
    'PUT', `/projects/${projectId}/files/${path}`, { content },
  );
}

export function deleteFile(projectId: string, path: string) {
  return request<{ ok: boolean }>(
    'DELETE', `/projects/${projectId}/files/${path}`,
  );
}

export function renameFile(projectId: string, from: string, to: string) {
  return request<{ ok: boolean; from: string; to: string }>(
    'POST', `/projects/${projectId}/rename`, { from, to },
  );
}

export function createFolder(projectId: string, folderPath: string) {
  return request<{ ok: boolean; path: string }>(
    'POST', `/projects/${projectId}/mkdir`, { folderPath },
  );
}

// ── Upload ──────────────────────────────────────────────────────────

export async function uploadFiles(
  projectId: string,
  files: File[],
  targetDir?: string,
): Promise<{ ok: boolean; uploaded: string[]; errors: { file: string; error: string }[] }> {
  const form = new FormData();
  for (const f of files) {
    form.append('file', f, f.name);
  }

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const qs = targetDir ? `?dir=${encodeURIComponent(targetDir)}` : '';
  const res = await fetch(`${BASE}/projects/${projectId}/upload${qs}`, {
    method: 'POST',
    headers,
    body: form,
  });

  if (!res.ok) {
    throw createApiError(`Upload failed (${res.status})`, res.status);
  }
  return res.json();
}

// ── Compile ─────────────────────────────────────────────────────────

export function compile(
  projectId: string,
  opts?: { compiler?: string; mainFile?: string },
) {
  return request<{
    ok: boolean;
    code: number;
    pdfExists: boolean;
    stdout: string;
    stderr: string;
    diagnostics?: Array<{ type: string; severity: string; message: string; suggestion?: string }>;
  }>('POST', `/projects/${projectId}/compile`, opts ?? {});
}

export function getPdfUrl(projectId: string): string {
  const token = getToken();
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${BASE}/projects/${projectId}/pdf${qs}`;
}

export function getCompileLog(projectId: string) {
  return request<{ log: string }>('GET', `/projects/${projectId}/compile/log`);
}

// ── Download ────────────────────────────────────────────────────────

export function getDownloadUrl(projectId: string): string {
  const token = getToken();
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${BASE}/projects/${projectId}/download${qs}`;
}

// ── Search ──────────────────────────────────────────────────────────

export interface SearchResult {
  file: string;
  line: number;
  column: number;
  context: string;
}

export function searchProject(projectId: string, query: string) {
  return request<{ results: SearchResult[] }>(
    'GET', `/projects/${projectId}/search?q=${encodeURIComponent(query)}`,
  );
}

// ── AI ──────────────────────────────────────────────────────────────

export interface FileChange {
  action: 'create' | 'write' | 'edit' | 'delete';
  path: string;
  oldContent: string | null;
  newContent: string | null;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface AiChatResponse {
  ok: boolean;
  reply: string;
  fileChanges: FileChange[];
  toolCalls: ToolCall[];
  provider: string;
}

// SSE event types from the streaming endpoint
export type AiStreamEvent =
  | { type: 'status'; model: string; round: number }
  | { type: 'thinking'; round: number }
  | { type: 'thinking_content'; content: string }
  | { type: 'thinking_done'; content: string }
  | { type: 'content'; content: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string }
  | { type: 'file_change'; action: string; path: string; oldContent: string | null; newContent: string | null }
  | { type: 'done'; reply: string }
  | { type: 'error'; message: string };

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function aiChatStream(
  projectId: string,
  message: string,
  history: ChatHistoryMessage[],
  model: string | undefined,
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal,
  compiler?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/projects/${projectId}/ai/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, history, model, compiler }),
    signal,
  });

  if (!res.ok) {
    throw createApiError(`AI chat failed (${res.status})`, res.status);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    let currentEvent = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ') && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6));
          onEvent({ type: currentEvent, ...data } as AiStreamEvent);
        } catch { /* skip malformed */ }
        currentEvent = '';
      }
    }
  }
}

export function aiStatus() {
  return request<{ configured: boolean; provider: string; models: string[] }>(
    'GET', '/ai/status',
  );
}

// ── Collaborator management ─────────────────────────────────────────

export function getCollaborators(projectId: string) {
  return request<{ owner: string; collaborators: string[] }>(
    'GET', `/projects/${projectId}/collaborators`,
  );
}

export function addCollaborator(projectId: string, username: string) {
  return request<{ ok: boolean; collaborators: string[] }>(
    'POST', `/projects/${projectId}/collaborators`, { username },
  );
}

export function removeCollaborator(projectId: string, username: string) {
  return request<{ ok: boolean; collaborators: string[] }>(
    'DELETE', `/projects/${projectId}/collaborators/${encodeURIComponent(username)}`,
  );
}

// ── Shared types ────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  owner: string;
  collaborators: string[];
  mainFile: string;
  compiler: string;
  createdAt: string;
  updatedAt: string;
}
