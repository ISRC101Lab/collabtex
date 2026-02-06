import { snippetCompletion } from "@codemirror/autocomplete";

import { safeStorage as localStorage } from "./utils/storage.js";
import { api } from "./services/api.js";
import { t, getLang, setLang as setI18nLang } from "./i18n.js";
import { clampNumber } from "./utils/numbers.js";
import { escapeRegExp } from "./utils/strings.js";
import { fileExt } from "./utils/paths.js";
import { formatDuration, formatTime, formatMb, formatBytes } from "./utils/format.js";
import {
  diffLines,
  buildDiffSnippet,
  dedupeParagraphs,
} from "./utils/diff.js";
import {
  parseTable,
  generatePgfplots,
  buildFigureSnippet,
} from "./utils/chart.js";
import {
  showChartBuilderDialog,
  showImageInsertDialog,
} from "./features/insert_dialogs.js";
import {
  showQuickOutlineDialog,
  showQuickOpenDialog,
  showProjectSearchDialog,
} from "./features/search_tools.js";
import { renderFileTreePanel } from "./features/file_tree_panel.js";
import { renderHistoryPanel } from "./features/history_panel.js";
import { renderLoginPage } from "./features/login_page.js";
import { renderProjectsPage } from "./features/projects_page.js";
import { renderProjectPage } from "./features/project_page.js";
import { buildCompileMonitorBody } from "./features/compile_monitor.js";
import { buildProjectSettingsPanelView } from "./features/project_settings_panel.js";
import { renderFileTabsView } from "./features/file_tabs.js";
import { renderRecentFilesPanel, renderPinnedFilesPanel } from "./features/file_sidebar_panels.js";
import {
  isPathUnderPrefix,
  remapPathPrefix,
  remapPathList,
  filterPathList,
  remapPathSet,
  filterPathSet,
  normalizeTagList,
  formatTagList,
  projectMatchesFilter,
  projectMatchesScope,
  formatProjectAge,
} from "./utils/project_helpers.js";
import {
  extractIncludePaths,
  extractBibPaths,
  extractLabels,
  extractBibKeys,
  latexFoldService,
} from "./utils/latex.js";
import {
  flashLineEffect,
  clearFlashLineEffect,
  flashLineField,
} from "./editor/effects.js";
import { extractOutline, sameOutline } from "./editor/outline.js";
import { createDocStatsCache, hashTextFast, readTextForWork } from "./editor/doc_stats.js";
import { openFileSession } from "./editor/open_file_session.js";
import { compileProjectController } from "./compile/compile_controller.js";

const root = document.getElementById("app");

const PROJECT_THUMB_URL = "/assets/project-thumb.svg";
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14" />',
  upload: '<path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" /><path d="M7 9l5-5 5 5" /><path d="M12 4v12" />',
  download: '<path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" /><path d="M7 11l5 5 5-5" /><path d="M12 4v12" />',
  more: '<circle cx="6" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18" cy="12" r="1.4" fill="currentColor" />',
  clear: '<path d="M6 6l12 12M6 18L18 6" />',
  compile: '<path d="M4 4v5h5" /><path d="M20 20v-5h-5" /><path d="M5 9a7 7 0 0 1 11-3l3 3" /><path d="M19 15a7 7 0 0 1-11 3l-3-3" />',
  back: '<path d="M15 6l-6 6 6 6" />',
  panel: '<path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M9 4v16" />',
  files: '<path d="M4 7a1 1 0 0 1 1-1h5l2 2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />',
  chat: '<path d="M6 5h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4v-4H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />',
  list: '<path d="M6 7h12M6 12h12M6 17h12" />',
  search: '<circle cx="11" cy="11" r="6.5" /><path d="M16.2 16.2L20 20" />',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" />',
  settings: '<path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.54V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1-1.54 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.54-1H3a2 2 0 0 1 0-4h.06a1.7 1.7 0 0 0 1.54-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.54V3a2 2 0 0 1 4 0v.06a1.7 1.7 0 0 0 1 1.54 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.73 0 1.4.42 1.74 1.08.14.27.22.57.22.88a2 2 0 0 1-2 2h-.06a1.7 1.7 0 0 0-1.54 1z" />',
};

let editorVendorPromise = null;
function loadEditorVendor() {
  if (!editorVendorPromise) editorVendorPromise = import("./editor/vendor.js");
  return editorVendorPromise;
}

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "checked") el.checked = !!v;
    else if (k === "value") el.value = String(v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (c instanceof Node) {
      el.appendChild(c);
    } else if (typeof c === "string" || typeof c === "number") {
      el.appendChild(document.createTextNode(String(c)));
    }
  }
  return el;
}

function iconSvg(name, { size = 14, className = "" } = {}) {
  const icon = ICONS[name] || "";
  return h("span", {
    class: `icon ${className}`.trim(),
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`,
  });
}

async function buildSuggestedOpenFiles(projectId, tree, mainFile) {
  if (!projectId || !mainFile || !Array.isArray(tree)) return [];
  if (!tree.includes(mainFile)) return [];
  let text = "";
  try {
    text = await api(`/api/projects/${projectId}/file?path=${encodeURIComponent(mainFile)}`);
  } catch {
    return [mainFile];
  }
  const baseDir = mainFile.includes("/") ? mainFile.slice(0, mainFile.lastIndexOf("/")) : "";
  const includes = extractIncludePaths(text, baseDir);
  const bibs = extractBibPaths(text, baseDir);
  const candidates = [mainFile, ...includes, ...bibs];
  const uniq = [];
  const seen = new Set();
  for (const p of candidates) {
    if (!p || seen.has(p)) continue;
    if (tree.includes(p)) {
      uniq.push(p);
      seen.add(p);
    }
  }
  return uniq.slice(0, 12);
}

function updateDocCaches(filePath, text) {
  if (!app || !app.ui || !filePath) return;
  const ext = fileExt(filePath);
  if (ext === ".tex") {
    app.ui.labelCache[filePath] = extractLabels(text);
  }
  if (ext === ".bib") {
    const keys = extractBibKeys(text);
    if (!app.ui.bibKeyCache) {
      app.ui.bibKeyCache = { projectId: "", keys: [], byFile: {}, updatedAt: 0 };
    }
    app.ui.bibKeyCache.byFile[filePath] = keys;
    const all = new Set();
    for (const list of Object.values(app.ui.bibKeyCache.byFile || {})) {
      for (const k of list || []) all.add(k);
    }
    app.ui.bibKeyCache.keys = Array.from(all).sort();
    app.ui.bibKeyCache.updatedAt = Date.now();
  }
}

function getAllLabels() {
  const cache = (app && app.ui && app.ui.labelCache) || {};
  const all = new Set();
  for (const list of Object.values(cache)) {
    for (const key of list || []) all.add(key);
  }
  return Array.from(all);
}

function getBibKeys() {
  const keys = app && app.ui && app.ui.bibKeyCache && Array.isArray(app.ui.bibKeyCache.keys) ? app.ui.bibKeyCache.keys : [];
  return keys.slice();
}

function listTexFiles() {
  const tree = app && app.current && Array.isArray(app.current.tree) ? app.current.tree : [];
  return tree.filter((f) => /\.tex$/i.test(f));
}

function listBibFiles() {
  const tree = app && app.current && Array.isArray(app.current.tree) ? app.current.tree : [];
  return tree.filter((f) => /\.bib$/i.test(f));
}

async function refreshLabelCache() {
  if (!app || !app.current || !app.current.project) return;
  const projectId = app.current.project.id;
  const texFiles = listTexFiles();
  if (!app.ui.labelCache) app.ui.labelCache = {};
  const maxFiles = 80;
  for (const filePath of texFiles.slice(0, maxFiles)) {
    try {
      const text = await api(`/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`);
      app.ui.labelCache[filePath] = extractLabels(text);
    } catch {
      // ignore file read errors
    }
  }
}

async function refreshBibKeyCache() {
  if (!app || !app.current || !app.current.project) return;
  const projectId = app.current.project.id;
  const cache = { projectId, keys: [], byFile: {}, updatedAt: 0 };
  app.ui.bibKeyCache = cache;
  const bibFiles = listBibFiles();
  const maxFiles = 80;
  for (const filePath of bibFiles.slice(0, maxFiles)) {
    try {
      const text = await api(`/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`);
      cache.byFile[filePath] = extractBibKeys(text);
    } catch {
      // ignore file read errors
    }
  }
  const all = new Set();
  for (const list of Object.values(cache.byFile)) {
    for (const key of list || []) all.add(key);
  }
  cache.keys = Array.from(all).sort();
  cache.updatedAt = Date.now();
}

function clear() {
  while (root.firstChild) root.removeChild(root.firstChild);
}

function mount(node) {
  if (app && app.ui) applyTheme(app.ui.theme || "default");
  if (app && app.ui) applyEditorPrefs();
  root.replaceChildren(node);
  syncTopbarHeight();
  syncResizeObserver();
  reattachEditorView();
  applyDropdownState();
  ensureLayoutVisible();
  setTimeout(() => ensureLayoutVisible(), 0);
}

function syncTopbarHeight() {
  const bar = document.querySelector(".topbar");
  if (!bar) return;
  const h = Math.ceil(bar.getBoundingClientRect().height || 0);
  if (h > 0) document.documentElement.style.setProperty("--topbarH", `${h}px`);
}

function syncResizeObserver() {
  if (typeof ResizeObserver === "undefined") return;
  const target = document.getElementById("layoutRoot");
  if (!target) return;
  if (app.ui.resizeObserverEl === target && app.ui.resizeObserver) return;
  if (app.ui.resizeObserver) {
    try { app.ui.resizeObserver.disconnect(); } catch {}
  }
  const ro = new ResizeObserver(() => refreshEditorView());
  ro.observe(target);
  app.ui.resizeObserver = ro;
  app.ui.resizeObserverEl = target;
}

function reattachEditorView() {
  if (!app || !app.editor || !app.editor.view) return;
  const host = document.getElementById("editorHost");
  if (!host) return;
  const dom = app.editor.view.dom;
  if (!dom) return;
  if (!host.contains(dom)) {
    host.textContent = "";
    host.appendChild(dom);
  }
  refreshEditorView();
}

function wsUrl() {
  // Allow overriding via query params:
  // - ?wsUrl=ws://host:port/path (full override)
  // - ?wsPort=3091 (use this port, default path "/")
  // - ?wsPath=/ws (override path)
  const u = new URL(location.href);
  const override = u.searchParams.get("wsUrl");
  const token = localStorage.getItem("ct_session_token") || "";
  const isLoopbackHost = (host) => {
    const h = String(host || "").toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
  };
  const appendToken = (raw) => {
    if (!token) return raw;
    try {
      const ws = new URL(raw, location.href);
      if (!ws.searchParams.get("token")) ws.searchParams.set("token", token);
      return ws.toString();
    } catch {
      return raw;
    }
  };

  if (override) {
    return appendToken(override);
  }
  const wsPort = u.searchParams.get("wsPort");
  const wsPathParam = u.searchParams.get("wsPath");
  if (wsPort) {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const path = wsPathParam || "/";
    const portPart = `:${wsPort}`;
    const pathPart = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
    const base = `${scheme}://${location.hostname}${portPart}${pathPart}`;
    return appendToken(base);
  }

  const stored = localStorage.getItem("ct_ws_url");
  if (stored) {
    let skipStored = false;
    try {
      const ws = new URL(stored, location.href);
      const wsHost = ws.hostname || "";
      const pageHost = location.hostname || "";
      // Ignore stale localhost override when page is opened from remote host/port-forward URL.
      if (isLoopbackHost(wsHost) && !isLoopbackHost(pageHost)) {
        skipStored = true;
      }
    } catch {
      // Keep non-standard values for backward compatibility.
      skipStored = false;
    }

    if (!skipStored) {
      return appendToken(stored);
    }
    try { localStorage.removeItem("ct_ws_url"); } catch {}
  }

  const scheme = location.protocol === "https:" ? "wss" : "ws";
  let port = "";
  let path = "/";

  if (wsPathParam) {
    port = location.port || "";
    path = wsPathParam;
  } else if (location.port) {
    const basePort = Number(location.port);
    port = Number.isFinite(basePort) ? String(basePort + 1) : "";
    path = "/";
  } else {
    // Default to same-port /ws when running behind a proxy on 80/443.
    port = "";
    path = "/ws";
  }

  if (path !== "/" && !path.startsWith("/")) path = `/${path}`;
  const portPart = port ? `:${port}` : "";
  const pathPart = path === "/" ? "" : path;
  const base = `${scheme}://${location.hostname}${portPart}${pathPart}`;
  return appendToken(base);
}

function getPdfTargetFile(projectId) {
  if (app.ui && app.ui.pdfTargetFile) return app.ui.pdfTargetFile;
  if (app.current && app.current.mainFile) return app.current.mainFile;
  return "";
}

function pdfApiUrl(projectId, ts, file) {
  const params = new URLSearchParams();
  if (ts) params.set("ts", String(ts));
  const target = file || getPdfTargetFile(projectId);
  if (target) params.set("file", target);
  const token = localStorage.getItem("ct_session_token") || "";
  if (token) params.set("token", token);
  const qs = params.toString();
  return `/api/projects/${projectId}/artifacts/pdf${qs ? `?${qs}` : ""}`;
}

function pdfArtifactQuery(projectId) {
  const target = getPdfTargetFile(projectId);
  return target ? `?file=${encodeURIComponent(target)}` : "";
}

function resolvePdfTarget(projectId, tree, mainFile) {
  const texFiles = Array.isArray(tree) ? tree.filter((f) => f.endsWith(".tex")) : [];
  const stored = projectId ? localStorage.getItem(`ct_pdfTarget_${projectId}`) : "";
  if (stored && texFiles.includes(stored)) return stored;
  if (mainFile && texFiles.includes(mainFile)) return mainFile;
  return texFiles[0] || mainFile || "";
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".pdf", ".eps", ".svg"]);

function listImageFiles(tree) {
  if (!Array.isArray(tree)) return [];
  return tree
    .filter((f) => {
      const lower = f.toLowerCase();
      for (const ext of IMAGE_EXTS) {
        if (lower.endsWith(ext)) return true;
      }
      return false;
    })
    .sort();
}

function imageCompletionSource(context) {
  if (!app || !app.current || !app.current.tree) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = before.match(/\\includegraphics\\*?\\s*(?:\\[[^\\]]*\\])?\\s*\\{([^}]*)$/);
  if (!match) return null;
  const prefix = match[1] || "";
  const prefixLower = prefix.toLowerCase();
  const files = listImageFiles(app.current.tree);
  const options = files
    .filter((f) => (prefixLower ? f.toLowerCase().includes(prefixLower) : true))
    .slice(0, 80)
    .map((f) => ({ label: f, type: "file" }));
  if (!options.length) return null;
  return {
    from: context.pos - prefix.length,
    options,
    validFor: /[^}]*$/,
  };
}

const LATEX_ENVIRONMENTS = [
  "abstract",
  "figure",
  "table",
  "equation",
  "align",
  "align*",
  "itemize",
  "enumerate",
  "description",
  "theorem",
  "lemma",
  "proof",
  "definition",
  "remark",
  "algorithm",
  "algorithmic",
  "tabular",
  "tabularx",
  "tikzpicture",
  "axis",
  "lstlisting",
  "center",
  "quote",
  "verbatim",
];

const LATEX_COMMAND_COMPLETIONS = [
  snippetCompletion("\\section{${1:Title}}", { label: "\\section", type: "keyword", detail: "Section" }),
  snippetCompletion("\\subsection{${1:Title}}", { label: "\\subsection", type: "keyword", detail: "Subsection" }),
  snippetCompletion("\\subsubsection{${1:Title}}", { label: "\\subsubsection", type: "keyword", detail: "Subsubsection" }),
  snippetCompletion("\\paragraph{${1:Title}}", { label: "\\paragraph", type: "keyword", detail: "Paragraph" }),
  snippetCompletion("\\subparagraph{${1:Title}}", { label: "\\subparagraph", type: "keyword", detail: "Subparagraph" }),
  snippetCompletion("\\textbf{${1:text}}", { label: "\\textbf", type: "keyword", detail: "Bold" }),
  snippetCompletion("\\emph{${1:text}}", { label: "\\emph", type: "keyword", detail: "Emphasis" }),
  snippetCompletion("\\textit{${1:text}}", { label: "\\textit", type: "keyword", detail: "Italic" }),
  snippetCompletion("\\texttt{${1:text}}", { label: "\\texttt", type: "keyword", detail: "Monospace" }),
  snippetCompletion("\\cite{${1:key}}", { label: "\\cite", type: "keyword", detail: "Citation" }),
  snippetCompletion("\\citep{${1:key}}", { label: "\\citep", type: "keyword", detail: "Parenthetical cite" }),
  snippetCompletion("\\citet{${1:key}}", { label: "\\citet", type: "keyword", detail: "Textual cite" }),
  snippetCompletion("\\ref{${1:label}}", { label: "\\ref", type: "keyword", detail: "Reference" }),
  snippetCompletion("\\eqref{${1:label}}", { label: "\\eqref", type: "keyword", detail: "Equation ref" }),
  snippetCompletion("\\label{${1:label}}", { label: "\\label", type: "keyword", detail: "Label" }),
  snippetCompletion("\\includegraphics[width=${1:0.8}\\\\linewidth]{${2:file}}", {
    label: "\\includegraphics",
    type: "keyword",
    detail: "Include image",
  }),
  snippetCompletion("\\caption{${1:Caption}}", { label: "\\caption", type: "keyword", detail: "Caption" }),
  snippetCompletion("\\footnote{${1:text}}", { label: "\\footnote", type: "keyword", detail: "Footnote" }),
  { label: "\\item", type: "keyword", detail: "List item", apply: "\\item " },
  { label: "\\centering", type: "keyword", detail: "Centering", apply: "\\centering\n" },
  { label: "\\begin", type: "keyword", detail: "Begin env", apply: "\\begin{}" },
  { label: "\\end", type: "keyword", detail: "End env", apply: "\\end{}" },
];

function relativePath(fromFile, targetFile) {
  if (!fromFile || !targetFile) return targetFile;
  if (!fromFile.includes("/")) return targetFile;
  const base = fromFile.slice(0, fromFile.lastIndexOf("/"));
  if (!base) return targetFile;
  const prefix = `${base}/`;
  return targetFile.startsWith(prefix) ? targetFile.slice(prefix.length) : targetFile;
}

function buildIncludeCompletions() {
  const current = app.current && app.current.openFile ? app.current.openFile : "";
  const out = [];
  const seen = new Set();
  for (const f of listTexFiles()) {
    if (f === current) continue;
    const rel = relativePath(current, f);
    const noExt = rel.replace(/\\.tex$/i, "");
    for (const label of [noExt, rel]) {
      if (!label || seen.has(label)) continue;
      seen.add(label);
      out.push({ label, type: "file", detail: rel });
    }
  }
  return out;
}

function buildBibFileCompletions(withExtension) {
  const current = app.current && app.current.openFile ? app.current.openFile : "";
  const out = [];
  const seen = new Set();
  for (const f of listBibFiles()) {
    const rel = relativePath(current, f);
    const label = withExtension ? rel : rel.replace(/\\.bib$/i, "");
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, type: "file", detail: rel });
  }
  return out;
}

function matchBraceCompletion(match) {
  const idx = match.text.lastIndexOf("{");
  const from = match.from + idx + 1;
  return { from, to: match.to, prefix: match.text.slice(idx + 1) };
}

function matchCommaCompletion(match) {
  const text = match.text;
  const braceIdx = text.lastIndexOf("{");
  let from = match.from + braceIdx + 1;
  const commaIdx = text.lastIndexOf(",");
  if (commaIdx !== -1 && commaIdx > braceIdx) {
    const tail = text.slice(commaIdx + 1);
    const ws = tail.match(/^\\s*/);
    from = match.from + commaIdx + 1 + (ws ? ws[0].length : 0);
  }
  return { from, to: match.to, prefix: text.slice(Math.max(text.lastIndexOf(","), braceIdx) + 1).trimStart() };
}

function latexCompletionSource(context) {
  if (!app || app.view !== "project") return null;

  const envMatch = context.matchBefore(/\\(begin|end)\\{[a-zA-Z*]*$/);
  if (envMatch) {
    const { from, to, prefix } = matchBraceCompletion(envMatch);
    const options = LATEX_ENVIRONMENTS.filter((e) => e.toLowerCase().startsWith(prefix.toLowerCase())).map((e) => ({
      label: e,
      type: "keyword",
      detail: "env",
    }));
    if (!options.length) return null;
    return { from, to, options, validFor: /^[a-zA-Z*]*$/ };
  }

  const citeMatch = context.matchBefore(/\\(?:cite|citet|citep|citealp|citeauthor|citeyear|Cite|Citep|Citet)\\{[^}]*$/);
  if (citeMatch) {
    const keys = getBibKeys();
    if (!keys.length) return null;
    const { from, to, prefix } = matchCommaCompletion(citeMatch);
    const options = keys
      .filter((k) => k.toLowerCase().startsWith(prefix.toLowerCase()))
      .map((k) => ({ label: k, type: "keyword" }));
    if (!options.length) return null;
    return { from, to, options, validFor: /[^,}]*$/ };
  }

  const refMatch = context.matchBefore(/\\(?:ref|eqref|autoref|cref|Cref)\\{[^}]*$/);
  if (refMatch) {
    const labels = getAllLabels();
    if (!labels.length) return null;
    const { from, to, prefix } = matchCommaCompletion(refMatch);
    const options = labels
      .filter((k) => k.toLowerCase().startsWith(prefix.toLowerCase()))
      .map((k) => ({ label: k, type: "keyword" }));
    if (!options.length) return null;
    return { from, to, options, validFor: /[^,}]*$/ };
  }

  const inputMatch = context.matchBefore(/\\(?:input|include|subfile)\\{[^}]*$/);
  if (inputMatch) {
    const { from, to, prefix } = matchBraceCompletion(inputMatch);
    const options = buildIncludeCompletions().filter((o) => o.label.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!options.length) return null;
    return { from, to, options, validFor: /[^}]*$/ };
  }

  const bibMatch = context.matchBefore(/\\bibliography\\{[^}]*$/);
  if (bibMatch) {
    const { from, to, prefix } = matchCommaCompletion(bibMatch);
    const options = buildBibFileCompletions(false).filter((o) => o.label.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!options.length) return null;
    return { from, to, options, validFor: /[^,}]*$/ };
  }

  const addBibMatch = context.matchBefore(/\\addbibresource\\{[^}]*$/);
  if (addBibMatch) {
    const { from, to, prefix } = matchBraceCompletion(addBibMatch);
    const options = buildBibFileCompletions(true).filter((o) => o.label.toLowerCase().startsWith(prefix.toLowerCase()));
    if (!options.length) return null;
    return { from, to, options, validFor: /[^}]*$/ };
  }

  const cmdMatch = context.matchBefore(/\\[a-zA-Z@]*$/);
  if (cmdMatch) {
    const prefix = cmdMatch.text.slice(1).toLowerCase();
    const options = LATEX_COMMAND_COMPLETIONS.filter((c) => {
      const label = String(c.label || "").replace(/^\\/, "").toLowerCase();
      return label.startsWith(prefix);
    });
    if (!options.length) return null;
    return { from: cmdMatch.from, to: cmdMatch.to, options, validFor: /^\\[a-zA-Z@]*$/ };
  }

  return null;
}

function pdfUrl(projectId, ts, page, zoom, file) {
  const url = pdfApiUrl(projectId, ts, file);
  const parts = [];
  if (page) parts.push(`page=${page}`);
  parts.push(`zoom=${zoom || "page-width"}`);
  return parts.length ? `${url}#${parts.join("&")}` : url;
}

let pdfjsPromise = null;
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/build/pdf.mjs");
  }
  const mod = await pdfjsPromise;
  const pdfjs = mod.default || mod;
  if (!app.ui.pdfWorkerReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    app.ui.pdfWorkerReady = true;
  }
  return pdfjs;
}

async function ensurePdfDoc(projectId, { refresh = false } = {}) {
  const ts = refresh || !app.ui.pdfTs ? Date.now() : app.ui.pdfTs;
  app.ui.pdfTs = ts;
  const url = pdfApiUrl(projectId, ts);
  if (!refresh && app.ui.pdfDoc && app.ui.pdfDocUrl === url) return app.ui.pdfDoc;
  if (app.ui.pdfLoadingTask) {
    try { await app.ui.pdfLoadingTask.destroy(); } catch {}
    app.ui.pdfLoadingTask = null;
  }
  if (app.ui.pdfDoc) {
    try { await app.ui.pdfDoc.destroy(); } catch {}
    app.ui.pdfDoc = null;
  }
  const pdfjs = await loadPdfJs();
  app.ui.pdfLoadingTask = pdfjs.getDocument({
    url,
    withCredentials: true,
    cMapUrl: "/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/standard_fonts/",
  });
  const doc = await app.ui.pdfLoadingTask.promise;
  app.ui.pdfDoc = doc;
  app.ui.pdfDocUrl = url;
  app.ui.pdfPageCount = doc.numPages || 1;
  return doc;
}

async function renderPdfPages({ projectId, refresh = false } = {}) {
  const pid = projectId || (app.current.project && app.current.project.id);
  if (!pid) return;
  const viewer = document.getElementById("pdfViewer");
  const pagesHost = document.getElementById("pdfPages");
  if (!viewer || !pagesHost) return;
  const prevScrollTop = viewer.scrollTop;
  const clientW = viewer.clientWidth;
  const clientH = viewer.clientHeight;
  if (clientW < 40 || clientH < 40) {
    setTimeout(() => {
      renderPdfPages({ projectId: pid, refresh }).catch(() => {});
    }, 80);
    return;
  }

  const doc = await ensurePdfDoc(pid, { refresh });
  const pdfjs = await loadPdfJs();
  const total = doc.numPages || 1;
  app.ui.pdfPageCount = total;
  let pageNum = app.ui.pdfPage || 1;
  if (pageNum < 1) pageNum = 1;
  if (pageNum > total) pageNum = total;
  app.ui.pdfPage = pageNum;

  const pageInput = document.getElementById("pdfPageInput");
  if (pageInput) pageInput.value = String(pageNum);
  updatePdfPageInfo(pageNum, total);

  const firstPage = await doc.getPage(1);
  const baseViewport = firstPage.getViewport({ scale: 1 });
  const viewW = Math.max(1, viewer.clientWidth - 8);
  const viewH = Math.max(1, viewer.clientHeight - 8);
  let scale = 1;
  if (app.ui.pdfZoom === "page-width") {
    scale = viewW / baseViewport.width;
  } else if (app.ui.pdfZoom === "page-fit") {
    scale = Math.min(viewW / baseViewport.width, viewH / baseViewport.height);
  } else {
    const z = Number(app.ui.pdfZoom);
    scale = Number.isFinite(z) && z > 0 ? z / 100 : 1;
  }
  app.ui.pdfScale = scale;

  app.ui.pdfPageHeights = {};
  app.ui.pdfPageWidths = {};
  app.ui.pdfViewports = {};

  app.ui.pdfRenderToken = (app.ui.pdfRenderToken || 0) + 1;
  const token = app.ui.pdfRenderToken;
  if (app.ui.pdfRenderTasks && app.ui.pdfRenderTasks.length) {
    for (const t of app.ui.pdfRenderTasks) {
      try { t.cancel(); } catch {}
    }
  }
  app.ui.pdfRenderTasks = [];

  pagesHost.innerHTML = "";
  for (let i = 1; i <= total; i += 1) {
    const wrap = h("div", { class: "pdf-page-wrap", "data-page": String(i) }, [
      h("canvas", { class: "pdf-canvas", id: `pdfCanvas_${i}`, "data-page": String(i) }),
      h("div", { class: "textLayer", id: `pdfText_${i}`, "data-page": String(i) }),
    ]);
    pagesHost.appendChild(wrap);
  }

  const dpr = window.devicePixelRatio || 1;
  for (let i = 1; i <= total; i += 1) {
    if (token !== app.ui.pdfRenderToken) return;
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    app.ui.pdfPageHeights[i] = base.height;
    app.ui.pdfPageWidths[i] = base.width;
    const viewport = page.getViewport({ scale });
    app.ui.pdfViewports[i] = viewport;
    const canvas = document.getElementById(`pdfCanvas_${i}`);
    const wrap = canvas ? canvas.closest(".pdf-page-wrap") : null;
    if (!canvas) continue;
    const ctx = canvas.getContext("2d");
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    if (wrap) {
      wrap.style.width = `${viewport.width}px`;
      wrap.style.height = `${viewport.height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const task = page.render({ canvasContext: ctx, viewport });
    app.ui.pdfRenderTasks.push(task);
    try {
      await task.promise;
    } catch {
      // ignore render errors
    }

    const textLayerDiv = document.getElementById(`pdfText_${i}`);
    if (textLayerDiv) {
      textLayerDiv.innerHTML = "";
      textLayerDiv.style.setProperty("--scale-factor", String(scale));
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      try {
        const textContent = await page.getTextContent();
        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        await textLayer.render();
        if (pdfjs.setLayerDimensions) pdfjs.setLayerDimensions(textLayerDiv, viewport);
      } catch {
        // ignore text layer errors
      }
    }
  }

  const pos = placePdfMarker();
  if (app.ui.pdfMarkerFocus) {
    scrollPdfToMarker(pos);
    app.ui.pdfMarkerFocus = false;
  } else if (Number.isFinite(prevScrollTop)) {
    viewer.scrollTop = prevScrollTop;
  }
  if (app.ui.pdfMarkerPulse) {
    pulsePdfMarker();
    app.ui.pdfMarkerPulse = false;
  }

  updatePdfPageOffsets();
  handlePdfScroll();
}

function computePdfMarkerPosition() {
  const marker = app.ui.pdfMarker;
  if (!marker) return null;
  const viewer = document.getElementById("pdfViewer");
  const canvas = document.getElementById(`pdfCanvas_${marker.page}`);
  if (!viewer || !canvas) return null;
  const canvasW = canvas.clientWidth || 0;
  const canvasH = canvas.clientHeight || 0;

  const pickPos = (px, py) => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    const scale = app.ui.pdfScale || 1;
    const vx = px * scale;
    const vy = py * scale;
    if (vx < 0 || vy < 0 || vx > canvasW || vy > canvasH) return null;
    const vrect = viewer.getBoundingClientRect();
    const crect = canvas.getBoundingClientRect();
    const left = viewer.scrollLeft + (crect.left - vrect.left) + vx;
    const top = viewer.scrollTop + (crect.top - vrect.top) + vy;
    return { left, top };
  };

  const primary = pickPos(Number(marker.x), Number(marker.y));
  if (primary) return primary;
  return pickPos(Number(marker.h), Number(marker.v));
}

function placePdfMarker() {
  const markerEl = document.getElementById("pdfMarker");
  if (!markerEl) return null;
  const pos = computePdfMarkerPosition();
  if (!pos) {
    markerEl.style.display = "none";
    return null;
  }
  markerEl.style.left = `${pos.left}px`;
  markerEl.style.top = `${pos.top}px`;
  markerEl.style.display = "block";
  markerEl.classList.remove("pulse");
  return pos;
}

function scrollPdfToMarker(pos) {
  const viewer = document.getElementById("pdfViewer");
  if (!viewer) return;
  const target = pos || placePdfMarker();
  if (!target) return;
  const top = Math.max(0, target.top - viewer.clientHeight * 0.35);
  viewer.scrollTo({ top, behavior: "smooth" });
}

function scrollPdfToPage(page) {
  const viewer = document.getElementById("pdfViewer");
  const canvas = document.getElementById(`pdfCanvas_${page}`);
  if (!viewer || !canvas) return;
  const vrect = viewer.getBoundingClientRect();
  const crect = canvas.getBoundingClientRect();
  const top = viewer.scrollTop + (crect.top - vrect.top) - viewer.clientHeight * 0.08;
  viewer.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

function pulsePdfMarker() {
  const markerEl = document.getElementById("pdfMarker");
  if (!markerEl || markerEl.style.display === "none") return;
  markerEl.classList.remove("pulse");
  // restart animation
  void markerEl.offsetWidth;
  markerEl.classList.add("pulse");
}

async function refreshPdfLog(projectId) {
  const pid = projectId || (app.current.project && app.current.project.id);
  if (!pid) return;
  const logEl = document.getElementById("compileLog");
  try {
    const st = app.current.artifacts || (await fetchArtifactsStatus(pid));
    if (st && st.log && st.log.exists) {
      const txt = await api(`/api/projects/${pid}/artifacts/log${pdfArtifactQuery(pid)}`);
      app.current.lastLog = txt;
      if (logEl) logEl.textContent = txt;
      if (app.ui.bottomMode === "log") {
        const bottomLog = document.getElementById("bottomLog");
        if (bottomLog) bottomLog.textContent = txt;
      }
    } else {
      app.current.lastLog = "";
      if (logEl) logEl.textContent = "";
      if (app.ui.bottomMode === "log") {
        const bottomLog = document.getElementById("bottomLog");
        if (bottomLog) bottomLog.textContent = "";
      }
    }
  } catch {
    // ignore
  }
}

function resetPdfState() {
  app.ui.pdfPage = null;
  app.ui.pdfTs = null;
  app.ui.pdfDoc = null;
  app.ui.pdfDocUrl = "";
  app.ui.pdfPageCount = 0;
  app.ui.pdfPageHeights = {};
  app.ui.pdfPageWidths = {};
  app.ui.pdfViewports = {};
  app.ui.pdfRenderTasks = [];
  app.ui.pdfRenderToken = 0;
  app.ui.pdfMarker = null;
  app.ui.pdfMarkerFocus = false;
  app.ui.pdfMarkerPulse = false;
}

function setPdfTargetFile(file) {
  const pid = app.current.project && app.current.project.id;
  const target = String(file || "").trim();
  if (!pid || !target) return;
  if (app.ui.pdfTargetFile === target) return;
  app.ui.pdfTargetFile = target;
  localStorage.setItem(`ct_pdfTarget_${pid}`, target);
  resetPdfState();
  refreshPdfArtifacts(pid, { refresh: true }).then(() => refreshPdfLog(pid)).catch(() => {});
}

function syncPdfTargetFromStatus(pid, status) {
  if (!status) return;
  const mainFile = status.mainFile ? String(status.mainFile) : "";
  const targetFile = status.targetFile ? String(status.targetFile) : "";
  if (mainFile && app.current && app.current.mainFile !== mainFile) {
    app.current.mainFile = mainFile;
  }
  if (targetFile && app.ui.pdfTargetFile !== targetFile) {
    app.ui.pdfTargetFile = targetFile;
    if (pid) localStorage.setItem(`ct_pdfTarget_${pid}`, targetFile);
    resetPdfState();
    const select = document.getElementById("pdfTargetSelect");
    if (select) select.value = targetFile;
  }
}

async function fetchArtifactsStatus(pid) {
  if (!pid) return null;
  try {
    const st = await api(`/api/projects/${pid}/artifacts/status${pdfArtifactQuery(pid)}`);
    syncPdfTargetFromStatus(pid, st);
    if (
      st &&
      st.pdf &&
      st.pdf.exists === false &&
      st.mainFile &&
      st.targetFile &&
      st.mainFile !== st.targetFile
    ) {
      try {
        const fallback = await api(`/api/projects/${pid}/artifacts/status`);
        if (fallback && fallback.pdf && fallback.pdf.exists) {
          syncPdfTargetFromStatus(pid, fallback);
          return fallback;
        }
      } catch {
        // ignore fallback errors
      }
    }
    return st;
  } catch (e) {
    const hasTarget = !!getPdfTargetFile(pid);
    if (e && e.status === 404 && hasTarget) {
      try {
        const st = await api(`/api/projects/${pid}/artifacts/status`);
        syncPdfTargetFromStatus(pid, st);
        return st;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function refreshPdfArtifacts(projectId, { refresh = false } = {}) {
  const pid = projectId || (app.current.project && app.current.project.id);
  if (!pid) return;
  try {
    const st = await fetchArtifactsStatus(pid);
    if (!st) return;
    app.current.artifacts = st;
    const hintEl = document.getElementById("pdfHint");
    if (hintEl) hintEl.style.display = st && st.pdf && st.pdf.exists ? "none" : "block";
    const markerEl = document.getElementById("pdfMarker");
    if (markerEl && !(st && st.pdf && st.pdf.exists)) markerEl.style.display = "none";
    const openBtn = document.getElementById("openPdfBtn");
    if (openBtn) openBtn.disabled = !(st && st.pdf && st.pdf.exists);
    if (st && st.pdf && st.pdf.exists) await renderPdfPages({ projectId: pid, refresh });
  } catch {
    // ignore
  }
}

function setPdfView({ projectId, page, zoom, refresh = false } = {}) {
  const pid = projectId || (app.current.project && app.current.project.id);
  if (page !== undefined && page !== null) {
    const num = Number(page);
    app.ui.pdfPage = Number.isFinite(num) && num > 0 ? Math.floor(num) : 1;
    const pageInput = document.getElementById("pdfPageInput");
    if (pageInput) pageInput.value = String(app.ui.pdfPage);
    updatePdfPageInfo(app.ui.pdfPage, app.ui.pdfPageCount || 1);
  }
  const zoomChanged = !!zoom;
  if (zoom) {
    app.ui.pdfZoom = zoom;
    localStorage.setItem("ct_pdfZoom", zoom);
    const zoomSelect = document.getElementById("pdfZoomSelect");
    if (zoomSelect) zoomSelect.value = zoom;
  }
  const hasRendered = !!document.getElementById(`pdfCanvas_${app.ui.pdfPage || 1}`);
  if (refresh || zoomChanged || !hasRendered) {
    renderPdfPages({ projectId: pid, refresh }).then(() => {
      if (page) scrollPdfToPage(app.ui.pdfPage);
    }).catch(() => {});
  } else if (page) {
    scrollPdfToPage(app.ui.pdfPage);
  }
}

const PDF_ZOOM_STEPS = [50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];

function getZoomNumber(val) {
  if (!val || val === "page-width" || val === "page-fit") return 100;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

function formatPdfPageInfo(page, total) {
  const norm = (n) => Math.max(1, Number(n) || 1);
  return `${norm(page)} / ${norm(total)} 页`;
}

function updatePdfPageInfo(page, total) {
  const infoEl = document.getElementById("pdfPageInfo");
  if (infoEl) infoEl.textContent = formatPdfPageInfo(page, total);
}

function updatePdfPageOffsets() {
  const viewer = document.getElementById("pdfViewer");
  const pagesHost = document.getElementById("pdfPages");
  if (!viewer || !pagesHost) return;
  const wraps = Array.from(pagesHost.querySelectorAll(".pdf-page-wrap"));
  const offsets = [];
  for (const el of wraps) {
    const page = Number(el.getAttribute("data-page") || el.dataset.page || offsets.length + 1);
    offsets.push({ page, top: el.offsetTop, height: el.offsetHeight });
  }
  app.ui.pdfPageOffsets = offsets;
}

let pdfScrollRaf = null;
function handlePdfScroll() {
  const viewer = document.getElementById("pdfViewer");
  const offsets = app.ui.pdfPageOffsets || [];
  if (!viewer || !offsets.length) return;
  const anchor = viewer.scrollTop + viewer.clientHeight * 0.35;
  let page = offsets[0].page || 1;
  for (const item of offsets) {
    if (anchor >= item.top) page = item.page;
    else break;
  }
  if (page !== app.ui.pdfPage) {
    app.ui.pdfPage = page;
    updatePdfPageInfo(page, app.ui.pdfPageCount || 1);
  }
}

function zoomStep(direction) {
  const current = getZoomNumber(app.ui.pdfZoom);
  const sorted = PDF_ZOOM_STEPS.slice().sort((a, b) => a - b);
  let next = current;
  if (direction > 0) {
    next = sorted.find((v) => v > current) || sorted[sorted.length - 1];
  } else {
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      if (sorted[i] < current) {
        next = sorted[i];
        break;
      }
    }
  }
  setPdfView({ projectId: app.current.project && app.current.project.id, zoom: String(next) });
}

function buildTree(paths) {
  const rootNode = { type: "dir", name: "", path: "", children: new Map() };
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    let cur = rootNode;
    let curPath = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const type = isLast ? "file" : "dir";
      curPath = curPath ? `${curPath}/${part}` : part;
      if (!cur.children.has(part)) {
        cur.children.set(part, { type, name: part, path: curPath, children: new Map() });
      }
      cur = cur.children.get(part);
      if (isLast) cur.type = "file";
    }
  }
  return rootNode;
}

const ASSET_EXTS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);
function isAssetFile(filePath) {
  const lower = String(filePath || "").toLowerCase();
  for (const ext of ASSET_EXTS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

const FOCUS_EXTS = new Set([
  ".tex",
  ".bib",
  ".sty",
  ".cls",
  ".bst",
  ".bbx",
  ".cbx",
  ".dbx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".eps",
]);

const STYLE_EXTS = new Set([".sty", ".cls", ".bst", ".bbx", ".cbx", ".dbx"]);

function isFocusFile(filePath) {
  const lower = String(filePath || "").toLowerCase();
  if (!lower) return false;
  if (lower.endsWith(".synctex.gz")) return false;
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  if (!ext) return false;
  return FOCUS_EXTS.has(ext);
}

function hashText(text) {
  return hashTextFast(text);
}

function openFilesKey(projectId) {
  return `ct_openFiles_${projectId}`;
}

function lastOpenFileKey(projectId) {
  return `ct_lastFile_${projectId}`;
}

function pinnedFilesKey(projectId) {
  return `ct_pins_${projectId}`;
}

const FOLDER_PLACEHOLDER = ".ct-folder";
function isFolderPlaceholder(path) {
  const raw = String(path || "");
  if (!raw) return false;
  const parts = raw.split("/");
  return parts[parts.length - 1] === FOLDER_PLACEHOLDER;
}

function revealActiveFile() {
  const file = app.current && app.current.openFile ? String(app.current.openFile) : "";
  if (!file) return;

  const next = new Set(app.ui && app.ui.openFolders ? app.ui.openFolders : [""]);
  next.add("");

  const parts = file.split("/").filter(Boolean);
  let cur = "";
  for (let i = 0; i < Math.max(0, parts.length - 1); i += 1) {
    cur = cur ? `${cur}/${parts[i]}` : parts[i];
    next.add(cur);
  }

  if (app.ui && app.ui.fileView !== "all") {
    const ext = fileExt(file);
    let group = "other";
    if (ext === ".tex") group = "tex";
    else if (ext === ".bib") group = "bib";
    else if (isAssetFile(file)) group = "fig";
    else if (STYLE_EXTS.has(ext)) group = "style";
    next.add(`@group/${group}`);
  }

  app.ui.openFolders = next;
  app.ui.groupTreeInit = true;
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();

  setTimeout(() => {
    const row = document.querySelector(".tree-row.file.active");
    if (row) row.scrollIntoView({ block: "center" });
  }, 0);
}

function loadPinnedFiles(projectId, tree) {
  if (!projectId) return [];
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(pinnedFilesKey(projectId)) || "[]");
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];
  list = list.filter((p) => typeof p === "string");
  if (Array.isArray(tree) && tree.length) {
    list = list.filter((p) => tree.includes(p));
  }
  list = list.filter((p) => !isFolderPlaceholder(p));
  return Array.from(new Set(list)).slice(0, 30);
}

function setPinnedFiles(list) {
  app.ui.pinnedFiles = Array.isArray(list) ? list : [];
  const projectId = app.current.project && app.current.project.id;
  if (!projectId) return;
  localStorage.setItem(pinnedFilesKey(projectId), JSON.stringify(app.ui.pinnedFiles));
}

function togglePinnedFile(filePath) {
  if (!filePath) return;
  const list = Array.isArray(app.ui.pinnedFiles) ? app.ui.pinnedFiles.slice() : [];
  const idx = list.indexOf(filePath);
  if (idx === -1) list.unshift(filePath);
  else list.splice(idx, 1);
  setPinnedFiles(list);
  if (app.ui.refreshPinnedFiles) app.ui.refreshPinnedFiles();
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();
}

function pinFiles(files) {
  const list = Array.isArray(app.ui.pinnedFiles) ? app.ui.pinnedFiles.slice() : [];
  const set = new Set(list);
  for (const f of files || []) {
    if (f && !set.has(f)) set.add(f);
  }
  const next = Array.from(set).slice(0, 30);
  setPinnedFiles(next);
  if (app.ui.refreshPinnedFiles) app.ui.refreshPinnedFiles();
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();
}

function unpinFiles(files) {
  const list = Array.isArray(app.ui.pinnedFiles) ? app.ui.pinnedFiles.slice() : [];
  const remove = new Set(files || []);
  const next = list.filter((f) => !remove.has(f));
  setPinnedFiles(next);
  if (app.ui.refreshPinnedFiles) app.ui.refreshPinnedFiles();
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();
}

function loadOpenFiles(projectId, tree) {
  if (!projectId) return [];
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(openFilesKey(projectId)) || "[]");
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];
  list = list.filter((p) => typeof p === "string");
  if (Array.isArray(tree) && tree.length) {
    list = list.filter((p) => tree.includes(p));
  }
  list = list.filter((p) => !isFolderPlaceholder(p));
  return list;
}

function loadLastOpenFile(projectId, tree) {
  if (!projectId) return null;
  const fp = localStorage.getItem(lastOpenFileKey(projectId)) || "";
  if (!fp) return null;
  if (isFolderPlaceholder(fp)) return null;
  if (Array.isArray(tree) && tree.length && !tree.includes(fp)) return null;
  return fp;
}

function setOpenFiles(list) {
  app.ui.openFiles = list;
  const projectId = app.current.project && app.current.project.id;
  if (!projectId) return;
  localStorage.setItem(openFilesKey(projectId), JSON.stringify(list));
}

function toggleFileSelection(path) {
  if (!path) return;
  if (!app.ui.selectedFiles) app.ui.selectedFiles = new Set();
  if (app.ui.selectedFiles.has(path)) app.ui.selectedFiles.delete(path);
  else app.ui.selectedFiles.add(path);
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();
}

function fileBaseName(filePath) {
  const raw = String(filePath || "");
  if (!raw) return "";
  const parts = raw.split("/");
  return parts[parts.length - 1] || raw;
}

function pickDefaultOpenFile(tree, mainFile) {
  const list = Array.isArray(tree) ? tree.filter((f) => f.endsWith(".tex")) : [];
  if (mainFile && list.includes(mainFile)) return mainFile;
  if (list.length) return list[0];
  return null;
}

function sortedChildren(node) {
  const items = Array.from(node.children.values());
  items.sort((a, b) => {
    const ao = typeof a.order === "number" ? a.order : null;
    const bo = typeof b.order === "number" ? b.order : null;
    if (ao !== null || bo !== null) {
      const av = ao === null ? 9999 : ao;
      const bv = bo === null ? 9999 : bo;
      if (av !== bv) return av - bv;
    }
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

function pickColor(name) {
  const palette = [
    { color: "#2f81f7", light: "#2f81f733" },
    { color: "#2ea043", light: "#2ea04333" },
    { color: "#d29922", light: "#d2992233" },
    { color: "#f85149", light: "#f8514933" },
    { color: "#a371f7", light: "#a371f733" },
    { color: "#79c0ff", light: "#79c0ff33" },
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

const autoCompileStored = localStorage.getItem("ct_autoCompile");
const autoCompileDefault = autoCompileStored === null ? true : autoCompileStored === "1";
const layoutStored = localStorage.getItem("ct_layout_mode");
if (layoutStored && layoutStored !== "balanced") localStorage.setItem("ct_layout_mode", "balanced");
const panelDockStored = localStorage.getItem("ct_panel_dock");
if (panelDockStored && panelDockStored !== "right") localStorage.setItem("ct_panel_dock", "right");
const floatStored = localStorage.getItem("ct_float_right");
if (floatStored && floatStored !== "0") localStorage.setItem("ct_float_right", "0");

const app = {
  me: null,
  projects: [],
  view: "loading", // loading|login|projects|project
  current: {
    project: null,
    tree: [],
    mainFile: "main.tex",
    compiler: "pdflatex",
    openFile: null,
    artifacts: null,
    lastLog: "",
    outline: [],
  },
  ui: {
    openFolders: new Set([""]),
    groupTreeInit: false,
    templates: [],
    templatesLoaded: false,
    projectFilter: localStorage.getItem("ct_project_filter") || "",
    projectCategory: localStorage.getItem("ct_project_category") || "all",
    projectScope: localStorage.getItem("ct_project_scope") || "mine",
    projectView: localStorage.getItem("ct_project_view") || "list",
    leftRailMode: localStorage.getItem("ct_left_rail_mode") || "files",
    leftPaneTab: localStorage.getItem("ct_left_pane_tab") || "files",
    dropdownOpen: "",
    switchError: "",
    importError: "",
    projectRenameId: "",
    projectDeleteArmed: "",
    authError: "",
    loadError: "",
    loadErrorDetail: "",
    guestMode: false,
    autoCompile: autoCompileDefault,
    autoCompileDirty: false,
    autoCompileDirtyAt: 0,
    lastAutoCompileAt: 0,
    lastEditAt: 0,
    autoCompileReady: false,
    autoCompileArmTimer: null,
    autoSyncPdf: localStorage.getItem("ct_autoSyncPdf") !== "0",
    rightTab: "pdf",
    selectRightTab: null,
    fileFilter: "",
    fileMultiSelect: false,
    selectedFiles: new Set(),
    openFiles: [],
    pinnedFiles: [],
    fileView: localStorage.getItem("ct_fileView") === "focus" ? "focus" : "all",
    pendingOpenFile: null,
    pdfTargetFile: null,
    pdfPage: null,
    pdfZoom: localStorage.getItem("ct_pdfZoom") || "page-width",
    pdfTs: null,
    pdfDoc: null,
    pdfDocUrl: "",
    pdfLoadingTask: null,
    pdfRenderTask: null,
    pdfPageCount: 0,
    pdfScale: 1,
    pdfPageHeights: {},
    pdfPageWidths: {},
    pdfViewports: {},
    pdfRenderTasks: [],
    pdfRenderToken: 0,
    pdfPageOffsets: [],
    pdfWorkerReady: false,
    pdfMarker: null,
    pdfMarkerFocus: false,
    pdfMarkerPulse: false,
    refreshFileTree: null,
    refreshFileTabs: null,
    lang: getLang(),
    wsUrlOverride: localStorage.getItem("ct_ws_url") || "",
    collabBackoffUntil: 0,
    collabFailStreak: 0,
    compileOverview: null,
    monitorTimer: null,
    monitorLast: 0,
    historyEntries: [],
    historyFile: null,
    historyLoading: false,
    refreshHistory: null,
    historyHashByFile: {},
    historyLastSnapAt: {},
    historyError: "",
    editorReadable: localStorage.getItem("ct_editor_readable") === "1",
    typewriterMode: localStorage.getItem("ct_typewriter") === "1",
    editorFontSize: clampNumber(localStorage.getItem("ct_editor_font_size"), 11, 22, 14.5),
    editorLineHeight: clampNumber(localStorage.getItem("ct_editor_line_height"), 1.2, 2.4, 1.7),
    editorPadY: clampNumber(localStorage.getItem("ct_editor_pad_y"), 8, 32, 14),
    editorPadX: clampNumber(localStorage.getItem("ct_editor_pad_x"), 8, 32, 14),
    treeDensity: localStorage.getItem("ct_tree_density") || "comfortable",
    focusMode: false,
    autoJumpError: localStorage.getItem("ct_auto_jump_error") === "1",
    theme: localStorage.getItem("ct_theme") || "default",
    labelCache: {},
    bibKeyCache: { projectId: "", keys: [], byFile: {}, updatedAt: 0 },
    layoutMode: "balanced",
    floatRightPane: false,
    splitAuto: localStorage.getItem("ct_split_auto") !== "0",
    leftRatio: parseFloat(localStorage.getItem("ct_left_ratio") || ""),
    rightRatio: parseFloat(localStorage.getItem("ct_right_ratio") || ""),
    leftCollapsed: localStorage.getItem("ct_left_collapsed") === "1",
    toolbarCollapsed: localStorage.getItem("ct_toolbar_collapsed") !== "0",
    bottomConsole: localStorage.getItem("ct_bottom_console") !== "0",
    bottomMode: localStorage.getItem("ct_bottom_mode") || "terminal",
    bottomTerminalLog: "",
    bottomHistory: [],
    bottomHistoryIndex: -1,
    bottomH: clampNumber(localStorage.getItem("ct_bottom_console_h"), 120, 420, 180),
    panelDock: "right",
    dockH: clampNumber(localStorage.getItem("ct_panel_dock_h"), 160, 420, 220),
    floatX: clampNumber(localStorage.getItem("ct_float_x"), 0, 4000, 0),
    floatY: clampNumber(localStorage.getItem("ct_float_y"), 0, 4000, 0),
    resizeObserver: null,
    resizeObserverEl: null,
  },
  editor: { provider: null, ydoc: null, view: null, cleanup: null },
  compile: {
    inFlight: false,
    pending: false,
    pendingClean: false,
    pendingMode: "full",
    pendingOrigin: "manual",
    status: "idle",
    diagnostics: [],
    es: null,
    mainRepairTriedAt: 0,
    lastHeuristicFixAt: 0,
    stage: "",
    lastQueueMs: 0,
    lastDurationMs: 0,
    lastMode: "",
    lastEngine: "",
    lastFinishedAt: "",
  },
  modal: null,
};

// Simple resizable split panes (Overleaf-like).
app.ui.leftW = clampNumber(localStorage.getItem("ct_leftW"), 180, 520, 200);
app.ui.rightW = clampNumber(localStorage.getItem("ct_rightW"), 360, 900, 600);
app.ui.rightTab = localStorage.getItem("ct_rightTab") || "pdf";
{
  const base = Math.max(640, window.innerWidth || 0);
  if (!Number.isFinite(app.ui.leftRatio)) app.ui.leftRatio = app.ui.leftW / base;
  if (!Number.isFinite(app.ui.rightRatio)) app.ui.rightRatio = app.ui.rightW / base;
  localStorage.setItem("ct_left_ratio", String(app.ui.leftRatio));
  localStorage.setItem("ct_right_ratio", String(app.ui.rightRatio));
}
function applySplitVars() {
  normalizeSplitWidths();
  document.documentElement.style.setProperty("--leftW", `${app.ui.leftW}px`);
  document.documentElement.style.setProperty("--rightW", `${app.ui.rightW}px`);
  document.documentElement.style.setProperty("--bottomH", `${app.ui.bottomH}px`);
  document.documentElement.style.setProperty("--dockH", `${app.ui.dockH}px`);
}

function updateSplitRatios() {
  const w = Math.max(640, window.innerWidth || 0);
  const minLeft = 180;
  const minRight = 360;
  const maxLeft = Math.min(520, Math.max(minLeft, Math.floor(w * 0.35)));
  const maxRight = Math.min(900, Math.max(minRight, Math.floor(w * 0.45)));
  const left = clampNumber(app.ui.leftW, minLeft, maxLeft, 200);
  const right = clampNumber(app.ui.rightW, minRight, maxRight, 600);
  app.ui.leftRatio = clampNumber(left / w, minLeft / w, maxLeft / w, app.ui.leftRatio || left / w);
  app.ui.rightRatio = clampNumber(right / w, minRight / w, maxRight / w, app.ui.rightRatio || right / w);
  localStorage.setItem("ct_left_ratio", String(app.ui.leftRatio));
  localStorage.setItem("ct_right_ratio", String(app.ui.rightRatio));
}

function normalizeSplitWidths() {
  const w = Math.max(640, window.innerWidth || 0);
  const minLeft = 180;
  const minRight = 300;
  const minEditor = 320;
  const maxLeft = Math.min(520, Math.max(minLeft, Math.floor(w * 0.35)));
  const maxRight = Math.min(760, Math.max(minRight, Math.floor(w * 0.4)));

  let left = clampNumber(app.ui.leftW, minLeft, maxLeft, 220);
  let right = clampNumber(app.ui.rightW, minRight, maxRight, 520);
  if (app.ui.splitAuto) {
    const leftRatio = Number.isFinite(app.ui.leftRatio) ? app.ui.leftRatio : left / w;
    const rightRatio = Number.isFinite(app.ui.rightRatio) ? app.ui.rightRatio : right / w;
    left = clampNumber(Math.round(w * leftRatio), minLeft, maxLeft, left);
    right = clampNumber(Math.round(w * rightRatio), minRight, maxRight, right);
  }

  if (app.ui.panelDock !== "bottom") {
    const available = w - minEditor;
    if (left + right > available) {
      let overflow = left + right - available;
      const rightSlack = Math.max(0, right - minRight);
      const reduceRight = Math.min(overflow, rightSlack);
      right -= reduceRight;
      overflow -= reduceRight;
      if (overflow > 0) {
        left = Math.max(minLeft, left - overflow);
      }
    }
  } else {
    const available = w - minEditor;
    if (left > available) left = Math.max(minLeft, available);
  }

  if (left !== app.ui.leftW || right !== app.ui.rightW) {
    app.ui.leftW = left;
    app.ui.rightW = right;
    localStorage.setItem("ct_leftW", String(left));
    localStorage.setItem("ct_rightW", String(right));
    if (app.ui.splitAuto) updateSplitRatios();
  }
}

function resetLayoutSafe() {
  app.ui.focusMode = false;
  app.ui.layoutMode = "balanced";
  app.ui.leftCollapsed = false;
  app.ui.floatRightPane = false;
  app.ui.panelDock = "right";
  app.ui.floatX = 0;
  app.ui.floatY = 0;
  app.ui.leftW = 200;
  app.ui.rightW = 600;
  updateSplitRatios();
  localStorage.setItem("ct_focus_mode", "0");
  localStorage.setItem("ct_layout_mode", "balanced");
  localStorage.setItem("ct_left_collapsed", "0");
  localStorage.setItem("ct_float_right", "0");
  localStorage.setItem("ct_panel_dock", "right");
  localStorage.setItem("ct_float_x", "0");
  localStorage.setItem("ct_float_y", "0");
  localStorage.setItem("ct_leftW", String(app.ui.leftW));
  localStorage.setItem("ct_rightW", String(app.ui.rightW));
  applySplitVars();
  applyLayoutClass();
  updateRightPaneFloat();
  updateTopbarButtons();
  refreshEditorView();
}

function ensureLayoutVisible() {
  const layout = document.getElementById("layoutRoot");
  if (!layout) return;
  const editorPane = document.querySelector(".editor-pane");
  const rightPane = document.getElementById("rightPane");
  if (!editorPane || !rightPane) return;
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 80 && rect.height > 120;
  };
  const editorVisible = isVisible(editorPane);
  const rightVisible = isVisible(rightPane);
  if (!editorVisible && !rightVisible) {
    resetLayoutSafe();
    return;
  }
  if (app.ui.layoutMode === "pdf" && !rightVisible) {
    resetLayoutSafe();
    return;
  }
  if (app.ui.layoutMode !== "pdf" && !editorVisible) {
    resetLayoutSafe();
  }
}

function refreshEditorView() {
  if (app && app.editor && app.editor.view) {
    try { app.editor.view.requestMeasure(); } catch {}
    setTimeout(() => {
      if (app && app.editor && app.editor.view) {
        try { app.editor.view.requestMeasure(); } catch {}
      }
    }, 0);
  }
}

function setLeftCollapsed(next) {
  const wantCollapsed = !!next;
  app.ui.leftCollapsed = wantCollapsed;
  localStorage.setItem("ct_left_collapsed", app.ui.leftCollapsed ? "1" : "0");
  applyLayoutClass();
  updateTopbarButtons();
  const restoreBtn = document.getElementById("sidebarRestoreBtn");
  if (restoreBtn) {
    restoreBtn.classList.toggle("is-hidden", !app.ui.leftCollapsed);
    const title = app.ui.leftCollapsed ? t("打开侧边栏") : t("侧边栏已打开");
    restoreBtn.setAttribute("title", title);
    restoreBtn.setAttribute("aria-label", title);
  }
  refreshEditorView();
}

function toggleLeftPane() {
  setLeftCollapsed(!app.ui.leftCollapsed);
}

function setToolbarCollapsed(next) {
  app.ui.toolbarCollapsed = !!next;
  localStorage.setItem("ct_toolbar_collapsed", app.ui.toolbarCollapsed ? "1" : "0");
  updateToolbarCollapsed();
  refreshEditorView();
}

function setBottomConsole(next) {
  if (next && app.ui.layoutMode === "pdf") setLayoutMode("balanced");
  app.ui.bottomConsole = !!next;
  localStorage.setItem("ct_bottom_console", app.ui.bottomConsole ? "1" : "0");
  updateBottomConsoleVisibility();
  refreshEditorView();
}

function setBottomMode(mode) {
  const next = mode === "log" ? "log" : "terminal";
  app.ui.bottomMode = next;
  localStorage.setItem("ct_bottom_mode", next);
  updateBottomConsoleMode();
}

function updateBottomConsoleMode() {
  const logEl = document.getElementById("bottomLog");
  if (!logEl) return;
  if (app.ui.bottomMode === "log") {
    logEl.textContent = app.current.lastLog || "";
  } else {
    logEl.textContent = app.ui.bottomTerminalLog || "";
  }
  const termBtn = document.getElementById("bottomModeTerm");
  const logBtn = document.getElementById("bottomModeLog");
  if (termBtn) termBtn.classList.toggle("active", app.ui.bottomMode === "terminal");
  if (logBtn) logBtn.classList.toggle("active", app.ui.bottomMode === "log");
}

function appendBottomTerminal(text) {
  const line = String(text || "");
  app.ui.bottomTerminalLog = `${app.ui.bottomTerminalLog || ""}${line}\n`;
  if (app.ui.bottomTerminalLog.length > 200000) {
    app.ui.bottomTerminalLog = app.ui.bottomTerminalLog.slice(-200000);
  }
  if (app.ui.bottomMode !== "terminal") return;
  const logEl = document.getElementById("bottomLog");
  if (!logEl) return;
  logEl.textContent = app.ui.bottomTerminalLog;
  logEl.scrollTop = logEl.scrollHeight;
}

function clearBottomTerminal() {
  app.ui.bottomTerminalLog = "";
  if (app.ui.bottomMode === "terminal") {
    const logEl = document.getElementById("bottomLog");
    if (logEl) logEl.textContent = "";
  }
}

function setPanelDock(next) {
  const mode = next === "bottom" ? "bottom" : "right";
  app.ui.panelDock = mode;
  localStorage.setItem("ct_panel_dock", mode);
  if (app.ui.layoutMode !== "balanced") {
    app.ui.layoutMode = "balanced";
    localStorage.setItem("ct_layout_mode", "balanced");
  }
  app.ui.floatRightPane = false;
  localStorage.setItem("ct_float_right", "0");
  applyLayoutClass();
  updateRightPaneFloat();
  updateTopbarButtons();
  refreshEditorView();
}

function computeLayoutClass() {
  return [
    "layout",
    app.ui.focusMode ? "focus-mode" : "",
    app.ui.layoutMode && app.ui.layoutMode !== "balanced" ? `layout-${app.ui.layoutMode}` : "",
    app.ui.floatRightPane ? "layout-float-right" : "",
    app.ui.layoutMode === "balanced" && app.ui.leftCollapsed ? "layout-left-collapsed" : "",
    app.ui.layoutMode === "balanced" && app.ui.panelDock === "bottom" ? "dock-bottom" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function applyLayoutClass() {
  const layout = document.getElementById("layoutRoot");
  if (!layout) return;
  layout.className = computeLayoutClass();
}

function updateTopbarButtons() {
  const sidebarBtn = document.getElementById("toggleSidebarBtn");
  if (sidebarBtn) {
    const label = app.ui.leftCollapsed ? t("显示侧栏") : t("隐藏侧栏");
    sidebarBtn.setAttribute("title", label);
    sidebarBtn.setAttribute("aria-label", label);
    if (!sidebarBtn.querySelector("svg") && !sidebarBtn.querySelector(".icon")) {
      sidebarBtn.textContent = label;
    }
    sidebarBtn.classList.toggle("active", !app.ui.leftCollapsed);
  }
  const layoutBtn = document.getElementById("layoutCycleBtn");
  if (layoutBtn) {
    layoutBtn.textContent =
      app.ui.layoutMode === "editor"
        ? t("写作视图")
        : app.ui.layoutMode === "pdf"
          ? t("预览视图")
          : t("三栏视图");
  }
  const focusBtn = document.getElementById("focusModeBtn");
  if (focusBtn) focusBtn.textContent = app.ui.focusMode ? t("退出专注") : t("专注写作");
}

function updateToolbarCollapsed() {
  const toolbar = document.getElementById("editorToolbar");
  if (toolbar) toolbar.classList.toggle("compact", app.ui.toolbarCollapsed);
  const toggleBtn = document.getElementById("toolbarToggleBtn");
  if (toggleBtn) toggleBtn.textContent = app.ui.toolbarCollapsed ? t("更多") : t("收起");
}

function updateBottomConsoleVisibility() {
  const panel = document.getElementById("bottomConsole");
  const gutter = document.getElementById("bottomGutter");
  const collapsed = document.getElementById("bottomCollapsed");
  if (panel) panel.style.display = app.ui.bottomConsole ? "" : "none";
  if (gutter) gutter.style.display = app.ui.bottomConsole ? "" : "none";
  if (collapsed) collapsed.style.display = app.ui.bottomConsole ? "none" : "";
  updateBottomConsoleMode();
}

function updateRightPaneFloat() {
  const pane = document.getElementById("rightPane");
  if (!pane) return;
  pane.classList.toggle("float", app.ui.floatRightPane);
  if (app.ui.floatRightPane) {
    const rect = pane.getBoundingClientRect();
    const width = rect.width || 680;
    const height = rect.height || 520;
    if (!app.ui.floatX && !app.ui.floatY) {
      app.ui.floatX = Math.max(12, window.innerWidth - width - 16);
      app.ui.floatY = Math.max(12, (window.innerHeight - height) * 0.08 + 12);
    }
    const maxX = Math.max(12, window.innerWidth - width - 12);
    const maxY = Math.max(12, window.innerHeight - height - 12);
    app.ui.floatX = clampNumber(app.ui.floatX, 12, maxX, maxX);
    app.ui.floatY = clampNumber(app.ui.floatY, 12, maxY, maxY);
    localStorage.setItem("ct_float_x", String(app.ui.floatX));
    localStorage.setItem("ct_float_y", String(app.ui.floatY));
    pane.style.left = `${app.ui.floatX}px`;
    pane.style.top = `${app.ui.floatY}px`;
    pane.style.right = "auto";
  } else {
    pane.style.left = "";
    pane.style.top = "";
    pane.style.right = "";
  }
}

function setLang(next) {
  const lang = setI18nLang(next);
  if (app.ui) app.ui.lang = lang;
  mount(render());
}

function toggleLang() {
  setLang(getLang() === "zh" ? "en" : "zh");
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.classList.remove("theme-vscode-dark", "theme-vscode-light");
  if (theme === "vscode-dark") root.classList.add("theme-vscode-dark");
  if (theme === "vscode-light") root.classList.add("theme-vscode-light");
}

function applyEditorPrefs() {
  const root = document.documentElement;
  const readable = app && app.ui && app.ui.editorReadable;
  root.classList.toggle("editor-readable", !!readable);
  if (app && app.ui) {
    root.style.setProperty("--editor-font-size", `${app.ui.editorFontSize}px`);
    root.style.setProperty("--editor-line-height", String(app.ui.editorLineHeight));
    root.style.setProperty("--editor-pad-y", `${app.ui.editorPadY}px`);
    root.style.setProperty("--editor-pad-x", `${app.ui.editorPadX}px`);
    root.classList.toggle("tree-compact", app.ui.treeDensity === "compact");
  }
}

function setTheme(next) {
  const tval = next || "default";
  app.ui.theme = tval;
  localStorage.setItem("ct_theme", tval);
  applyTheme(tval);
}

function setEditorReadable(next) {
  app.ui.editorReadable = !!next;
  localStorage.setItem("ct_editor_readable", app.ui.editorReadable ? "1" : "0");
  applyEditorPrefs();
}

function setTypewriterMode(next) {
  app.ui.typewriterMode = !!next;
  localStorage.setItem("ct_typewriter", app.ui.typewriterMode ? "1" : "0");
}

function setEditorFontSize(next) {
  const val = clampNumber(next, 11, 22, 13.5);
  app.ui.editorFontSize = val;
  localStorage.setItem("ct_editor_font_size", String(val));
  applyEditorPrefs();
}

function setEditorLineHeight(next) {
  const val = clampNumber(next, 1.2, 2.4, 1.65);
  app.ui.editorLineHeight = val;
  localStorage.setItem("ct_editor_line_height", String(val));
  applyEditorPrefs();
}

function setEditorPaddingY(next) {
  const val = clampNumber(next, 8, 32, 18);
  app.ui.editorPadY = val;
  localStorage.setItem("ct_editor_pad_y", String(val));
  applyEditorPrefs();
}

function setEditorPaddingX(next) {
  const val = clampNumber(next, 8, 32, 16);
  app.ui.editorPadX = val;
  localStorage.setItem("ct_editor_pad_x", String(val));
  applyEditorPrefs();
}

function setTreeDensity(next) {
  const mode = next === "compact" ? "compact" : "comfortable";
  app.ui.treeDensity = mode;
  localStorage.setItem("ct_tree_density", mode);
  applyEditorPrefs();
}

function setFocusMode(next) {
  app.ui.focusMode = !!next;
  localStorage.setItem("ct_focus_mode", app.ui.focusMode ? "1" : "0");
  applyLayoutClass();
  updateTopbarButtons();
  refreshEditorView();
}

function toggleFocusMode() {
  setFocusMode(!app.ui.focusMode);
}

function setLayoutMode(next) {
  const mode = next === "editor" || next === "pdf" ? next : "balanced";
  app.ui.layoutMode = mode;
  localStorage.setItem("ct_layout_mode", mode);
  applyLayoutClass();
  updateTopbarButtons();
  if (mode === "pdf" && app.ui.selectRightTab) app.ui.selectRightTab("pdf");
  refreshEditorView();
}

function toggleLayoutMode(mode) {
  if (app.ui.layoutMode === mode) setLayoutMode("balanced");
  else setLayoutMode(mode);
}

function cycleLayoutMode() {
  const modes = ["balanced", "editor", "pdf"];
  const current = app.ui.layoutMode || "balanced";
  const idx = modes.indexOf(current);
  const next = modes[(idx + 1) % modes.length];
  setLayoutMode(next);
}

function setFloatRightPane(next) {
  app.ui.floatRightPane = !!next;
  localStorage.setItem("ct_float_right", app.ui.floatRightPane ? "1" : "0");
  applyLayoutClass();
  updateRightPaneFloat();
  if (app.current.project && app.ui.rightTab === "pdf") {
    renderPdfPages({ projectId: app.current.project.id }).catch(() => {});
  }
  refreshEditorView();
}

function setAutoJumpError(next) {
  app.ui.autoJumpError = !!next;
  localStorage.setItem("ct_auto_jump_error", app.ui.autoJumpError ? "1" : "0");
}

function setWsUrlOverride(value) {
  const v = (value || "").trim();
  if (!v) {
    localStorage.removeItem("ct_ws_url");
    if (app.ui) app.ui.wsUrlOverride = "";
    return;
  }
  localStorage.setItem("ct_ws_url", v);
  if (app.ui) app.ui.wsUrlOverride = v;
}

function setFileView(view) {
  const v = view === "focus" ? "focus" : "all";
  if (app.ui.fileView === v) return;
  app.ui.fileView = v;
  localStorage.setItem("ct_fileView", v);
  if (!app.ui.openFolders || !(app.ui.openFolders instanceof Set)) app.ui.openFolders = new Set([""]);
  app.ui.openFolders.add("");
  if (v !== "all") app.ui.groupTreeInit = false;
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();
}

function startDrag(which, ev) {
  ev.preventDefault();
  if (which === "right" && app.ui.panelDock === "bottom") {
    startDockDrag(ev);
    return;
  }
  const startX = ev.clientX;
  const startLeft = app.ui.leftW;
  const startRight = app.ui.rightW;

  const onMove = (e) => {
    const dx = e.clientX - startX;
    if (which === "left") {
      app.ui.leftW = Math.max(180, Math.min(520, startLeft + dx));
      localStorage.setItem("ct_leftW", String(app.ui.leftW));
    } else {
      app.ui.rightW = Math.max(360, Math.min(900, startRight - dx));
      localStorage.setItem("ct_rightW", String(app.ui.rightW));
    }
    applySplitVars();
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    if (app.ui.splitAuto) updateSplitRatios();
    if (app.current.project && app.ui.rightTab === "pdf") {
      renderPdfPages({ projectId: app.current.project.id }).catch(() => {});
    }
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function startDockDrag(ev) {
  ev.preventDefault();
  const startY = ev.clientY;
  const startH = app.ui.dockH;
  const maxH = Math.max(180, Math.floor(window.innerHeight * 0.6));

  const onMove = (e) => {
    const dy = startY - e.clientY;
    app.ui.dockH = Math.max(160, Math.min(maxH, startH + dy));
    localStorage.setItem("ct_panel_dock_h", String(app.ui.dockH));
    applySplitVars();
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function startBottomDrag(ev) {
  ev.preventDefault();
  const startY = ev.clientY;
  const startH = app.ui.bottomH;
  const maxH = Math.max(160, Math.floor(window.innerHeight * 0.6));

  const onMove = (e) => {
    const dy = startY - e.clientY;
    app.ui.bottomH = Math.max(120, Math.min(maxH, startH + dy));
    localStorage.setItem("ct_bottom_console_h", String(app.ui.bottomH));
    applySplitVars();
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

let dockOverlayEl = null;
function ensureDockOverlay() {
  if (dockOverlayEl) return dockOverlayEl;
  const overlay = document.createElement("div");
  overlay.id = "dockOverlay";
  overlay.className = "dock-overlay";
  const right = document.createElement("div");
  right.className = "dock-zone right";
  right.dataset.zone = "right";
  const bottom = document.createElement("div");
  bottom.className = "dock-zone bottom";
  bottom.dataset.zone = "bottom";
  overlay.appendChild(right);
  overlay.appendChild(bottom);
  document.body.appendChild(overlay);
  dockOverlayEl = overlay;
  return overlay;
}

function showDockOverlay() {
  const el = ensureDockOverlay();
  el.classList.add("show");
}

function hideDockOverlay() {
  if (!dockOverlayEl) return;
  dockOverlayEl.classList.remove("show");
  const active = dockOverlayEl.querySelectorAll(".dock-zone.active");
  active.forEach((node) => node.classList.remove("active"));
}

function updateDockOverlay(x, y) {
  const el = ensureDockOverlay();
  const right = el.querySelector(".dock-zone.right");
  const bottom = el.querySelector(".dock-zone.bottom");
  const inBottom = y > window.innerHeight * 0.72;
  const inRight = x > window.innerWidth * 0.72;
  let zone = "";
  if (inBottom) zone = "bottom";
  else if (inRight) zone = "right";
  if (right) right.classList.toggle("active", zone === "right");
  if (bottom) bottom.classList.toggle("active", zone === "bottom");
  return zone;
}

function startFloatDrag(ev) {
  if (!app.ui.floatRightPane) return;
  if (ev.button !== 0) return;
  if (ev.target && ev.target.closest && ev.target.closest("button,input,select,label")) return;
  const pane = document.getElementById("rightPane");
  if (!pane) return;
  ev.preventDefault();
  const rect = pane.getBoundingClientRect();
  const offsetX = ev.clientX - rect.left;
  const offsetY = ev.clientY - rect.top;
  showDockOverlay();

  let lastY = ev.clientY;
  let lastX = ev.clientX;
  const onMove = (e) => {
    lastY = e.clientY;
    lastX = e.clientX;
    const maxX = Math.max(8, window.innerWidth - rect.width - 8);
    const maxY = Math.max(8, window.innerHeight - rect.height - 8);
    let x = e.clientX - offsetX;
    let y = e.clientY - offsetY;
    x = Math.max(8, Math.min(maxX, x));
    y = Math.max(8, Math.min(maxY, y));
    app.ui.floatX = x;
    app.ui.floatY = y;
    pane.style.left = `${x}px`;
    pane.style.top = `${y}px`;
    updateDockOverlay(e.clientX, e.clientY);
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    localStorage.setItem("ct_float_x", String(app.ui.floatX));
    localStorage.setItem("ct_float_y", String(app.ui.floatY));
    if (app.ui.floatRightPane) {
      const zone = updateDockOverlay(lastX, lastY);
      if (zone === "bottom") {
        setPanelDock("bottom");
      } else if (zone === "right") {
        setPanelDock("right");
      }
    }
    hideDockOverlay();
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function cleanupEditor() {
  if (app.editor.cleanup) app.editor.cleanup();
  app.editor.cleanup = null;
  if (app.editor.view) app.editor.view.destroy();
  app.editor.view = null;
  if (app.editor.provider) app.editor.provider.destroy();
  app.editor.provider = null;
  if (app.editor.ydoc) app.editor.ydoc.destroy();
  app.editor.ydoc = null;
  app.editor.syncStatus = null;
  lastPdfSyncKey = "";
  pdfSyncInFlight = false;
  pdfSyncPending = false;
  pdfSyncBlockUntil = 0;
  pdfSyncLastFailureKey = "";
  if (app.ui.autoCompileArmTimer) {
    clearTimeout(app.ui.autoCompileArmTimer);
    app.ui.autoCompileArmTimer = null;
  }
}

let flashTimer = null;
function flashEditorLine(view, lineNumber) {
  if (!view) return;
  const ln = Math.max(1, Number(lineNumber || 1));
  const line = view.state.doc.line(Math.min(ln, view.state.doc.lines));
  try {
    view.dispatch({ effects: flashLineEffect.of(line.from) });
  } catch {
    return;
  }
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    try {
      view.dispatch({ effects: clearFlashLineEffect.of(null) });
    } catch {
      // ignore
    }
  }, 900);
}

function trackOpenFile(filePath) {
  const list = Array.isArray(app.ui.openFiles) ? app.ui.openFiles : [];
  const next = [filePath, ...list.filter((p) => p !== filePath)].slice(0, 7);
  setOpenFiles(next);
  const projectId = app.current.project && app.current.project.id;
  if (projectId) localStorage.setItem(lastOpenFileKey(projectId), filePath);
}

const docStatsCache = createDocStatsCache({ maxChars: 1_500_000 });
let lastPdfSyncKey = "";
let pdfSyncInFlight = false;
let pdfSyncPending = false;
let pdfSyncBlockUntil = 0;
let pdfSyncLastFailureKey = "";

let outlineTimer = null;
let outlineDoc = null;
let statusTimer = null;

function outlineNodes() {
  if (!app.current.openFile) {
    return [h("div", { class: "hint", html: t("打开文件查看大纲。") })];
  }

  if (!app.current.outline || app.current.outline.length === 0) {
    return [h("div", { class: "hint", html: t("(未找到章节)") })];
  }

  return app.current.outline.map((item) => {
    const row = h("button", {
      class: "outline-item",
      style: `padding-left:${12 + item.level * 12}px`,
      onclick: async () => {
        await openFileAt(app.current.openFile, item.line);
      },
    });
    row.appendChild(h("span", { class: "outline-kind", html: item.kind.replace("sub", "sub ") }));
    row.appendChild(h("span", { class: "outline-title", html: item.title }));
    return row;
  });
}

function renderOutlineList() {
  const host = document.getElementById("outlineList");
  if (!host) return;
  host.innerHTML = "";
  for (const node of outlineNodes()) host.appendChild(node);
}

function updateOutlineFromText(text) {
  const parsed = extractOutline(text, { maxChars: 1_500_000 });
  if (!parsed || !Array.isArray(parsed.items)) return;
  if (sameOutline(app.current.outline, parsed.items)) return;
  app.current.outline = parsed.items;
  renderOutlineList();
}

function scheduleOutline(docOrText) {
  outlineDoc = docOrText;
  if (outlineTimer) clearTimeout(outlineTimer);
  outlineTimer = setTimeout(() => {
    outlineTimer = null;
    updateOutlineFromText(outlineDoc);
  }, 240);
}

function updateEditorStatus(view) {
  const host = document.getElementById("editorStatus");
  if (!host) return;
  host.innerHTML = "";
  if (!view) {
    host.appendChild(h("span", { class: "hint", html: t("打开文件开始编辑。") }));
    return;
  }

  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const line = doc.lineAt(sel.head);
  const col = sel.head - line.from + 1;
  const stats = docStatsCache.get(doc);
  const words = stats.words;
  const chars = stats.chars;
  const selChars = sel.empty ? 0 : sel.to - sel.from;

  const item = (label, value) =>
    h("span", { class: "status-item" }, [
      h("span", { class: "status-label", html: label }),
      h("span", { class: "status-value", html: String(value) }),
    ]);

  host.appendChild(item(t("行"), line.number));
  host.appendChild(item(t("列"), col));
  host.appendChild(item(t("词"), words));
  host.appendChild(item(t("字"), chars));
  if (selChars) host.appendChild(item(t("选"), selChars));

  if (app.editor.syncStatus) {
    const syncMap = {
      connecting: t("连接中"),
      connected: t("已连接"),
      disconnected: t("已断开"),
      local: t("本地模式"),
    };
    const label = syncMap[app.editor.syncStatus] || app.editor.syncStatus;
    const pill = h("span", {
      class: "status-pill",
      "data-status": app.editor.syncStatus,
      html: `${t("协作")}:${label}`,
    });
    host.appendChild(pill);
  }
}

function setEditorError(message) {
  const host = document.getElementById("editorStatus");
  if (!host) return;
  host.innerHTML = "";
  host.appendChild(h("span", {
    class: "hint error",
    html: t("文件打开失败: {msg}", { msg: String(message || "unknown") }),
  }));
}

function scheduleStatus(view) {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusTimer = null;
    updateEditorStatus(view);
  }, 200);
}

function isNetworkError(err) {
  if (!err) return false;
  if (err.status === 0) return true;
  if (err.name === "TypeError") return true;
  const msg = String(err.message || err).toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("network") || msg.includes("timeout");
}

function setLoadError(err, context = t("无法连接到服务器")) {
  const detail = err && err.message ? err.message : String(err || "");
  app.ui.loadError = context;
  app.ui.loadErrorDetail = detail && detail !== context ? detail : "";
  app.view = "loading";
  mount(render());
}

async function loadMe() {
  const me = await api("/api/me");
  app.me = me && me.authenticated ? me : null;
  if (app.me && app.ui) app.ui.guestMode = false;
  if (me && me.token) localStorage.setItem("ct_session_token", me.token);
}

function enterGuestMode() {
  if (!app || !app.ui) return;
  app.ui.guestMode = true;
  app.me = { username: t("临时用户"), isAdmin: false, authenticated: false, guest: true };
  app.projects = [];
  app.view = "projects";
}

async function tryAutoLogin() {
  const stored = String(localStorage.getItem("ct_last_user") || "").trim();
  const candidates = [];
  if (stored) candidates.push(stored);
  if (!candidates.includes("admin")) candidates.push("admin");
  const passCandidates = [];
  const storedPass = String(localStorage.getItem("ct_admin_password") || "").trim();
  if (storedPass) passCandidates.push(storedPass);
  if (!passCandidates.includes("ChangeMe!2026")) passCandidates.push("ChangeMe!2026");
  if (!passCandidates.includes("admin")) passCandidates.push("admin");
  for (const username of candidates) {
    for (const password of passCandidates) {
      try {
        const loginRes = await api("/api/login", {
          method: "POST",
          body: JSON.stringify({ username, password }),
          timeoutMs: 5000,
        });
        if (loginRes && loginRes.token) localStorage.setItem("ct_session_token", loginRes.token);
        localStorage.setItem("ct_last_user", username);
        return true;
      } catch (err) {
        if (isNetworkError(err)) throw err;
        // try next password
      }
    }
  }
  return false;
}

async function loadProjects() {
  if (app && app.ui && app.ui.guestMode) {
    app.projects = [];
    return;
  }
  if (app && app.ui && !app.ui.templatesLoaded) {
    try {
      const tpl = await api("/api/templates");
      if (tpl && Array.isArray(tpl.templates)) app.ui.templates = tpl.templates;
    } catch {
      // ignore template load errors
    }
    app.ui.templatesLoaded = true;
  }
  const res = await api("/api/projects");
  app.projects = res.projects;
}

async function loadProject(projectId, { resetTab = false } = {}) {
  docStatsCache.clear();
  lastPdfSyncKey = "";
  const res = await api(`/api/projects/${projectId}/tree`);
  app.current.project = app.projects.find((p) => p.id === projectId) || { id: projectId, name: projectId };
  app.current.tree = res.tree;
  app.current.mainFile = res.mainFile;
  app.current.compiler = res.compiler || "pdflatex";
  app.ui.labelCache = {};
  app.ui.bibKeyCache = { projectId, keys: [], byFile: {}, updatedAt: 0 };
  refreshBibKeyCache().catch(console.error);
  refreshLabelCache().catch(console.error);
  const storedOpenFiles = loadOpenFiles(projectId, app.current.tree);
  let initOpenFiles = storedOpenFiles;
  if (!initOpenFiles.length) {
    initOpenFiles = await buildSuggestedOpenFiles(projectId, app.current.tree, app.current.mainFile);
  }
  if (initOpenFiles.length) setOpenFiles(initOpenFiles);
  else app.ui.openFiles = [];
  const resolvedTarget = resolvePdfTarget(projectId, app.current.tree, app.current.mainFile);
  app.ui.pdfTargetFile = resolvedTarget;
  if (resolvedTarget && projectId) localStorage.setItem(`ct_pdfTarget_${projectId}`, resolvedTarget);
  app.ui.pdfPage = null;
  app.ui.pdfTs = null;
  app.ui.pdfDoc = null;
  app.ui.pdfDocUrl = "";
  app.ui.pdfPageCount = 0;
  app.ui.compileOverview = null;
  app.ui.monitorLast = 0;
  app.ui.historyEntries = [];
  app.ui.historyFile = null;
  app.ui.historyLoading = false;
  app.ui.historyHashByFile = {};
  app.ui.historyLastSnapAt = {};
  app.ui.historyError = "";
  app.ui.groupTreeInit = false;
  app.ui.pdfPageHeights = {};
  app.ui.pdfPageWidths = {};
  app.ui.pdfViewports = {};
  app.ui.pdfRenderTasks = [];
  app.ui.pdfRenderToken = 0;
  app.ui.pdfMarker = null;
  app.ui.pdfMarkerFocus = false;
  app.ui.pdfMarkerPulse = false;
  if (app.ui.pdfLoadingTask) {
    try { await app.ui.pdfLoadingTask.destroy(); } catch {}
    app.ui.pdfLoadingTask = null;
  }
  if (app.ui.pdfDoc) {
    try { await app.ui.pdfDoc.destroy(); } catch {}
    app.ui.pdfDoc = null;
  }
  app.ui.selectedFiles = new Set();
  app.ui.fileMultiSelect = false;
  if (app.ui.openFiles.length) setOpenFiles(app.ui.openFiles.filter((p) => app.current.tree.includes(p)));
  app.ui.pinnedFiles = loadPinnedFiles(projectId, app.current.tree);
  try {
    app.current.artifacts = await api(`/api/projects/${projectId}/artifacts/status${pdfArtifactQuery(projectId)}`);
  } catch {
    app.current.artifacts = null;
  }
  try {
    if (app.current.artifacts && app.current.artifacts.log && app.current.artifacts.log.exists) {
      app.current.lastLog = await api(`/api/projects/${projectId}/artifacts/log${pdfArtifactQuery(projectId)}`);
    } else {
      app.current.lastLog = "";
    }
  } catch {
    app.current.lastLog = "";
  }
  if (app.current.openFile && !app.current.tree.includes(app.current.openFile)) {
    app.current.openFile = null;
    app.current.outline = [];
  }
  if (resetTab) {
    app.ui.rightTab = "pdf";
    localStorage.setItem("ct_rightTab", "pdf");
  }
  if (resetTab || !app.current.openFile) {
    const preferred =
      initOpenFiles[0] ||
      loadLastOpenFile(projectId, app.current.tree) ||
      pickDefaultOpenFile(app.current.tree, app.current.mainFile) ||
      app.current.mainFile ||
      (Array.isArray(app.current.tree) && app.current.tree.length ? app.current.tree[0] : "");
    if (preferred) app.ui.pendingOpenFile = preferred;
  }
}

async function openProjectById(projectId, { pushHash = true, resetTab = true, seedProject = null } = {}) {
  if (!projectId) return false;
  try {
    cleanupEditor();
    app.view = "project";
    app.current.openFile = null;
    app.ui.openFiles = [];
    app.ui.fileFilter = "";
    app.ui.openFolders = new Set([""]);
    app.current.project = seedProject || app.projects.find((p) => p.id === projectId) || { id: projectId, name: projectId };
    mount(render());

    await loadProject(projectId, { resetTab });
    app.view = "project";
    if (pushHash) history.pushState({}, "", `#project/${projectId}`);
    mount(render());
    return true;
  } catch (e) {
    app.view = "projects";
    const msg = e && e.message ? e.message : String(e);
    alert(`无法打开项目：${msg}`);
    try {
      await loadProjects();
    } catch {
      // ignore recovery reload errors
    }
    mount(render());
    return false;
  }
}

async function handleRoute() {
  const hash = location.hash || "";
  if (hash && hash.startsWith("#project/")) {
    const projectId = hash.slice("#project/".length).trim();
    if (!projectId) return false;
    if (app && app.ui && app.ui.guestMode) {
      app.view = "projects";
      history.replaceState({}, "", "#projects");
      mount(render());
      return true;
    }
    if (app.view === "project" && app.current.project && app.current.project.id === projectId) {
      return true;
    }
    await openProjectById(projectId, { pushHash: false, resetTab: true });
    return true;
  }
  if (!hash || hash === "#" || hash === "#projects") {
    if (app.view !== "projects") {
      app.view = "projects";
      mount(render());
    }
    return true;
  }
  return false;
}

function topbar(title, rightEls) {
  const left = h("div", { class: "topbar-left" }, [
    h("div", { class: "brand", html: "CollabTeX Studio" }),
    h("div", { class: "title", html: title || "" }),
  ]);
  const right = h("div", { class: "topbar-right" }, [...(rightEls || []), langToggleBtn()]);
  return h("div", { class: "topbar" }, [left, right]);
}

function btn(label, { kind = "", onClick, disabled = false, id = null } = {}) {
  const b = h("button", {
    class: `btn ${kind}`.trim(),
    id,
    disabled: disabled ? "" : null,
    onclick: onClick,
  });
  b.textContent = label;
  return b;
}

function langToggleBtn() {
  const label = getLang() === "zh" ? "EN" : "中文";
  return btn(label, { onClick: toggleLang, id: "langToggle" });
}

function input({ placeholder = "", value = "", type = "text", id = null } = {}) {
  return h("input", { class: "input", placeholder, value, type, id });
}

function badge(text) {
  return h("span", { class: "badge", html: text });
}

function sectionTitle(text) {
  return h("div", { class: "section-title", html: text });
}

function closeModal() {
  app.modal = null;
  mount(render());
}

function showModal({ title, bodyEl, actions = [] }) {
  app.modal = { title, bodyEl, actions };
  mount(render());
}

function clearDropdowns() {
  if (!app || !app.ui) return;
  app.ui.dropdownOpen = "";
  app.ui.projectRenameId = "";
  app.ui.projectDeleteArmed = "";
  applyDropdownState();
}

function toggleDropdown(id, ev) {
  if (ev) ev.stopPropagation();
  const next = app.ui.dropdownOpen === id ? "" : id;
  app.ui.dropdownOpen = next;
  if (next === "user") app.ui.switchError = "";
  if (!next || !next.startsWith("project:")) {
    app.ui.projectDeleteArmed = "";
    app.ui.projectRenameId = "";
  }
  if (next.startsWith("project:") && app.ui.projectDeleteArmed && next !== `project:${app.ui.projectDeleteArmed}`) {
    app.ui.projectDeleteArmed = "";
  }
  if (next.startsWith("project:") && app.ui.projectRenameId && next !== `project:${app.ui.projectRenameId}`) {
    app.ui.projectRenameId = "";
  }
  applyDropdownState();
}

function dropdownMenu(id, body) {
  return h("div", { class: "dropdown-menu", onclick: (ev) => ev.stopPropagation() }, [body]);
}

function applyDropdownState() {
  if (!app || !app.ui) return;
  const open = app.ui.dropdownOpen || "";
  const dropdowns = document.querySelectorAll(".dropdown[data-dropdown-id]");
  dropdowns.forEach((el) => {
    const id = el.getAttribute("data-dropdown-id") || "";
    if (open && id === open) el.setAttribute("data-open", "1");
    else el.removeAttribute("data-open");
  });
}

function buildProjectSettingsPanel(project, { onDelete } = {}) {
  return buildProjectSettingsPanelView(project, {
    input,
    app,
    h,
    t,
    btn,
    api,
    loadProjects,
    clearDropdowns,
    mount,
    render,
  }, { onDelete });
}
async function openFile(filePath) {
  const editorVendor = await loadEditorVendor();
  return openFileSession(filePath, {
    app,
    document,
    window,
    localStorage,
    mount,
    render,
    t,
    h,
    fileBaseName,
    flashEditorLine,
    isFolderPlaceholder,
    isAssetFile,
    setLayoutMode,
    trackOpenFile,
    cleanupEditor,
    scheduleCompile,
    scheduleOutline,
    scheduleStatus,
    scheduleHistorySnapshot,
    schedulePdfSync,
    updateOutlineFromText,
    updateDocCaches,
    updateEditorStatus,
    loadHistory,
    readTextForWork,
    hashText,
    api,
    wsUrl,
    pickColor,
    ...editorVendor,
    imageCompletionSource,
    latexCompletionSource,
    latexFoldService,
    flashLineField,
    setTimeout,
    clearTimeout,
    requestAnimationFrame,
    cancelAnimationFrame,
  });
}

async function openFileAt(filePath, line, { skipPdfSync = false } = {}) {
  if (filePath === app.current.openFile && app.editor.view) {
    const view = app.editor.view;
    const ln = Math.max(1, Number(line || 1));
    const pos = view.state.doc.line(Math.min(ln, view.state.doc.lines)).from;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
    flashEditorLine(view, ln);
    if (app.ui.autoSyncPdf && !skipPdfSync) schedulePdfSync();
    return;
  }
  await openFile(filePath);
  // Wait a tick for the editor to mount.
  setTimeout(() => {
    const view = app.editor.view;
    if (!view) return;
    const ln = Math.max(1, Number(line || 1));
    const pos = view.state.doc.line(Math.min(ln, view.state.doc.lines)).from;
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    view.focus();
    flashEditorLine(view, ln);
    if (app.ui.autoSyncPdf && !skipPdfSync) schedulePdfSync();
  }, 0);
}

async function syncPdfToCursor({ silent = false } = {}) {
  if (!app.current.project || !app.current.openFile) {
    alert(t("请先打开文件。"));
    return;
  }
  const view = app.editor.view;
  if (!view) {
    alert(t("请先打开文件。"));
    return;
  }

  if (silent) {
    const openLower = String(app.current.openFile || "").toLowerCase();
    if (!openLower.endsWith(".tex")) return;
    const hasPdfReady = !!(
      (app.current.artifacts && app.current.artifacts.pdf && app.current.artifacts.pdf.exists) ||
      app.ui.pdfDoc ||
      app.ui.pdfDocUrl ||
      app.ui.pdfTs
    );
    if (!hasPdfReady) return;
  }

  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const column = sel.head - line.from + 1;
  const target = getPdfTargetFile(app.current.project.id);
  const syncKey = `${app.current.project.id}:${app.current.openFile}:${line.number}:${column}:${target || ""}`;
  if (silent && syncKey === lastPdfSyncKey) return;
  if (silent && Date.now() < pdfSyncBlockUntil) return;
  if (silent && syncKey === pdfSyncLastFailureKey) return;

  try {
    const res = await api(`/api/projects/${app.current.project.id}/synctex`, {
      method: "POST",
      timeoutMs: silent ? 1700 : 9000,
      body: JSON.stringify({
        file: app.current.openFile,
        line: line.number,
        column,
        target,
        fast: !!silent,
      }),
    });
    lastPdfSyncKey = syncKey;
    pdfSyncLastFailureKey = "";
    pdfSyncBlockUntil = 0;
    const page = Number(res && res.page);
    const x = Number(res && res.x);
    const y = Number(res && res.y);
    const h = Number(res && res.h);
    const v = Number(res && res.v);
    if (!page) throw new Error("no page");
    app.ui.pdfPage = page;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      app.ui.pdfMarker = { page, x, y, h: Number.isFinite(h) ? h : null, v: Number.isFinite(v) ? v : null };
      app.ui.pdfMarkerFocus = true;
      app.ui.pdfMarkerPulse = true;
    } else {
      app.ui.pdfMarker = null;
      app.ui.pdfMarkerFocus = false;
      app.ui.pdfMarkerPulse = false;
    }
    const hasCanvas = !!document.getElementById(`pdfCanvas_${page}`);
    const needsRefresh = !app.ui.pdfDoc || !hasCanvas;
    setPdfView({ projectId: app.current.project.id, page, refresh: needsRefresh });
    if (!silent && app.ui.selectRightTab) app.ui.selectRightTab("pdf");
  } catch (e) {
    if (silent) {
      const status = Number(e && e.status ? e.status : 0);
      const cooldown = status === 400 || status === 404 ? 14000 : 7000;
      pdfSyncLastFailureKey = syncKey;
      pdfSyncBlockUntil = Date.now() + cooldown;
      return;
    }
    if (!silent) alert(e && e.message ? `${t("同步失败")}: ${e.message}` : t("同步失败"));
  }
}

async function syncPdfFocus() {
  const view = app.editor.view;
  if (view) {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    flashEditorLine(view, line.number);
  }
  await syncPdfToCursor({ silent: false });
}

let pdfSyncTimer = null;
function schedulePdfSync() {
  if (!app.ui.autoSyncPdf) return;
  if (app.view !== "project" || !app.current.openFile) return;
  const hasPdfReady = !!(
    (app.current.artifacts && app.current.artifacts.pdf && app.current.artifacts.pdf.exists) ||
    app.ui.pdfDoc ||
    app.ui.pdfDocUrl ||
    app.ui.pdfTs
  );
  if (!hasPdfReady) return;
  if (pdfSyncTimer) clearTimeout(pdfSyncTimer);
  pdfSyncTimer = setTimeout(() => {
    pdfSyncTimer = null;
    if (app.compile.inFlight) return;
    if (pdfSyncInFlight) {
      pdfSyncPending = true;
      return;
    }
    pdfSyncInFlight = true;
    syncPdfToCursor({ silent: true })
      .catch(() => {})
      .finally(() => {
        pdfSyncInFlight = false;
        if (pdfSyncPending) {
          pdfSyncPending = false;
          schedulePdfSync();
        }
      });
  }, 400);
}

let historySnapshotTimer = null;

async function loadHistory(filePath, { force = false, limit = 50 } = {}) {
  const projectId = app.current.project && app.current.project.id;
  const file = String(filePath || "").trim();
  if (!projectId || !file) {
    app.ui.historyFile = file || null;
    app.ui.historyEntries = [];
    app.ui.historyError = "";
    app.ui.historyLoading = false;
    if (app.ui.refreshHistory) app.ui.refreshHistory();
    return [];
  }

  if (!force && app.ui.historyFile === file && app.ui.historyLoading) {
    return Array.isArray(app.ui.historyEntries) ? app.ui.historyEntries : [];
  }

  app.ui.historyFile = file;
  app.ui.historyLoading = true;
  app.ui.historyError = "";
  if (app.ui.refreshHistory) app.ui.refreshHistory();

  try {
    const maxLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const res = await api(`/api/projects/${projectId}/history?file=${encodeURIComponent(file)}&limit=${maxLimit}`);
    const entries = Array.isArray(res && res.entries) ? res.entries : [];
    app.ui.historyEntries = entries;
    return entries;
  } catch (e) {
    app.ui.historyEntries = [];
    app.ui.historyError = e && e.message ? e.message : String(e);
    return [];
  } finally {
    app.ui.historyLoading = false;
    if (app.ui.refreshHistory) app.ui.refreshHistory();
  }
}

function scheduleHistorySnapshot(view) {
  if (!app.current.project || !app.current.openFile) return;
  if (!view) return;
  if (historySnapshotTimer) clearTimeout(historySnapshotTimer);
  const projectId = app.current.project.id;
  const file = app.current.openFile;
  const size = view.state.doc.length || 0;
  const isLarge = size > 2_000_000;
  const delay = isLarge ? 5000 : 1500;
  historySnapshotTimer = setTimeout(async () => {
    historySnapshotTimer = null;
    const now = Date.now();
    if (isLarge) {
      const lastAt = app.ui.historyLastSnapAt[file] || 0;
      if (now - lastAt < 30000) return;
      app.ui.historyLastSnapAt[file] = now;
    }
    let text = "";
    let hash = null;
    if (!isLarge) {
      text = readTextForWork(view.state.doc).text;
      hash = hashText(text);
      if (app.ui.historyHashByFile[file] === hash) return;
      app.ui.historyHashByFile[file] = hash;
    }
    try {
      await api(`/api/projects/${projectId}/history/snapshot`, {
        method: "POST",
        body: JSON.stringify(isLarge ? { file } : { file, content: text }),
      });
      if (app.ui.rightTab === "history") {
        await loadHistory(file, { force: true });
      }
    } catch {
      // ignore history snapshot errors
    }
  }, delay);
}

const AUTO_COMPILE_IDLE_MS = 2000;
const AUTO_COMPILE_COOLDOWN_MS = 10000;
const AUTO_COMPILE_MAX_WAIT_MS = 20000;
let compileTimer = null;
function scheduleCompile() {
  if (!app.ui.autoCompile || !app.ui.autoCompileReady || !app.ui.autoCompileDirty) return;
  if (compileTimer) clearTimeout(compileTimer);
  const now = Date.now();
  const sinceEdit = now - (app.ui.lastEditAt || 0);
  const sinceCompile = now - (app.ui.lastAutoCompileAt || 0);
  const sinceDirty = now - (app.ui.autoCompileDirtyAt || now);
  let delay = Math.max(AUTO_COMPILE_IDLE_MS - sinceEdit, AUTO_COMPILE_COOLDOWN_MS - sinceCompile, 0);
  if (sinceDirty >= AUTO_COMPILE_MAX_WAIT_MS) {
    delay = Math.max(AUTO_COMPILE_IDLE_MS - sinceEdit, 0);
  }
  compileTimer = setTimeout(() => {
    compileTimer = null;
    if (!app.ui.autoCompile || !app.ui.autoCompileReady || !app.ui.autoCompileDirty) return;
    const now2 = Date.now();
    if (now2 - (app.ui.lastEditAt || 0) < AUTO_COMPILE_IDLE_MS - 50) {
      scheduleCompile();
      return;
    }
    app.ui.autoCompileDirty = false;
    app.ui.autoCompileDirtyAt = 0;
    app.ui.lastAutoCompileAt = now2;
    compileProject({ mode: "quick", origin: "auto" }).catch(console.error);
  }, delay);
}

function compileStatusLabel(status) {
  const map = {
    idle: t("就绪"),
    queued: t("排队"),
    running: t("编译中"),
    success: t("成功"),
    error: t("失败"),
  };
  return map[status] || status;
}

function compilerLabel(compiler) {
  const c = String(compiler || "").toLowerCase();
  if (c === "xelatex") return "XeLaTeX";
  if (c === "lualatex") return "LuaLaTeX";
  return "pdfLaTeX";
}

function compileModeLabel(mode) {
  return mode === "quick" ? t("快速编译") : t("完整编译");
}

function setCompileStage(stage) {
  app.compile.stage = stage || "";
  const el = document.getElementById("compileStage");
  if (el) {
    el.textContent = app.compile.stage;
    el.style.display = app.compile.stage ? "" : "none";
  }
}

function updateCompileMetaView() {
  const el = document.getElementById("compileMeta");
  if (!el) return;
  const parts = [];
  const engine = app.compile.lastEngine || app.current.compiler;
  if (engine) parts.push(compilerLabel(engine));
  if (app.compile.lastMode) parts.push(compileModeLabel(app.compile.lastMode));
  if (Number.isFinite(app.compile.lastDurationMs) && app.compile.lastDurationMs > 0) {
    parts.push(formatDuration(app.compile.lastDurationMs));
  }
  if (Number.isFinite(app.compile.lastQueueMs) && app.compile.lastQueueMs > 0) {
    parts.push(`${t("排队")} ${formatDuration(app.compile.lastQueueMs)}`);
  }
  const text = parts.filter(Boolean).join(" · ");
  el.textContent = text;
  el.style.display = text ? "" : "none";
}

function updateCompileStageFromLog(chunk) {
  const s = String(chunk || "");
  if (!s) return;
  const pass = s.match(/\[pass\s+([^\]]+)\]/i);
  if (pass && pass[1]) {
    setCompileStage(`LaTeX ${pass[1].trim()}`);
    return;
  }
  if (/\[bibtex\]/i.test(s)) {
    setCompileStage("BibTeX");
    return;
  }
  if (/\[biber\]/i.test(s)) {
    setCompileStage("Biber");
    return;
  }
  if (/\[queued\]/i.test(s)) {
    setCompileStage(t("排队"));
    return;
  }
  if (/\[compile\]/i.test(s)) {
    setCompileStage(t("编译中"));
    return;
  }
  if (/\[fix\]/i.test(s)) {
    setCompileStage(t("修复中"));
    return;
  }
  if (/\[timeout\]/i.test(s)) {
    setCompileStage(t("编译超时"));
  }
}

function buildDiagnosticSummary({ max = 6 } = {}) {
  const diags = app && app.compile && Array.isArray(app.compile.diagnostics) ? app.compile.diagnostics : [];
  if (!diags.length) return "";
  const out = [];
  const limit = Math.min(max, diags.length);
  for (let i = 0; i < limit; i += 1) {
    const d = diags[i] || {};
    const file = d.file ? String(d.file) : "";
    const line = Number.isFinite(d.line) ? d.line : d.line ? Number.parseInt(d.line, 10) : null;
    const msg = d.message ? String(d.message).trim() : t("错误");
    if (file && line) out.push(`${file}:${line} ${msg}`);
    else if (file) out.push(`${file} ${msg}`);
    else out.push(msg);
  }
  if (diags.length > limit) out.push(`(+${diags.length - limit})`);
  return out.join("\n");
}

function updateProblems(diagnostics) {
  app.compile.diagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  const summaryText = buildDiagnosticSummary();
  const summaryTextEl = document.getElementById("compileSummaryText");
  if (summaryTextEl) summaryTextEl.textContent = summaryText || "";
  const summaryBox = document.getElementById("compileSummaryBox");
  if (summaryBox) summaryBox.style.display = summaryText ? "" : "none";
}

async function loadCompileOverview({ silent = false } = {}) {
  if (!app.me || !app.me.isAdmin) return null;
  try {
    const data = await api("/api/admin/compile/overview");
    app.ui.compileOverview = data;
    app.ui.monitorLast = Date.now();
    if (!silent) updateMonitorView();
    return data;
  } catch (e) {
    if (!silent) console.error(e);
    return null;
  }
}

function buildMonitorBody() {
  return buildCompileMonitorBody({
    app,
    t,
    h,
    formatMb,
    formatDuration,
    compileStatusLabel,
    sectionTitle,
  });
}

function updateMonitorView() {
  const host = document.getElementById("monitorBody");
  if (!host) return;
  host.replaceChildren(buildMonitorBody());
  const timeEl = document.getElementById("monitorTime");
  if (timeEl) {
    timeEl.textContent = app.ui.monitorLast ? formatTime(new Date(app.ui.monitorLast).toISOString()) : "-";
  }
}

function startMonitorPolling() {
  if (!app.me || !app.me.isAdmin) return;
  if (app.ui.monitorTimer) return;
  const tick = () => loadCompileOverview({ silent: true }).then(() => updateMonitorView());
  tick();
  app.ui.monitorTimer = setInterval(tick, 2000);
}

function stopMonitorPolling() {
  if (app.ui.monitorTimer) clearInterval(app.ui.monitorTimer);
  app.ui.monitorTimer = null;
}

async function compileProject({ clean = false, mode = "full", origin = "manual" } = {}) {
  return compileProjectController({ clean, mode, origin }, {
    app,
    updateProblems,
    flushActiveFileToDisk,
    compileStatusLabel,
    setCompileStage,
    t,
    updateCompileMetaView,
    updateCompileStageFromLog,
    refreshPdfArtifacts,
    syncPdfTargetToJob,
    openFileAt,
    schedulePdfSync,
    getPdfTargetFile,
    loadProject,
    api,
    document,
    EventSource,
    setTimeout,
    clearTimeout,
    console,
  });
}

function getEditorSelection() {
  const view = app.editor.view;
  if (!view) return null;
  const sel = view.state.selection.main;
  const text = view.state.doc.sliceString(sel.from, sel.to);
  return { view, from: sel.from, to: sel.to, text, empty: sel.empty };
}

function insertSnippet(snippet) {
  const view = app.editor.view;
  if (!view) return alert(t("请先打开文件。"));
  const sel = view.state.selection.main;
  const selText = view.state.doc.sliceString(sel.from, sel.to);
  let insert = String(snippet || "");
  insert = insert.replace("{{sel}}", selText);

  let cursorIndex = insert.indexOf("{{cursor}}");
  if (cursorIndex !== -1) insert = insert.replace("{{cursor}}", "");

  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + (cursorIndex !== -1 ? cursorIndex : insert.length) },
    scrollIntoView: true,
  });
  view.focus();
}

function getParagraphContext(view) {
  const doc = view.state.doc;
  const sel = view.state.selection.main;
  if (!sel.empty) {
    return { from: sel.from, to: sel.to, text: doc.sliceString(sel.from, sel.to) };
  }
  let line = doc.lineAt(sel.head);
  let startLine = line.number;
  while (startLine > 1) {
    const prev = doc.line(startLine - 1);
    if (!prev.text.trim()) break;
    startLine -= 1;
  }
  let endLine = line.number;
  while (endLine < doc.lines) {
    const next = doc.line(endLine + 1);
    if (!next.text.trim()) break;
    endLine += 1;
  }
  const from = doc.line(startLine).from;
  const to = doc.line(endLine).to;
  return { from, to, text: doc.sliceString(from, to) };
}

function cleanDuplicateParagraphs() {
  const view = app.editor.view;
  if (!view) return alert(t("请先打开文件。"));
  const sel = view.state.selection.main;
  const source = sel.empty ? view.state.doc.toString() : view.state.doc.sliceString(sel.from, sel.to);
  const { text, removed } = dedupeParagraphs(source);
  if (!removed) return alert(t("未发现重复段落"));
  const from = sel.empty ? 0 : sel.from;
  const to = sel.empty ? view.state.doc.length : sel.to;
  view.dispatch({ changes: { from, to, insert: text } });
  view.focus();
  alert(t("已清理重复段落 {n} 处", { n: removed }));
}

async function compareHistoryItem(entry) {
  const projectId = app.current.project && app.current.project.id;
  const file = app.ui.historyFile || app.current.openFile;
  if (!projectId || !file || !entry || !entry.id) return;
  try {
    const [oldText, curText] = await Promise.all([
      api(`/api/projects/${projectId}/history/item?file=${encodeURIComponent(file)}&id=${encodeURIComponent(entry.id)}`),
      getCurrentFileText(file),
    ]);
    if (oldText.length > 2_000_000 || curText.length > 2_000_000) {
      const body = h("div", {}, [h("div", { class: "hint", html: t("差异过大，暂不展示。") })]);
      showModal({ title: t("对比"), bodyEl: body, actions: [] });
      return;
    }
    const diff = diffLines(oldText, curText);
    if (diff.tooLarge) {
      const body = h("div", {}, [h("div", { class: "hint", html: t("差异过大，暂不展示。") })]);
      showModal({ title: t("对比"), bodyEl: body, actions: [] });
      return;
    }
    const snippet = buildDiffSnippet(diff.diff, { context: 2, maxLines: 260 });
    const grid = h("div", { class: "diff-grid" });
    let addCount = 0;
    let delCount = 0;
    for (const row of snippet) {
      const wrap = h("div", { class: `diff-row ${row.type}`.trim() });
      if (row.type === "skip") {
        const skip = h("div", { class: "diff-cell skip", html: "⋯" });
        skip.style.gridColumn = "1 / 3";
        wrap.appendChild(skip);
        grid.appendChild(wrap);
        continue;
      }
      const left = h("div", { class: "diff-cell old" });
      const right = h("div", { class: "diff-cell new" });
      if (row.type === "eq") {
        left.textContent = row.line;
        right.textContent = row.line;
      } else if (row.type === "del") {
        delCount += 1;
        left.textContent = row.line;
      } else if (row.type === "add") {
        addCount += 1;
        right.textContent = row.line;
      }
      wrap.appendChild(left);
      wrap.appendChild(right);
      grid.appendChild(wrap);
    }
    const header = h("div", { class: "diff-header" }, [
      h("div", { class: "diff-label", html: `${t("历史版本")}: ${entry.ts ? new Date(entry.ts).toLocaleString() : "-"}` }),
      h("div", { class: "diff-label", html: `${t("当前版本")}: ${new Date().toLocaleString()}` }),
    ]);
    const meta = h("div", { class: "diff-meta" }, [
      h("span", { class: "diff-chip user", html: entry.user || "-" }),
      h("span", { class: "diff-chip add", html: `+${addCount}` }),
      h("span", { class: "diff-chip del", html: `-${delCount}` }),
    ]);
    const body = h("div", { class: "diff-body" }, [header, meta, grid]);
    showModal({ title: t("对比"), bodyEl: body, actions: [] });
  } catch (e) {
    alert(e && e.message ? e.message : String(e));
  }
}

function renderHistoryView() {
  return renderHistoryPanel({
    h,
    app,
    t,
    btn,
    loadHistory,
    viewHistoryItem,
    compareHistoryItem,
    restoreHistoryItem,
    formatBytes,
  });
}


function showGoToLine() {
  if (app.view !== "project") return;
  if (!app.current.openFile) return alert(t("请先打开文件。"));
  const view = app.editor.view;
  const curLine = view ? view.state.doc.lineAt(view.state.selection.main.head).number : 1;
  const lineInput = h("input", { class: "input", type: "number", value: String(curLine), placeholder: t("输入行号") });
  const hint = h("div", { class: "hint", html: `${t("当前文件")}: ${app.current.openFile}` });

  const go = () => {
    const val = Number(lineInput.value || 0);
    if (!Number.isFinite(val) || val <= 0) return;
    closeModal();
    openFileAt(app.current.openFile, Math.floor(val)).catch(console.error);
  };

  lineInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      go();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeModal();
    }
  });

  const body = h("div", { class: "quick-body" }, [lineInput, hint]);
  showModal({ title: t("跳转到行"), bodyEl: body, actions: [btn(t("跳转"), { kind: "primary", onClick: go })] });
  setTimeout(() => lineInput.focus(), 0);
}

function showQuickOutline() {
  showQuickOutlineDialog({
    app,
    h,
    t,
    showModal,
    closeModal,
    openFileAt,
  });
}


function showQuickOpen() {
  showQuickOpenDialog({
    app,
    h,
    t,
    isFolderPlaceholder,
    showModal,
    closeModal,
    openFile,
  });
}


function showProjectSearch() {
  showProjectSearchDialog({
    app,
    h,
    t,
    escapeRegExp,
    api,
    btn,
    closeModal,
    showModal,
    openFileAt,
  });
}



function showChartBuilder() {
  showChartBuilderDialog({
    isProjectView: app.view === "project",
    h,
    t,
    btn,
    showModal,
    closeModal,
    insertSnippet,
    parseTable,
    generatePgfplots,
  });
}

function showImageInsert() {
  showImageInsertDialog({
    isProjectView: app.view === "project",
    files: listImageFiles(app.current.tree || []),
    h,
    t,
    btn,
    showModal,
    closeModal,
    insertSnippet,
    buildFigureSnippet,
  });
}

function renderRecentFiles() {
  return renderRecentFilesPanel({
    app,
    h,
    t,
    fileBaseName,
    openFile,
  });
}


function renderPinnedFiles() {
  return renderPinnedFilesPanel({
    app,
    h,
    t,
    btn,
    fileBaseName,
    openFile,
    togglePinnedFile,
  });
}


function renderFileTree() {
  return renderFileTreePanel({
    app,
    h,
    t,
    isFocusFile,
    isAssetFile,
    STYLE_EXTS,
    buildTree,
    sortedChildren,
    isFolderPlaceholder,
    toggleDropdown,
    iconSvg,
    dropdownMenu,
    btn,
    api,
    FOLDER_PLACEHOLDER,
    loadProject,
    cleanupEditor,
    clearDropdowns,
    mount,
    render,
    remapPathList,
    remapPathSet,
    remapPathPrefix,
    filterPathList,
    filterPathSet,
    setOpenFiles,
    setPinnedFiles,
    lastOpenFileKey,
    openFile,
    isPathUnderPrefix,
    toggleFileSelection,
    setEditorError,
  });
}

function closeTab(filePath) {
  setOpenFiles(app.ui.openFiles.filter((p) => p !== filePath));
  if (app.current.openFile === filePath) {
    app.current.openFile = null;
    cleanupEditor();
    const next = app.ui.openFiles[0];
    if (next) {
      openFile(next).catch(console.error);
      return;
    }
    mount(render());
    return;
  }
  if (app.ui.refreshFileTabs) app.ui.refreshFileTabs();
}

function renderFileTabs() {
  return renderFileTabsView({
    h,
    app,
    t,
    openFile,
    closeTab,
  });
}


function renderLogin() {
  return renderLoginPage({
    input,
    t,
    h,
    applyLayoutClass,
    updateTopbarButtons,
    updateToolbarCollapsed,
    updateBottomConsoleVisibility,
    updateRightPaneFloat,
    topbar,
    btn,
    api,
    loadMe,
    loadProjects,
    app,
    mount,
    render,
  });
}


function renderProjects() {
  return renderProjectsPage({
    input,
    app,
    t,
    mount,
    render,
    api,
    loadProjects,
    clearDropdowns,
    openProjectById,
    h,
    projectMatchesScope,
    projectMatchesFilter,
    dropdownMenu,
    buildProjectSettingsPanel,
    toggleDropdown,
    iconSvg,
    PROJECT_THUMB_URL,
    formatProjectAge,
    pickColor,
    cleanupEditor,
    enterGuestMode,
    loadMe,
    btn,
  });
}


function renderProject() {
  return renderProjectPage({
    api,
    app,
    FOLDER_PLACEHOLDER,
    appendBottomTerminal,
    applySplitVars,
    btn,
    buildDiagnosticSummary,
    cleanupEditor,
    clearBottomTerminal,
    clearDropdowns,
    closeModal,
    compileProject,
    computeLayoutClass,
    dropdownMenu,
    enterGuestMode,
    fileBaseName,
    formatPdfPageInfo,
    getPdfTargetFile,
    h,
    handlePdfScroll,
    iconSvg,
    input,
    isFolderPlaceholder,
    loadProject,
    loadProjects,
    mount,
    openFile,
    openFileAt,
    pdfScrollRef: {
      get current() { return pdfScrollRaf; },
      set current(value) { pdfScrollRaf = value; },
    },
    pdfUrl,
    pickColor,
    pickDefaultOpenFile,
    placePdfMarker,
    pulsePdfMarker,
    render,
    renderFileTree,
    renderLoading,
    renderPdfPages,
    renderPinnedFiles,
    revealActiveFile,
    schedulePdfSync,
    setBottomConsole,
    setBottomMode,
    setEditorFontSize,
    setEditorLineHeight,
    setEditorPaddingX,
    setEditorPaddingY,
    setFileView,
    setLeftCollapsed,
    setLayoutMode,
    setPdfTargetFile,
    setPdfView,
    setTheme,
    setTreeDensity,
    setWsUrlOverride,
    showModal,
    startBottomDrag,
    startDrag,
    stopMonitorPolling,
    t,
    toggleDropdown,
    toggleLeftPane,
    updateBottomConsoleMode,
    zoomStep,
  });
}

function renderLoading() {
  const err = app && app.ui ? app.ui.loadError : "";
  const detail = app && app.ui ? app.ui.loadErrorDetail : "";
  if (!err) {
    return h("div", { class: "page" }, [
      topbar(t("加载中..."), []),
      h("div", { class: "center" }, [h("div", { class: "hint", html: t("加载中...") })]),
    ]);
  }
  const retryBtn = btn(t("重新加载"), { kind: "primary", onClick: () => location.reload() });
  const info = h("div", { class: "loading-panel" }, [
    h("div", { class: "hint error", html: err }),
    detail ? h("div", { class: "loading-detail", html: detail }) : null,
    h("div", { class: "loading-detail", html: t("当前地址: {origin}", { origin: location.origin }) }),
    h("div", { class: "loading-detail", html: t("若使用 VSCode 端口转发，请使用 Ports 面板里的转发链接。") }),
    h("div", { class: "loading-actions" }, [retryBtn]),
  ].filter(Boolean));
  return h("div", { class: "page" }, [
    topbar(t("加载失败"), []),
    h("div", { class: "center" }, [info]),
  ]);
}

function renderModalOverlay() {
  if (!app.modal) return null;
  const { title, bodyEl, actions } = app.modal;
  const actionRow = h("div", { class: "modal-actions" }, [
    ...actions,
    btn(t("关闭"), { onClick: closeModal }),
  ]);
  return h("div", { class: "modal-overlay", onclick: (e) => { if (e.target.classList.contains("modal-overlay")) closeModal(); } }, [
    h("div", { class: "modal" }, [
      h("div", { class: "modal-header" }, [
        h("div", { class: "modal-title", html: title || "" }),
      ]),
      h("div", { class: "modal-body" }, [bodyEl]),
      actionRow,
    ]),
  ]);
}

function render() {
  let page;
  if (app.view === "loading") page = renderLoading();
  else if (app.view === "login") page = renderLogin();
  else if (app.view === "projects") page = renderProjects();
  else if (app.view === "project") page = renderProject();
  else page = renderLoading();

  const overlay = renderModalOverlay();
  if (!overlay) return page;
  return h("div", { class: "stack" }, [page, overlay]);
}

async function bootstrap() {
  app.view = "loading";
  app.ui.authError = "";
  app.ui.loadError = "";
  app.ui.loadErrorDetail = "";
  applySplitVars();
  mount(render());

  try {
    await loadMe();
  } catch (err) {
    if (isNetworkError(err)) {
      setLoadError(err);
      return;
    }
  }
  if (!app.me) {
    let ok = false;
    try {
      ok = await tryAutoLogin();
    } catch (err) {
      if (isNetworkError(err)) {
        setLoadError(err);
        return;
      }
    }
    if (ok) {
      try {
        await loadMe();
      } catch (err) {
        if (isNetworkError(err)) {
          setLoadError(err);
          return;
        }
      }
    }
  }
  if (!app.me) {
    localStorage.removeItem("ct_session_token");
    app.ui.guestMode = false;
    app.view = "login";
    mount(render());
    return;
  }

  try {
    await loadProjects();
  } catch (err) {
    if (isNetworkError(err)) {
      setLoadError(err, t("无法加载项目列表"));
      return;
    }
    throw err;
  }
  const routed = await handleRoute();
  if (!routed) {
    app.view = "projects";
    mount(render());
  }
}

window.addEventListener("beforeunload", () => cleanupEditor());
let resizeRaf = null;
window.addEventListener("resize", () => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    syncTopbarHeight();
    syncResizeObserver();
    normalizeSplitWidths();
    applySplitVars();
    updateRightPaneFloat();
    refreshEditorView();
    if (app.current.project && app.ui.rightTab === "pdf") {
      renderPdfPages({ projectId: app.current.project.id }).catch(() => {});
    }
  });
});
document.addEventListener("click", () => {
  if (app && app.ui && app.ui.dropdownOpen) {
    clearDropdowns();
  }
});
window.addEventListener("keydown", (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s" && ev.shiftKey) {
    if (app.view === "project") {
      ev.preventDefault();
      compileProject({ mode: "quick" }).catch(console.error);
    }
  } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
    if (app.view === "project") {
      ev.preventDefault();
      compileProject({ mode: "full" }).catch(console.error);
    }
  } else if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === "f") {
    if (app.view === "project") {
      ev.preventDefault();
      showProjectSearch();
    }
  } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "p") {
    if (app.view === "project") {
      ev.preventDefault();
      showQuickOpen();
    }
  } else if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === "b") {
    if (app.view === "project") {
      ev.preventDefault();
      toggleLeftPane();
    }
  } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "g") {
    if (app.view === "project") {
      ev.preventDefault();
      showGoToLine();
    }
  }
});
window.addEventListener("hashchange", () => {
  handleRoute().catch(() => {});
});

function reportUiError(err) {
  const msg = err && err.message ? err.message : String(err);
  // Make failures visible to non-dev users (intranet setup) without needing DevTools.
  try {
    const logEl = document.getElementById("compileLog");
    if (logEl) {
      logEl.textContent += `\n${t("[js 错误] {msg}", { msg })}\n`;
      logEl.scrollTop = logEl.scrollHeight;
    }
  } catch {
    // ignore
  }
}

window.addEventListener("error", (ev) => reportUiError(ev && (ev.error || ev.message)));
window.addEventListener("unhandledrejection", (ev) => reportUiError(ev && ev.reason));

bootstrap().catch((e) => {
  console.error(e);
  if (isNetworkError(e)) {
    setLoadError(e);
    return;
  }
  enterGuestMode();
  loadProjects().then(() => mount(render())).catch(() => mount(render()));
});
