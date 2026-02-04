import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";

import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { StreamLanguage, foldService } from "@codemirror/language";
import { autocompletion, snippetCompletion } from "@codemirror/autocomplete";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { keymap } from "@codemirror/view";
// @ts-ignore
import { yCollab } from "y-codemirror.next";

import { api } from "./services/api.js";
import { t, getLang, setLang as setI18nLang } from "./i18n.js";
import { clampNumber } from "./utils/numbers.js";
import { escapeRegExp } from "./utils/strings.js";
import { fileExt } from "./utils/paths.js";
import {
  extractIncludePaths,
  extractBibPaths,
  extractLabels,
  extractBibKeys,
  computeDocStats,
  latexFoldService,
} from "./utils/latex.js";
import {
  flashLineEffect,
  clearFlashLineEffect,
  flashLineField,
  ghostSuggestField,
  getGhostSuggestion,
  setGhostSuggestion,
  clearGhostSuggestion,
  clearGhostSuggestEffect,
} from "./editor/effects.js";
import {
  aiDefaults,
  AI_ACTIVE_PROFILE_KEY,
  AI_PROFILE_POLISH_KEY,
  AI_PROFILE_CHAT_KEY,
  AI_PROFILE_DIAG_KEY,
  mkAiProfileId,
  normalizeAiProfile,
  loadAiProfilesFromStorage,
  saveAiProfilesToStorage,
} from "./ai/profiles.js";

const root = document.getElementById("app");

const PROJECT_THUMB_URL = "/assets/project-thumb.svg";
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14" />',
  upload: '<path d="M12 16V6M8 10l4-4 4 4M5 18h14" />',
  download: '<path d="M12 8v10M8 14l4 4 4-4M5 6h14" />',
  more: '<circle cx="6" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18" cy="12" r="1.4" fill="currentColor" />',
  clear: '<path d="M6 6l12 12M18 6l-12 12" />',
  compile: '<path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" />',
  back: '<path d="M15 6l-6 6 6 6" /><path d="M9 12h10" />',
  panel: '<rect x="4" y="5" width="16" height="14" rx="2" /><path d="M9 5v14" />',
  files: '<path d="M4 7h6l2 2h8v8H4z" /><path d="M4 7v10" />',
  chat: '<path d="M4 6h16v9H8l-4 4z" />',
  list: '<path d="M6 7h12M6 12h12M6 17h12" />',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" />',
};

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
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`,
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
  if (override) {
    if (!token) return override;
    try {
      const ov = new URL(override, location.href);
      if (!ov.searchParams.get("token")) ov.searchParams.set("token", token);
      return ov.toString();
    } catch {
      return override;
    }
  }
  const wsPort = u.searchParams.get("wsPort");
  const wsPathParam = u.searchParams.get("wsPath");
  if (wsPort) {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const path = wsPathParam || "/";
    const portPart = `:${wsPort}`;
    const pathPart = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
    const base = `${scheme}://${location.hostname}${portPart}${pathPart}`;
    if (!token) return base;
    try {
      const ws = new URL(base, location.href);
      if (!ws.searchParams.get("token")) ws.searchParams.set("token", token);
      return ws.toString();
    } catch {
      return base;
    }
  }

  const stored = localStorage.getItem("ct_ws_url");
  if (stored) {
    if (!token) return stored;
    try {
      const ws = new URL(stored, location.href);
      if (!ws.searchParams.get("token")) ws.searchParams.set("token", token);
      return ws.toString();
    } catch {
      return stored;
    }
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
  if (!token) return base;
  try {
    const ws = new URL(base, location.href);
    if (!ws.searchParams.get("token")) ws.searchParams.set("token", token);
    return ws.toString();
  } catch {
    return base;
  }
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
    if (!canvas) continue;
    const ctx = canvas.getContext("2d");
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const task = page.render({ canvasContext: ctx, viewport });
    app.ui.pdfRenderTasks.push(task);
    try {
      await task.promise;
    } catch {
      // ignore render errors
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
  const pad = (n) => String(Math.max(1, Number(n) || 1)).padStart(2, "0");
  return `${pad(page)}/${pad(total)} 页`;
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
  let h = 0;
  const str = String(text || "");
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return String(h);
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

const autoFixStored = localStorage.getItem("ct_ai_auto_fix");
const autoFixDefault = autoFixStored === "1";
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
    assistantEnabled: localStorage.getItem("ct_assistant_enabled") !== "0",
    dropdownOpen: "",
    switchError: "",
    importError: "",
    projectRenameId: "",
    projectDeleteArmed: "",
    authError: "",
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
    fileView: "all",
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
    aiChatHistory: {},
    aiChatPanelState: null,
    refreshChatPanel: null,
    refreshAiFloat: null,
    aiContextMode: localStorage.getItem("ct_ai_ctx_mode") || "selection",
    aiContextIncludeBib: localStorage.getItem("ct_ai_ctx_bib") === "1",
    aiContextIncludeStyle: localStorage.getItem("ct_ai_ctx_style") === "1",
    aiProfiles: [],
    aiActiveProfileId: localStorage.getItem(AI_ACTIVE_PROFILE_KEY) || "",
    aiProfileForPolish: localStorage.getItem(AI_PROFILE_POLISH_KEY) || "",
    aiProfileForChat: localStorage.getItem(AI_PROFILE_CHAT_KEY) || "",
    aiProfileForDiagnose: localStorage.getItem(AI_PROFILE_DIAG_KEY) || "",
    aiUseServer: localStorage.getItem("ct_ai_use_server") !== "0",
    aiAutoDiagnose: localStorage.getItem("ct_ai_auto_diag") === "1",
    aiAutoSuggest: localStorage.getItem("ct_ai_auto_suggest") === "1",
    aiAutoHint: localStorage.getItem("ct_ai_auto_hint") === "1",
    aiAutoFix: autoFixDefault,
    aiHint: "",
    aiHintStatus: "",
    editorReadable: localStorage.getItem("ct_editor_readable") === "1",
    typewriterMode: localStorage.getItem("ct_typewriter") === "1",
    editorFontSize: clampNumber(localStorage.getItem("ct_editor_font_size"), 11, 22, 14.5),
    editorLineHeight: clampNumber(localStorage.getItem("ct_editor_line_height"), 1.2, 2.4, 1.7),
    editorPadY: clampNumber(localStorage.getItem("ct_editor_pad_y"), 8, 32, 14),
    editorPadX: clampNumber(localStorage.getItem("ct_editor_pad_x"), 8, 32, 14),
    treeDensity: localStorage.getItem("ct_tree_density") || "comfortable",
    aiChatMode: localStorage.getItem("ct_ai_chat_mode") || "assistant",
    aiFloatOpen: localStorage.getItem("ct_ai_float") === "1",
    focusMode: false,
    autoJumpError: localStorage.getItem("ct_auto_jump_error") === "1",
    aiSessions: [],
    aiActiveSessionId: null,
    theme: localStorage.getItem("ct_theme") || "default",
    labelCache: {},
    bibKeyCache: { projectId: "", keys: [], byFile: {}, updatedAt: 0 },
    aiPanelCollapsed: localStorage.getItem("ct_ai_panel_collapsed") === "1",
    aiPanelMode: localStorage.getItem("ct_ai_panel_mode") || "chat",
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
    aiFix: "",
    aiFixStatus: "",
    aiPatch: null,
    aiPatchStatus: "",
    lastAiAutoFixAt: 0,
    aiOneClickStatus: "",
    aiOneClickStep: "",
    aiOneClickMark: 0,
    mainRepairTriedAt: 0,
    lastHeuristicFixAt: 0,
    stage: "",
    lastQueueMs: 0,
    lastDurationMs: 0,
    lastMode: "",
    lastEngine: "",
    lastFinishedAt: "",
  },
  ai: {
    ...aiDefaults,
    suggestTimer: null,
    suggestLastAt: 0,
    suggestInFlight: false,
    hintTimer: null,
    hintLastAt: 0,
    hintInFlight: false,
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
initAiProfiles();

function initAiProfiles() {
  const list = loadAiProfilesFromStorage();
  app.ui.aiProfiles = list;
  const ids = new Set(list.map((p) => p.id));
  if (!app.ui.aiActiveProfileId || !ids.has(app.ui.aiActiveProfileId)) {
    app.ui.aiActiveProfileId = list[0] ? list[0].id : "";
    if (app.ui.aiActiveProfileId) localStorage.setItem(AI_ACTIVE_PROFILE_KEY, app.ui.aiActiveProfileId);
  }
  if (app.ui.aiProfileForPolish && !ids.has(app.ui.aiProfileForPolish)) app.ui.aiProfileForPolish = "";
  if (app.ui.aiProfileForChat && !ids.has(app.ui.aiProfileForChat)) app.ui.aiProfileForChat = "";
  if (app.ui.aiProfileForDiagnose && !ids.has(app.ui.aiProfileForDiagnose)) app.ui.aiProfileForDiagnose = "";
  saveAiProfilesToStorage(list);
}

function saveAiProfiles() {
  saveAiProfilesToStorage(app.ui.aiProfiles || []);
}

function getAiProfileById(id) {
  if (!id) return null;
  return (app.ui.aiProfiles || []).find((p) => p.id === id) || null;
}

function setActiveAiProfile(id) {
  app.ui.aiActiveProfileId = id || "";
  if (id) localStorage.setItem(AI_ACTIVE_PROFILE_KEY, id);
  else localStorage.removeItem(AI_ACTIVE_PROFILE_KEY);
}

function setAiProfileForMode(mode, id) {
  const val = id || "";
  if (mode === "polish") {
    app.ui.aiProfileForPolish = val;
    if (val) localStorage.setItem(AI_PROFILE_POLISH_KEY, val);
    else localStorage.removeItem(AI_PROFILE_POLISH_KEY);
  } else if (mode === "chat") {
    app.ui.aiProfileForChat = val;
    if (val) localStorage.setItem(AI_PROFILE_CHAT_KEY, val);
    else localStorage.removeItem(AI_PROFILE_CHAT_KEY);
  } else if (mode === "diagnose") {
    app.ui.aiProfileForDiagnose = val;
    if (val) localStorage.setItem(AI_PROFILE_DIAG_KEY, val);
    else localStorage.removeItem(AI_PROFILE_DIAG_KEY);
  }
}

function getAiProfileForMode(mode) {
  if (mode === "polish") return app.ui.aiProfileForPolish || "";
  if (mode === "chat") return app.ui.aiProfileForChat || "";
  if (mode === "diagnose") return app.ui.aiProfileForDiagnose || "";
  return "";
}

function getAiConfigFor(mode) {
  const id = getAiProfileForMode(mode) || app.ui.aiActiveProfileId;
  const profile = getAiProfileById(id);
  if (profile) {
    return {
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiStyle: profile.apiStyle,
    };
  }
  return { ...app.ai };
}

function applyAiConfig(payload, mode) {
  if (app && app.ui && app.ui.aiUseServer) return;
  const cfg = getAiConfigFor(mode);
  if (cfg.apiKey) payload.apiKey = cfg.apiKey;
  if (cfg.baseUrl) payload.baseUrl = cfg.baseUrl;
  if (cfg.model) payload.model = cfg.model;
  if (cfg.apiStyle) payload.apiStyle = cfg.apiStyle;
}

function addAiProfile(seed) {
  const base = seed && typeof seed === "object" ? seed : {};
  const next = normalizeAiProfile(
    {
      id: mkAiProfileId(),
      name: base.name || `Model ${app.ui.aiProfiles.length + 1}`,
      apiKey: base.apiKey || "",
      baseUrl: base.baseUrl || "",
      model: base.model || "",
      apiStyle: base.apiStyle || "",
    },
    base.name
  );
  app.ui.aiProfiles.push(next);
  setActiveAiProfile(next.id);
  saveAiProfiles();
  return next;
}

function removeAiProfile(id) {
  const list = (app.ui.aiProfiles || []).filter((p) => p.id !== id);
  if (!list.length) return false;
  app.ui.aiProfiles = list;
  if (app.ui.aiActiveProfileId === id) setActiveAiProfile(list[0].id);
  if (app.ui.aiProfileForPolish === id) setAiProfileForMode("polish", "");
  if (app.ui.aiProfileForChat === id) setAiProfileForMode("chat", "");
  if (app.ui.aiProfileForDiagnose === id) setAiProfileForMode("diagnose", "");
  saveAiProfiles();
  return true;
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
  const minRight = 360;
  const minEditor = 320;
  const maxLeft = Math.min(520, Math.max(minLeft, Math.floor(w * 0.35)));
  const maxRight = Math.min(900, Math.max(minRight, Math.floor(w * 0.45)));

  let left = clampNumber(app.ui.leftW, minLeft, maxLeft, 200);
  let right = clampNumber(app.ui.rightW, minRight, maxRight, 600);
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
  app.ui.leftCollapsed = !!next;
  localStorage.setItem("ct_left_collapsed", app.ui.leftCollapsed ? "1" : "0");
  applyLayoutClass();
  updateTopbarButtons();
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
  if (sidebarBtn) sidebarBtn.textContent = app.ui.leftCollapsed ? t("显示侧栏") : t("隐藏侧栏");
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

function setAiSetting(key, value) {
  app.ai[key] = value;
  if (key === "apiKey") localStorage.setItem("ct_ai_key", value);
  if (key === "baseUrl") localStorage.setItem("ct_ai_base", value);
  if (key === "model") localStorage.setItem("ct_ai_model", value);
  if (key === "apiStyle") localStorage.setItem("ct_ai_style", value);
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

function setAiPanelCollapsed(next) {
  app.ui.aiPanelCollapsed = !!next;
  localStorage.setItem("ct_ai_panel_collapsed", app.ui.aiPanelCollapsed ? "1" : "0");
  if (app.ui.refreshChatPanel) app.ui.refreshChatPanel();
}

function setFileView(view) {
  const v = "all";
  app.ui.fileView = v;
  localStorage.setItem("ct_fileView", v);
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
  if (app.ai && app.ai.suggestTimer) {
    clearTimeout(app.ai.suggestTimer);
    app.ai.suggestTimer = null;
  }
  if (app.ai && app.ai.hintTimer) {
    clearTimeout(app.ai.hintTimer);
    app.ai.hintTimer = null;
  }
  if (app.ai) app.ai.suggestInFlight = false;
  if (app.ai) app.ai.hintInFlight = false;
  if (app.editor.view) app.editor.view.destroy();
  app.editor.view = null;
  if (app.editor.provider) app.editor.provider.destroy();
  app.editor.provider = null;
  if (app.editor.ydoc) app.editor.ydoc.destroy();
  app.editor.ydoc = null;
  app.editor.syncStatus = null;
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

let outlineTimer = null;
let outlineText = "";
let statusTimer = null;

function extractOutline(text) {
  const items = [];
  const lines = String(text || "").split(/\r?\n/);
  const re =
    /^\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\\[[^\\]]*\\])?\\s*{([^}]*)}/;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("%")) continue;
    const m = trimmed.match(re);
    if (!m) continue;
    const kind = m[1];
    const title = (m[2] || "").trim() || "(untitled)";
    const level =
      kind === "chapter"
        ? 0
        : kind === "section"
          ? 1
          : kind === "subsection"
            ? 2
            : kind === "subsubsection"
              ? 3
              : kind === "paragraph"
                ? 4
                : 5;
    items.push({ title, level, line: i + 1, kind });
  }
  return items;
}

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
  app.current.outline = extractOutline(text);
  renderOutlineList();
}

function scheduleOutline(text) {
  outlineText = text;
  if (outlineTimer) clearTimeout(outlineTimer);
  outlineTimer = setTimeout(() => {
    outlineTimer = null;
    updateOutlineFromText(outlineText);
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
  const text = doc.toString();
  const stats = computeDocStats(text);
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

function scheduleStatus(view) {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusTimer = null;
    updateEditorStatus(view);
  }, 200);
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
        });
        if (loginRes && loginRes.token) localStorage.setItem("ct_session_token", loginRes.token);
        localStorage.setItem("ct_last_user", username);
        return true;
      } catch {
        // try next password
      }
    }
  }
  return false;
}

const AI_CONTEXT_LIMIT = 12000;

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
  app.ui.aiChatPanelState = null;
  app.ui.aiSessions = loadAiSessions();
  app.ui.aiActiveSessionId = app.ui.aiSessions[0] ? app.ui.aiSessions[0].id : null;
  app.ui.pdfPageHeights = {};
  app.ui.pdfPageWidths = {};
  app.ui.pdfViewports = {};
  app.ui.pdfRenderTasks = [];
  app.ui.pdfRenderToken = 0;
  app.ui.pdfMarker = null;
  app.ui.pdfMarkerFocus = false;
  app.ui.pdfMarkerPulse = false;
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
      pickDefaultOpenFile(app.current.tree, app.current.mainFile);
    if (preferred) app.ui.pendingOpenFile = preferred;
  }
}

async function openProjectById(projectId, { pushHash = true, resetTab = true, seedProject = null } = {}) {
  if (!projectId) return false;
  cleanupEditor();
  app.view = "project";
  app.current.openFile = null;
  app.ui.openFiles = [];
  app.ui.fileFilter = "";
  app.ui.openFolders = new Set([""]);
  app.current.project = seedProject || app.projects.find((p) => p.id === projectId) || { id: projectId, name: projectId };
  mount(render());
  try {
    await loadProject(projectId, { resetTab });
    app.view = "project";
    if (pushHash) history.pushState({}, "", `#project/${projectId}`);
    mount(render());
    return true;
  } catch (e) {
    app.view = "projects";
    const msg = e && e.message ? e.message : String(e);
    alert(`无法打开项目：${msg}`);
    await loadProjects();
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
  if (!project) return;
  const nameInput = input({ value: project.name || "" });
  const isEditing = app.ui.projectRenameId === project.id;

  const body = h("div", { class: "dropdown-panel project-actions-panel" }, []);
  if (isEditing) {
    body.appendChild(h("div", { class: "label", html: t("名称") }));
    body.appendChild(nameInput);
  }

  const saveBtn = btn(t("保存"), {
    kind: "primary menu-inline",
    onClick: async (ev) => {
      ev.stopPropagation();
      const payload = {
        name: nameInput.value.trim() || project.name,
      };
      await api(`/api/projects/${project.id}/meta`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      project.name = payload.name;
      await loadProjects();
      if (app.current.project && app.current.project.id === project.id) {
        app.current.project = app.projects.find((p) => p.id === project.id) || project;
      }
      clearDropdowns();
      mount(render());
    },
  });

  const renameBtn = btn(t("重命名"), {
    kind: "menu-item",
    onClick: (ev) => {
      ev.stopPropagation();
      app.ui.projectRenameId = project.id;
      app.ui.projectDeleteArmed = "";
      mount(render());
    },
  });

  const cancelBtn = btn(t("取消"), {
    kind: "menu-inline",
    onClick: (ev) => {
      ev.stopPropagation();
      app.ui.projectRenameId = "";
      mount(render());
    },
  });

  const isArmed = app.ui.projectDeleteArmed === project.id;
  const delBtn = btn(isArmed ? t("确认删除") : t("删除项目"), {
    kind: isArmed ? "menu-item danger" : "menu-item",
    onClick: async (ev) => {
      ev.stopPropagation();
      if (!isArmed) {
        app.ui.projectDeleteArmed = project.id;
        mount(render());
        return;
      }
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      clearDropdowns();
      if (onDelete) {
        await onDelete();
        return;
      }
      await loadProjects();
      mount(render());
    },
  });

  if (isEditing) {
    body.appendChild(h("div", { class: "menu-inline" }, [saveBtn, cancelBtn]));
  } else {
    body.appendChild(renameBtn);
  }
  body.appendChild(delBtn);
  return body;
}

async function openFile(filePath) {
  if (isFolderPlaceholder(filePath)) return;
  const projectId = app.current.project && app.current.project.id;
  if (projectId && isAssetFile(filePath)) {
    let url = `/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`;
    const token = localStorage.getItem("ct_session_token") || "";
    if (token) url += `&token=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
    return;
  }
  if (filePath === app.current.openFile && app.editor.view) {
    if (app.ui.refreshFileTabs) app.ui.refreshFileTabs();
    if (app.ui.refreshFileTree) app.ui.refreshFileTree();
    return;
  }
  app.current.openFile = filePath;
  if (app.ui.layoutMode === "pdf") setLayoutMode("balanced");
  trackOpenFile(filePath);
  cleanupEditor();
  app.ui.autoCompileDirty = false;
  app.ui.autoCompileDirtyAt = 0;
  app.ui.lastEditAt = 0;
  app.ui.autoCompileReady = false;
  if (app.ui.autoCompileArmTimer) clearTimeout(app.ui.autoCompileArmTimer);
  app.ui.autoCompileArmTimer = setTimeout(() => {
    app.ui.autoCompileReady = true;
    app.ui.autoCompileArmTimer = null;
    if (app.ui.autoCompileDirty) scheduleCompile();
  }, 1500);
  let host = document.getElementById("editorHost");
  if (!host) {
    mount(render());
    host = document.getElementById("editorHost");
  } else {
    if (app.ui.refreshFileTabs) app.ui.refreshFileTabs();
    if (app.ui.refreshFileTree) app.ui.refreshFileTree();
    const titleEl = document.getElementById("editorTitle");
    if (titleEl) {
      titleEl.textContent = filePath ? fileBaseName(filePath) : t("编辑器");
      titleEl.title = filePath || "";
    }
    const statusEl = document.getElementById("editorStatus");
    if (statusEl) statusEl.textContent = "";
  }
  if (!host) return;

  const docName = `${projectId}:${encodeURIComponent(filePath)}`;

  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: wsUrl(), name: docName, document: ydoc });
  let providerStatus = "connecting";
  let prefillTimer = null;
  let prefilled = false;
  let syncedOnce = false;

  const c = pickColor(app.me.username);
  provider.awareness.setLocalStateField("user", {
    name: app.me.username,
    color: c.color,
    colorLight: c.light,
  });

  const ytext = ydoc.getText("content");
  const undoManager = new Y.UndoManager(ytext);
  const latexMode = StreamLanguage.define(stex);

  const isUserEdit = (u) =>
    u.transactions.some((tr) => {
      if (!tr.isUserEvent) return false;
      return (
        tr.isUserEvent("input") ||
        tr.isUserEvent("delete") ||
        tr.isUserEvent("paste") ||
        tr.isUserEvent("move") ||
        tr.isUserEvent("undo") ||
        tr.isUserEvent("redo")
      );
    });

  const autoCompileListener = EditorView.updateListener.of((u) => {
    if (!u.docChanged || !app.ui.autoCompile) return;
    if (!isUserEdit(u)) return;
    const now = Date.now();
    app.ui.lastEditAt = now;
    if (!app.ui.autoCompileDirtyAt) app.ui.autoCompileDirtyAt = now;
    app.ui.autoCompileDirty = true;
    if (!app.ui.autoCompileReady) return;
    scheduleCompile();
  });

  const outlineListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) scheduleOutline(u.state.doc.toString());
  });

  const statusListener = EditorView.updateListener.of((u) => {
    if (u.docChanged || u.selectionSet) scheduleStatus(u.view);
  });

  const historyListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) scheduleHistorySnapshot(u.view);
  });

  const cacheListener = EditorView.updateListener.of((u) => {
    if (!u.docChanged) return;
    if (app.current.openFile) {
      updateDocCaches(app.current.openFile, u.state.doc.toString());
    }
  });

  const syncListener = EditorView.updateListener.of((u) => {
    if (app.ui.autoSyncPdf && u.selectionSet) schedulePdfSync();
  });

  const autoSuggestListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) scheduleAiCopilotSuggest(u.view);
  });


  const ghostKeymap = keymap.of([
    {
      key: "Tab",
      run: (view) => acceptGhostSuggestion(view),
    },
    {
      key: "Escape",
      run: (view) => dismissGhostSuggestion(view),
    },
  ]);

  let typewriterRaf = null;
  const typewriterListener = EditorView.updateListener.of((u) => {
    if (!app.ui.typewriterMode) return;
    if (!u.selectionSet) return;
    if (typewriterRaf) cancelAnimationFrame(typewriterRaf);
    typewriterRaf = requestAnimationFrame(() => {
      typewriterRaf = null;
      if (app.editor.view !== u.view) return;
      try {
        u.view.dispatch({
          effects: EditorView.scrollIntoView(u.state.selection.main.head, { y: "center" }),
        });
      } catch {
        // ignore scroll failures
      }
    });
  });

  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      basicSetup,
      latexMode,
      autocompletion({ override: [imageCompletionSource, latexCompletionSource] }),
      foldService.of(latexFoldService),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true" }),
      EditorView.theme(
        {
          "&": { height: "100%" },
          ".cm-scroller": {
            fontFamily: "var(--font-mono)",
            fontSize: "var(--editor-font-size)",
          },
          ".cm-content": { padding: "var(--editor-pad-y) var(--editor-pad-x)" },
          ".cm-line": { lineHeight: "var(--editor-line-height)" },
          ".cm-gutters": {
            backgroundColor: "var(--panel-strong)",
            color: "var(--muted)",
            borderRight: "1px solid var(--border)",
          },
          ".cm-activeLine": { backgroundColor: "rgba(14, 99, 156, 0.08)" },
          ".cm-selectionBackground": { backgroundColor: "rgba(14, 99, 156, 0.2)" },
          ".cm-cursor": { borderLeftColor: "var(--accent)" },
          ".cm-matchingBracket": {
            backgroundColor: "rgba(214, 122, 31, 0.2)",
            outline: "1px solid rgba(214, 122, 31, 0.4)",
          },
        },
        { dark: false }
      ),
      flashLineField,
      ghostSuggestField,
      yCollab(ytext, provider.awareness, { undoManager }),
      autoCompileListener,
      outlineListener,
      statusListener,
      historyListener,
      cacheListener,
      syncListener,
      autoSuggestListener,
      typewriterListener,
      ghostKeymap,
    ],
  });

  const view = new EditorView({ state, parent: host });
  updateOutlineFromText(view.state.doc.toString());
  updateDocCaches(filePath, view.state.doc.toString());
  updateEditorStatus(view);

  const onlineEl = document.getElementById("onlineUsers");
  const updateOnline = () => {
    if (!onlineEl) return;
    const states = Array.from(provider.awareness.getStates().values());
    const users = new Map();
    for (const s of states) {
      if (!s || !s.user || !s.user.name) continue;
      const name = s.user.name;
      if (users.has(name)) continue;
      let line = null;
      let pos = null;
      if (s.cursor && s.cursor.head && ydoc) {
        try {
          const head = Y.createAbsolutePositionFromRelativePosition(s.cursor.head, ydoc);
          if (head && head.type === ytext) {
            pos = head.index;
            if (view && view.state && Number.isFinite(pos)) {
              line = view.state.doc.lineAt(pos).number;
            }
          }
        } catch {
          // ignore cursor conversion errors
        }
      }
      users.set(name, { name, color: s.user.color, light: s.user.colorLight, line, pos });
    }
    onlineEl.innerHTML = "";
    if (users.size === 0) {
      onlineEl.textContent = t("(无人)");
      return;
    }
    const list = h("span", { class: "presence-list" });
    for (const u of users.values()) {
      const chip = h("span", { class: "presence-chip" });
      chip.style.borderColor = u.color || "#0d727a";
      chip.style.background = u.light || "rgba(13, 114, 122, 0.12)";
      const dot = h("span", { class: "presence-dot" });
      dot.style.background = u.color || "#0d727a";
      chip.appendChild(dot);
      chip.appendChild(h("span", { class: "presence-name", html: u.name }));
      if (u.line) chip.appendChild(h("span", { class: "presence-line", html: `${t("行")}${u.line}` }));
      if (u.pos !== null && u.pos !== undefined) {
        chip.classList.add("clickable");
        chip.title = t("点击跳转到协作者光标");
        chip.addEventListener("click", () => {
          if (!view || !Number.isFinite(u.pos)) return;
          const ln = view.state.doc.lineAt(u.pos).number;
          view.dispatch({ selection: { anchor: u.pos }, scrollIntoView: true });
          view.focus();
          flashEditorLine(view, ln);
        });
      }
      list.appendChild(chip);
    }
    onlineEl.appendChild(list);
  };
  const syncStatus = (ev) => {
    providerStatus = ev && ev.status ? ev.status : "disconnected";
    app.editor.syncStatus = providerStatus;
    updateEditorStatus(view);
    if (providerStatus === "connected" && prefillTimer) {
      clearTimeout(prefillTimer);
      prefillTimer = null;
    }
    if (providerStatus === "connected") {
      if (app.ui.autoCompileArmTimer) {
        clearTimeout(app.ui.autoCompileArmTimer);
        app.ui.autoCompileArmTimer = null;
      }
      app.ui.autoCompileReady = true;
      if (app.ui.autoCompileDirty) scheduleCompile();
    }
  };

  const onSynced = (ev) => {
    if (ev && ev.state === true) {
      syncedOnce = true;
      if (prefillTimer) {
        clearTimeout(prefillTimer);
        prefillTimer = null;
      }
    }
  };

  provider.on("status", syncStatus);
  provider.on("synced", onSynced);
  provider.awareness.on("change", updateOnline);
  updateOnline();

  const maybePrefill = async () => {
    if (!projectId || !filePath) return;
    if (prefilled || syncedOnce) return;
    if (providerStatus === "connected") return;
    if (ytext.length > 0) return;
    try {
      const text = await api(`/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`);
      if (typeof text === "string" && text && ytext.length === 0 && !syncedOnce) {
        ytext.insert(0, text);
        prefilled = true;
      }
    } catch {
      // ignore prefill errors
    }
  };
  prefillTimer = setTimeout(maybePrefill, 1200);

  app.editor = {
    provider,
    ydoc,
    view,
    syncStatus: "connecting",
    cleanup: () => {
      provider.awareness.off("change", updateOnline);
      provider.off("status", syncStatus);
      provider.off("synced", onSynced);
      if (prefillTimer) clearTimeout(prefillTimer);
    },
  };
  updateEditorStatus(view);
  loadHistory(filePath)
    .then(async () => {
      if (!app.ui.historyEntries.length) {
        const size = view.state.doc.length || 0;
        const isLarge = size > 2_000_000;
        if (!isLarge) {
          const text = view.state.doc.toString();
          const hash = hashText(text);
          app.ui.historyHashByFile[filePath] = hash;
          try {
            await api(`/api/projects/${projectId}/history/snapshot`, {
              method: "POST",
              body: JSON.stringify({ file: filePath, content: text }),
            });
          } catch {
            // ignore baseline snapshot errors
          }
        } else {
          app.ui.historyLastSnapAt[filePath] = Date.now();
          try {
            await api(`/api/projects/${projectId}/history/snapshot`, {
              method: "POST",
              body: JSON.stringify({ file: filePath }),
            });
          } catch {
            // ignore baseline snapshot errors
          }
        }
        await loadHistory(filePath, { force: true });
      }
    })
    .catch(console.error);
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

  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const column = sel.head - line.from + 1;

  try {
    const res = await api(`/api/projects/${app.current.project.id}/synctex`, {
      method: "POST",
      body: JSON.stringify({
        file: app.current.openFile,
        line: line.number,
        column,
        target: getPdfTargetFile(app.current.project.id),
      }),
    });
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
  if (pdfSyncTimer) clearTimeout(pdfSyncTimer);
  pdfSyncTimer = setTimeout(() => {
    pdfSyncTimer = null;
    if (!app.compile.inFlight) {
      syncPdfToCursor({ silent: true }).catch(() => {});
    }
  }, 400);
}

let historySnapshotTimer = null;
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
      text = view.state.doc.toString();
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

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.floor(sec % 60);
  if (min < 60) return `${min}m${rem}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h${remMin}m`;
}

function formatTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString();
}

function formatMb(mb) {
  if (!Number.isFinite(mb)) return "-";
  return `${Math.round(mb)}MB`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(1)}GB`;
}

function diffLines(aText, bText) {
  const a = String(aText || "").split(/\r?\n/);
  const b = String(bText || "").split(/\r?\n/);
  const max = 2000;
  if (a.length > max || b.length > max) return { tooLarge: true };

  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "eq", line: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", line: a[i] });
      i += 1;
    } else {
      out.push({ type: "add", line: b[j] });
      j += 1;
    }
  }
  while (i < n) out.push({ type: "del", line: a[i++] });
  while (j < m) out.push({ type: "add", line: b[j++] });
  return { tooLarge: false, diff: out };
}

function buildDiffSnippet(diff, { context = 2, maxLines = 400 } = {}) {
  const out = [];
  let pre = [];
  let after = 0;
  let skipped = false;
  const pushSkip = () => {
    if (out.length && out[out.length - 1].type !== "skip") out.push({ type: "skip" });
  };
  for (const row of diff) {
    if (row.type === "eq") {
      if (after > 0) {
        out.push(row);
        after -= 1;
      } else {
        pre.push(row);
        if (pre.length > context) {
          pre.shift();
          skipped = true;
        }
      }
      continue;
    }
    if (skipped) {
      pushSkip();
      skipped = false;
    }
    if (pre.length) {
      for (const r of pre) out.push(r);
      pre = [];
    }
    out.push(row);
    after = context;
    if (out.length > maxLines) break;
  }
  if (out.length > maxLines) {
    out.length = maxLines;
    out.push({ type: "skip" });
  }
  return out;
}

function jobRuntime(job) {
  const now = Date.now();
  if (job.status === "running" && job.startedAt) {
    return formatDuration(now - Date.parse(job.startedAt));
  }
  if (job.status === "queued" && job.requestedAt) {
    return formatDuration(now - Date.parse(job.requestedAt));
  }
  if (Number.isFinite(job.durationMs)) return formatDuration(job.durationMs);
  return "-";
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
  if (!app.me || !app.me.isAdmin) return h("div", { class: "hint", html: t("管理员可见") });
  const data = app.ui.compileOverview;
  if (!data) return h("div", { class: "hint", html: t("暂无监控数据") });

  const cap = data.capacity || {};
  const sys = data.system || {};
  const usage = data.usage || {};
  const running = Array.isArray(data.running) ? data.running : [];
  const queued = Array.isArray(data.queued) ? data.queued : [];
  const recent = Array.isArray(data.recent) ? data.recent : [];

  const metric = (title, value, sub) =>
    h("div", { class: "metric-card" }, [
      h("div", { class: "metric-title", html: title }),
      h("div", { class: "metric-value", html: value }),
      sub ? h("div", { class: "metric-sub", html: sub }) : h("div"),
    ]);

  const jobRow = (job) =>
    h("div", { class: "job-row", "data-status": job.status || "" }, [
      h("div", { class: "job-project", html: job.projectId || "-" }),
      h("div", { class: "job-status", html: compileStatusLabel(job.status || "") }),
      h("div", { class: "job-mode", html: job.mode || "-" }),
      h("div", { class: "job-compiler", html: job.compiler || "-" }),
      h("div", { class: "job-time", html: jobRuntime(job) }),
    ]);

  return h("div", { class: "monitor-body-inner" }, [
    sectionTitle(t("编译资源")),
    h("div", { class: "monitor-grid" }, [
      metric(t("CPU 核心"), String(cap.cpuCount || "-"), t("最大并行") + ` ${cap.maxJobs || "-"}`),
      metric(t("内存"), formatMb(cap.totalMemMB), t("空闲内存") + ` ${formatMb(sys.freeMemMB)}`),
      metric(t("队列"), `${usage.activeCount || 0}/${cap.maxJobs || "-"}`, t("等待中") + ` ${usage.queuedCount || 0}`),
      metric(t("负载"), (sys.loadavg && sys.loadavg.length ? sys.loadavg.slice(0, 3).map((n) => n.toFixed(2)).join(" ") : "-"), t("运行时长") + ` ${formatDuration((sys.uptimeSec || 0) * 1000)}`),
    ]),
    sectionTitle(t("运行中")),
    h("div", { class: "job-table" }, [
      ...(running.length ? running.map(jobRow) : [h("div", { class: "hint", html: t("(无)") })]),
    ]),
    sectionTitle(t("等待中")),
    h("div", { class: "job-table" }, [
      ...(queued.length ? queued.map(jobRow) : [h("div", { class: "hint", html: t("(无)") })]),
    ]),
    sectionTitle(t("最近任务")),
    h("div", { class: "job-table" }, [
      ...(recent.length ? recent.slice(0, 8).map(jobRow) : [h("div", { class: "hint", html: t("(无)") })]),
    ]),
  ]);
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
  if (app.compile.inFlight) {
    app.compile.pending = true;
    app.compile.pendingClean = app.compile.pendingClean || clean;
    if (mode === "full" || app.compile.pendingMode !== "full") app.compile.pendingMode = mode;
    if (origin === "manual" || app.compile.pendingOrigin !== "manual") app.compile.pendingOrigin = origin;
    return;
  }
  app.compile.inFlight = true;
  if (origin !== "auto") {
    app.ui.autoCompileDirty = false;
    app.ui.autoCompileDirtyAt = 0;
    app.ui.lastAutoCompileAt = Date.now();
  }
  app.compile.pending = false;
  app.compile.pendingClean = false;
  app.compile.pendingMode = "full";
  app.compile.pendingOrigin = "manual";
  app.compile.diagnostics = [];
  app.compile.aiFix = "";
  app.compile.aiFixStatus = "";
  app.compile.status = "running";
  updateProblems([]);

  const projectId = app.current.project.id;
  await flushActiveFileToDisk();
  const logEl = document.getElementById("compileLog");
  const btnEl = document.getElementById("compileBtn");
  const statusEl = document.getElementById("compileStatus");

  const setStatus = (s) => {
    app.compile.status = s;
    if (statusEl) {
      statusEl.textContent = compileStatusLabel(s);
      statusEl.dataset.status = s;
    }
    if (s === "queued") setCompileStage(t("排队"));
    if (s === "running") setCompileStage(t("编译中"));
    if (s === "success") setCompileStage(t("成功"));
    if (s === "error") setCompileStage(t("失败"));
  };
  setStatus("running");
  app.compile.lastMode = mode;
  app.compile.lastEngine = app.current.compiler || "";
  app.compile.lastQueueMs = 0;
  app.compile.lastDurationMs = 0;
  app.compile.lastFinishedAt = "";
  updateCompileMetaView();

  const setBtnRunning = (running) => {
    if (!btnEl) return;
    btnEl.disabled = !!running;
    btnEl.classList.toggle("running", !!running);
    const labelEl = btnEl.querySelector(".compile-label");
    if (labelEl) labelEl.textContent = running ? t("编译中") : t("编译");
  };

  const appendLog = (s) => {
    if (logEl) {
      logEl.textContent += s;
      if (logEl.textContent.length > 2000000) logEl.textContent = logEl.textContent.slice(-2000000);
      logEl.scrollTop = logEl.scrollHeight;
    }
    const bottomLog = document.getElementById("bottomLog");
    if (bottomLog && app.ui.bottomMode === "log") {
      bottomLog.textContent += s;
      if (bottomLog.textContent.length > 2000000) bottomLog.textContent = bottomLog.textContent.slice(-2000000);
      bottomLog.scrollTop = bottomLog.scrollHeight;
    }
    updateCompileStageFromLog(s);
  };

  const noteDiagnostics = (job) => {
    const diags = job && Array.isArray(job.diagnostics) ? job.diagnostics : [];
    if (!diags.length) return false;
    const first = diags[0] || {};
    const fp = String(first.file || "");
    const line = first.line || 1;
    const msg = first.message || t("错误");
    appendLog(`${t("[错误] {msg}", { msg: `${fp}:${line} ${msg}` })}\n`);
    if (diags.length > 1) {
      appendLog(`${t("[错误] 还有 {n} 条", { n: diags.length - 1 })}\n`);
    }
    return true;
  };

  const focusErrorTab = (job) => {
    if (!app.ui.selectRightTab) return;
    if (job && job.status === "error") {
      const hasDiag = job.diagnostics && job.diagnostics.length > 0;
      app.ui.selectRightTab(hasDiag ? "problems" : "logs");
    }
  };
  const focusSuccessTab = (job) => {
    if (!app.ui.selectRightTab) return;
    if (job && job.status === "success") {
      app.ui.selectRightTab("pdf");
    }
  };

  const triggerAutoAiFix = async (job) => {
    if (!shouldAutoAiFix(job)) return;
    appendLog(`${t("[AI] 自动修复中...")}\n`);
    try {
      const patch = await runAiCompilePatch({ silent: true });
      if (patch && Array.isArray(patch.edits) && patch.edits.length) {
        await applyCompilePatchEdits(patch.edits);
        appendLog(`${t("已修复 {n} 个文件", { n: patch.edits.length })}\n`);
        compileProject({ mode: "quick", origin: "manual" }).catch(console.error);
      } else {
        appendLog(`${t("未返回可应用的修改")}\n`);
      }
    } catch {
      // ignore auto-fix failures
    }
  };

  const refreshPreview = async () => {
    await refreshPdfArtifacts(projectId, { refresh: true });
  };

  const pollJob = async (jobId) => {
    let lastLen = 0;
    for (let i = 0; i < 600; i++) {
      const { job } = await api(`/api/jobs/${jobId}`);
      const log = job && job.log ? String(job.log) : "";
      if (log && log.length > lastLen) {
        appendLog(log.slice(lastLen));
        lastLen = log.length;
      } else if (log && lastLen === 0) {
        appendLog(log);
        lastLen = log.length;
      }
      if (job && job.diagnostics) updateProblems(job.diagnostics);
      if (job && job.status) setStatus(job.status);
      if (job && job.status && job.status !== "running" && job.status !== "queued") {
        if (typeof job.queueMs === "number") {
          appendLog(`${t("[排队耗时] {sec}s", { sec: (job.queueMs / 1000).toFixed(2) })}\n`);
          app.compile.lastQueueMs = job.queueMs;
        }
        if (typeof job.durationMs === "number") {
          appendLog(`${t("[耗时] {sec}s", { sec: (job.durationMs / 1000).toFixed(2) })}\n`);
          app.compile.lastDurationMs = job.durationMs;
        }
        app.compile.lastFinishedAt = job.finishedAt || "";
        updateCompileMetaView();
        noteDiagnostics(job);
        focusErrorTab(job);
        focusSuccessTab(job);
        if (job && job.status === "success") syncPdfTargetToJob(job);
        if (job && job.status === "error" && app.ui.autoJumpError && job.diagnostics && job.diagnostics.length) {
          const first = job.diagnostics[0];
          if (first && first.file) {
            setTimeout(() => {
              openFileAt(first.file, first.line || 1).catch(console.error);
            }, 0);
          }
        }
        await refreshPreview();
        if (app.ui.autoSyncPdf) schedulePdfSync();
        if (job && job.status === "error" && app.ui.aiAutoDiagnose) {
          runAiCompileFix().catch(() => {
            app.compile.aiFixStatus = "error";
            updateAiFixSummary();
          });
        }
        if (job && job.status === "error") await triggerAutoAiFix(job);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(t("编译超时(轮询)"));
  };

  if (app.ui.selectRightTab) app.ui.selectRightTab("logs");
  setBtnRunning(true);
  if (logEl) logEl.textContent = "";
  appendLog(`${t("[开始] 编译中...")}\n`);

  try {
    const { jobId } = await api(`/api/projects/${projectId}/compile`, {
      method: "POST",
      body: JSON.stringify({ clean, mode, origin, mainFile: getPdfTargetFile(projectId) }),
    });
    if (app.compile.es) {
      try { app.compile.es.close(); } catch {}
      app.compile.es = null;
    }

    if (typeof EventSource === "undefined") {
      appendLog(`${t("[提示] EventSource 不可用，改用轮询。")}\n`);
      await pollJob(jobId);
      return;
    }

    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    app.compile.es = es;

    await new Promise((resolve, reject) => {
      let finished = false;
      let jobLogLen = 0;
      let pollStarted = false;
      const finalize = async (job) => {
        if (finished) return;
        finished = true;
        setStatus(job.status || "idle");
        app.compile.diagnostics = job.diagnostics || [];
        updateProblems(app.compile.diagnostics);
        if (typeof job.queueMs === "number") {
          appendLog(`${t("[排队耗时] {sec}s", { sec: (job.queueMs / 1000).toFixed(2) })}\n`);
          app.compile.lastQueueMs = job.queueMs;
        }
        if (typeof job.durationMs === "number") {
          appendLog(`${t("[耗时] {sec}s", { sec: (job.durationMs / 1000).toFixed(2) })}\n`);
          app.compile.lastDurationMs = job.durationMs;
        }
        app.compile.lastFinishedAt = job.finishedAt || "";
        updateCompileMetaView();
        noteDiagnostics(job);
        focusErrorTab(job);
        focusSuccessTab(job);
        if (job && job.status === "error" && app.ui.autoJumpError && job.diagnostics && job.diagnostics.length) {
          const first = job.diagnostics[0];
          if (first && first.file) {
            setTimeout(() => {
              openFileAt(first.file, first.line || 1).catch(console.error);
            }, 0);
          }
        }
        await refreshPreview();
        if (app.ui.autoSyncPdf) schedulePdfSync();
        if (job && job.status === "error" && app.ui.aiAutoDiagnose) {
          runAiCompileFix().catch(() => {
            app.compile.aiFixStatus = "error";
            updateAiFixSummary();
          });
        }
        if (job && job.status === "error") await triggerAutoAiFix(job);
        try { es.close(); } catch {}
        app.compile.es = null;
        resolve();
      };

      const startPoll = () => {
        if (pollStarted) return;
        pollStarted = true;
        (async () => {
          for (let i = 0; i < 600 && !finished; i++) {
            const { job } = await api(`/api/jobs/${jobId}`);
            if (finished) return;
            const log = job && job.log ? String(job.log) : "";
            if (log && log.length > jobLogLen) {
              appendLog(log.slice(jobLogLen));
              jobLogLen = log.length;
            }
            if (job && job.diagnostics) updateProblems(job.diagnostics);
            if (job && job.status) setStatus(job.status);
            if (job && job.status && job.status !== "running" && job.status !== "queued") {
              await finalize(job);
              return;
            }
            await new Promise((r) => setTimeout(r, 700));
          }
          if (!finished) throw new Error(t("编译超时(轮询)"));
        })().catch(reject);
      };

      // Fallback watchdog: if SSE is blocked or buffered, start polling.
      const watchdog = setTimeout(startPoll, 2500);

      es.addEventListener("init", (ev) => {
        try {
          const job = JSON.parse(ev.data);
          if (job.log) {
            appendLog(job.log);
            jobLogLen = Math.max(jobLogLen, String(job.log).length);
          }
          if (job.diagnostics) updateProblems(job.diagnostics);
          if (job.status) setStatus(job.status);
          if (job.status && job.status !== "running" && job.status !== "queued") {
            finalize(job).catch(reject);
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener("status", (ev) => {
        try {
          const job = JSON.parse(ev.data);
          if (job && job.status) setStatus(job.status);
        } catch {
          // ignore
        }
      });

      es.addEventListener("append", (ev) => {
        try {
          const { chunk } = JSON.parse(ev.data);
          if (chunk) {
            appendLog(chunk);
            jobLogLen += String(chunk).length;
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener("done", async (ev) => {
        try {
          const job = JSON.parse(ev.data);
          await finalize(job);
        } catch {
          // ignore
        }
      });

      es.onerror = async () => {
        try { es.close(); } catch {}
        app.compile.es = null;
        clearTimeout(watchdog);
        try {
          appendLog(`\n${t("[提示] 流连接断开，改用轮询...")}\n`);
          startPoll();
        } catch (e) {
          reject(e);
        }
      };

      es.onopen = () => {
        clearTimeout(watchdog);
        // Still start polling in the background if nothing arrives soon.
        setTimeout(() => {
          if (!finished && jobLogLen === 0) startPoll();
        }, 3000);
      };
    });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    if (e && e.status === 404 && /main file not found/i.test(msg || "")) {
      const now = Date.now();
      if (!app.compile.mainRepairTriedAt || now - app.compile.mainRepairTriedAt > 5000) {
        app.compile.mainRepairTriedAt = now;
        appendLog(`\n[fix] ${t("主文件未找到，正在重新选择...")}\n`);
        try {
          await loadProject(projectId);
          if (app.current && app.current.mainFile) {
            appendLog(`[fix] ${t("已切换主文件")}: ${app.current.mainFile}\n`);
          }
          app.compile.pending = true;
          app.compile.pendingClean = clean;
          app.compile.pendingMode = mode;
          app.compile.pendingOrigin = origin;
          return;
        } catch {
          // fall through to error
        }
      }
    }
    setStatus("error");
    appendLog(msg ? `\n[error] ${msg}\n` : `\n[error] ${String(e)}\n`);
  } finally {
    app.compile.inFlight = false;
    setBtnRunning(false);
    if (app.compile.pending) {
      compileProject({
        clean: app.compile.pendingClean,
        mode: app.compile.pendingMode,
        origin: app.compile.pendingOrigin || "manual",
      }).catch(console.error);
    }
  }
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

function acceptGhostSuggestion(view) {
  const suggestion = getGhostSuggestion(view);
  if (!suggestion) return false;
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, to: pos, insert: suggestion },
    effects: clearGhostSuggestEffect.of(null),
  });
  return true;
}

function dismissGhostSuggestion(view) {
  const suggestion = getGhostSuggestion(view);
  if (!suggestion) return false;
  clearGhostSuggestion(view);
  return true;
}

function scheduleAiCopilotSuggest(view) {
  if (!app.ui.aiAutoSuggest) return;
  if (!view) return;
  if (app.ai.suggestTimer) clearTimeout(app.ai.suggestTimer);
  app.ai.suggestTimer = setTimeout(() => {
    app.ai.suggestTimer = null;
    if (!app.ui.aiAutoSuggest) return;
    if (!view.hasFocus) return;
    if (getGhostSuggestion(view)) return;
    if (!view.state.selection.main.empty) return;
    const now = Date.now();
    if (now - (app.ai.suggestLastAt || 0) < 10000) return;
    aiCopilotSuggest();
  }, 900);
}

function scheduleAiHint(view) {
  if (!app.ui.aiAutoHint) return;
  if (!view) return;
  if (app.ai.hintTimer) clearTimeout(app.ai.hintTimer);
  app.ai.hintTimer = setTimeout(() => {
    app.ai.hintTimer = null;
    if (!app.ui.aiAutoHint) return;
    if (!view.hasFocus) return;
    if (!view.state.selection.main.empty) return;
    const now = Date.now();
    if (now - (app.ai.hintLastAt || 0) < 20000) return;
    runAiHint();
  }, 1500);
}

async function runAiHint() {
  const view = app.editor.view;
  if (!view) return;
  if (app.ai.hintInFlight) return;
  app.ai.hintInFlight = true;
  app.ui.aiHintStatus = "running";
  if (app.ui.refreshAiHint) app.ui.refreshAiHint();
  const para = getParagraphContext(view);
  if (!para.text.trim()) {
    app.ai.hintInFlight = false;
    app.ui.aiHintStatus = "";
    if (app.ui.refreshAiHint) app.ui.refreshAiHint();
    return;
  }
  const question = "请给出3条精炼修改建议，每条不超过20字，使用项目符号输出。";
  const payload = {
    context: para.text.slice(-AI_CONTEXT_LIMIT),
    question,
    history: [],
    filePath: app.current.openFile || "",
    mode: "assistant",
  };
  applyAiConfig(payload, "chat");
  try {
    const { result } = await api("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    app.ui.aiHint = String(result || "").trim();
    app.ui.aiHintStatus = "done";
    app.ai.hintLastAt = Date.now();
  } catch (e) {
    app.ui.aiHint = e && e.message ? e.message : String(e);
    app.ui.aiHintStatus = "error";
  } finally {
    app.ai.hintInFlight = false;
    if (app.ui.refreshAiHint) app.ui.refreshAiHint();
  }
}

async function aiCopilotSuggest() {
  const view = app.editor.view;
  if (!view) return alert(t("请先打开文件。"));
  if (app.ai.suggestInFlight) return;
  app.ai.suggestInFlight = true;
  clearGhostSuggestion(view);
  const para = getParagraphContext(view);
  if (!para.text.trim()) {
    app.ai.suggestInFlight = false;
    return;
  }
  const question =
    "基于上述段落，给出 1-2 句自然续写，仅输出需要插入的 LaTeX 连续文本，不要解释、不加代码块。";
  const payload = {
    context: para.text.slice(-AI_CONTEXT_LIMIT),
    question,
    history: [],
    filePath: app.current.openFile || "",
    mode: "assistant",
  };
  applyAiConfig(payload, "chat");
  try {
    const { result } = await api("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    let suggestion = String(result || "").trim();
    if (!suggestion) return;
    const fenced = extractLatexBlock(suggestion);
    if (fenced) suggestion = fenced;
    suggestion = suggestion.replace(/\s+$/g, "");
    if (!suggestion) return;
    const pos = view.state.selection.main.head;
    const existing = view.state.doc.sliceString(pos, Math.min(view.state.doc.length, pos + suggestion.length));
    if (normalizeWhitespace(existing) !== normalizeWhitespace(suggestion)) {
      setGhostSuggestion(view, suggestion.startsWith("\n") ? suggestion : ` ${suggestion}`);
      app.ai.suggestLastAt = Date.now();
    }
  } catch (e) {
    console.warn(e);
  } finally {
    app.ai.suggestInFlight = false;
  }
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

async function aiPolish({ mode = "polish", presetInstruction = "" } = {}) {
  const s = getEditorSelection();
  if (!s) return alert(t("请先打开文件。"));

  let sourceText = s.text;
  let from = s.from;
  let to = s.to;
  if (s.empty) {
    // Fallback: whole doc (confirm).
    if (!confirm(t("未选择内容，发送整个文件给 AI？"))) return;
    sourceText = s.view.state.doc.toString();
    from = 0;
    to = s.view.state.doc.length;
  }

  const instruction = h("textarea", { class: "textarea", placeholder: t("可选指令（例如：更学术、更简洁、保留术语）...") });
  const output = h("textarea", { class: "textarea", placeholder: t("AI 输出将显示在这里...") });
  output.readOnly = true;
  if (presetInstruction) instruction.value = presetInstruction;

  const presets = [
    { label: t("更学术"), text: "更学术、更正式，保留术语与 LaTeX。" },
    { label: t("更简洁"), text: "更简洁，去冗余，保留术语与 LaTeX。" },
    { label: t("扩写"), text: "在不改变含义前提下适度扩写，补充过渡句，保留 LaTeX。" },
    { label: t("摘要润色"), text: "仅润色摘要，突出贡献与结果，保留 LaTeX。" },
    { label: t("方法清晰"), text: "让方法描述更清晰，强调步骤与因果，保留 LaTeX。" },
    { label: t("术语统一"), text: "统一术语与缩写写法，修正不一致，保留 LaTeX。" },
    { label: t("翻译成英文"), text: "Translate to academic English, keep LaTeX commands intact." },
    { label: t("翻译成中文"), text: "翻译成中文，保留 LaTeX 命令与环境。" },
    { label: t("改为要点"), text: "改为条目列表，使用 LaTeX itemize 环境，保留术语。" },
  ];

  const presetList = h("div", { class: "ai-preset-list" });
  for (const p of presets) {
    const b = btn(p.label, {
      kind: "tiny",
      onClick: () => {
        instruction.value = p.text;
        instruction.focus();
      },
    });
    presetList.appendChild(b);
  }

  const body = h("div", {}, [
    h("div", { class: "hint", html: t("提示：先选中一段文字效果更好。") }),
    h("div", { class: "ai-presets" }, [
      h("div", { class: "label", html: t("预设") }),
      presetList,
    ]),
    h("div", { class: "label", html: t("指令") }),
    instruction,
    h("div", { class: "label", html: t("结果") }),
    output,
  ]);

  const runBtn = btn(t("运行 AI"), {
    kind: "primary",
    onClick: async () => {
      output.value = t("处理中...");
      try {
        const payload = { text: sourceText, instruction: instruction.value, mode };
        applyAiConfig(payload, "polish");
        const { result } = await api("/api/ai/polish", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        output.value = result || "";
      } catch (e) {
        output.value = e && e.message ? e.message : String(e);
      }
    },
  });

  const applyBtn = btn(t("替换选中"), {
    onClick: () => {
      if (!output.value) return;
      const cleaned = pickBestRewrite(output.value, sourceText);
      if (!cleaned) return;
      s.view.dispatch({ changes: { from, to, insert: cleaned } });
      closeModal();
    },
  });

  const insertBtn = btn(t("插入到下方"), {
    onClick: () => {
      if (!output.value) return;
      const cleaned = pickBestRewrite(output.value, sourceText);
      if (!cleaned) return;
      const insertPos = to;
      s.view.dispatch({ changes: { from: insertPos, to: insertPos, insert: `\n\n${cleaned}` } });
      closeModal();
    },
  });

  const modeLabel = mode === "polish" ? t("润色") : mode;
  showModal({ title: `AI ${modeLabel}`, bodyEl: body, actions: [runBtn, applyBtn, insertBtn] });
}

function extractAgentRewrite(text) {
  const raw = String(text || "");
  const fenceDirect = raw.match(/```(?:latex|tex)?\n([\s\S]*?)```/i);
  if (fenceDirect && fenceDirect[1]) return fenceDirect[1].trim();
  const markers = ["## Rewrite", "### Rewrite", "REWRITE:", "重写：", "改写："];
  let idx = -1;
  let marker = "";
  for (const m of markers) {
    const pos = raw.indexOf(m);
    if (pos !== -1) {
      idx = pos + m.length;
      marker = m;
      break;
    }
  }
  if (idx === -1) return raw.trim();
  const chunk = raw.slice(idx).trim();
  if (!chunk) return raw.trim();
  const fence = chunk.match(/```[\s\S]*?```/);
  if (fence) {
    return fence[0].replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return chunk;
}

function extractLatexBlock(text) {
  const raw = String(text || "");
  const fence = raw.match(/```(?:latex|tex)?\n([\s\S]*?)```/i);
  if (fence && fence[1]) return fence[1].trim();
  return "";
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeParagraphs(text) {
  const raw = String(text || "");
  const blocks = raw.split(/\n{2,}/);
  const out = [];
  let removed = 0;
  let lastNorm = null;
  for (const block of blocks) {
    const norm = normalizeWhitespace(block);
    if (!norm) {
      out.push(block);
      lastNorm = null;
      continue;
    }
    if (norm === lastNorm) {
      removed += 1;
      continue;
    }
    out.push(block);
    lastNorm = norm;
  }
  return { text: out.join("\n\n"), removed };
}

function pickBestRewrite(output, original) {
  const raw = String(output || "").trim();
  if (!raw) return "";
  const fenced = extractLatexBlock(raw);
  if (fenced) return fenced;

  const rewriteMatch = raw.match(/(?:^|\n)#+\s*Rewrite\s*[:：]?\s*\n([\s\S]+)$/i);
  if (rewriteMatch && rewriteMatch[1]) return rewriteMatch[1].trim();
  const rewriteZh = raw.match(/(?:^|\n)(?:改写|修改后|重写)\s*[:：]\s*([\s\S]+)$/);
  if (rewriteZh && rewriteZh[1]) return rewriteZh[1].trim();

  const candidate = extractAgentRewrite(raw).trim();
  if (!original) return candidate;

  const origNorm = normalizeWhitespace(original);
  const candNorm = normalizeWhitespace(candidate);
  if (!origNorm || candNorm === origNorm) return candidate;

  if (candidate.includes(original)) {
    const idx = candidate.lastIndexOf(original);
    const cleaned = (candidate.slice(0, idx) + candidate.slice(idx + original.length)).trim();
    if (cleaned && normalizeWhitespace(cleaned) !== origNorm) return cleaned;
  }

  const parts = candidate.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (normalizeWhitespace(parts[i]) !== origNorm) return parts[i];
    }
  }

  return candidate;
}

async function aiAgentReview() {
  const s = getEditorSelection();
  if (!s) return alert(t("请先打开文件。"));

  let sourceText = s.text;
  let from = s.from;
  let to = s.to;
  if (s.empty) {
    from = 0;
    to = s.view.state.doc.length;
    sourceText = s.view.state.doc.toString();
  }

  const instruction = h("textarea", {
    class: "textarea",
    placeholder: t("可选指令（例如：更学术、更简洁、保留术语）..."),
  });
  const output = h("textarea", { class: "textarea", placeholder: t("AI 输出将显示在这里...") });
  output.readOnly = true;

  const presets = [
    { label: t("审稿人模式"), text: "请以顶会审稿人视角指出问题、风险和不足，并给出修改方案。" },
    { label: t("结构优化"), text: "只关注结构与逻辑层次，给出章节调整与内容补齐建议。" },
    { label: t("摘要优化"), text: "只针对摘要改写，突出贡献与结果，保留 LaTeX。" },
    { label: t("术语一致性"), text: "检查术语一致性和表述统一性，指出不一致并给出改写。" },
  ];
  const presetList = h("div", { class: "ai-preset-list" });
  for (const p of presets) {
    const b = btn(p.label, {
      kind: "tiny",
      onClick: () => {
        instruction.value = p.text;
        instruction.focus();
      },
    });
    presetList.appendChild(b);
  }

  const modeSelect = h(
    "select",
    {
      class: "input ai-context-select",
      value: app.ui.aiContextMode || "selection",
      onchange: (ev) => {
        app.ui.aiContextMode = ev.target.value || "selection";
        localStorage.setItem("ct_ai_ctx_mode", app.ui.aiContextMode);
      },
    },
    [
      h("option", { value: "selection", html: t("选中段落") }),
      h("option", { value: "current", html: t("当前文件") }),
      h("option", { value: "all", html: t("全部 TeX") }),
    ]
  );

  const bibToggle = h("label", { class: "toggle ai-toggle" }, [
    h("input", {
      type: "checkbox",
      checked: app.ui.aiContextIncludeBib,
      onchange: (ev) => {
        app.ui.aiContextIncludeBib = ev.target.checked;
        localStorage.setItem("ct_ai_ctx_bib", app.ui.aiContextIncludeBib ? "1" : "0");
      },
    }),
    h("span", { html: t("包含参考文献") }),
  ]);

  const styleToggle = h("label", { class: "toggle ai-toggle" }, [
    h("input", {
      type: "checkbox",
      checked: app.ui.aiContextIncludeStyle,
      onchange: (ev) => {
        app.ui.aiContextIncludeStyle = ev.target.checked;
        localStorage.setItem("ct_ai_ctx_style", app.ui.aiContextIncludeStyle ? "1" : "0");
      },
    }),
    h("span", { html: t("包含样式文件") }),
  ]);

  const toggleRow = h("div", { class: "ai-context-row options" }, [
    h("div", { class: "label", html: t("上下文") }),
    h("div", { class: "ai-context-options" }, [bibToggle, styleToggle]),
  ]);

  const updateToggles = () => {
    const enabled = modeSelect.value === "all";
    bibToggle.querySelector("input").disabled = !enabled;
    styleToggle.querySelector("input").disabled = !enabled;
  };
  modeSelect.addEventListener("change", updateToggles);
  updateToggles();

  const body = h("div", {}, [
    h("div", { class: "hint", html: t("提示：先选中一段文字效果更好。") }),
    h("div", { class: "ai-presets" }, [
      h("div", { class: "label", html: t("预设") }),
      presetList,
    ]),
    h("div", { class: "ai-context-row model" }, [
      h("div", { class: "label", html: t("上下文来源") }),
      modeSelect,
    ]),
    toggleRow,
    h("div", { class: "label", html: t("指令") }),
    instruction,
    h("div", { class: "label", html: t("结果") }),
    output,
  ]);

  const runBtn = btn(t("运行 AI"), {
    kind: "primary",
    onClick: async () => {
      output.value = t("处理中...");
      try {
        const mode = modeSelect.value || "selection";
        let sourceText = "";
        if (mode === "selection") {
          sourceText = s.empty ? s.view.state.doc.toString() : s.text;
        } else if (mode === "current") {
          sourceText = s.view.state.doc.toString();
        } else {
          const texFiles = listTexFiles();
          const bibFiles = app.ui.aiContextIncludeBib ? listBibFiles() : [];
          const styleFiles = app.ui.aiContextIncludeStyle ? listStyleFiles() : [];
          const files = [...texFiles, ...bibFiles, ...styleFiles];
          const res = await buildContextFromFiles(files, AI_CONTEXT_LIMIT);
          sourceText = res.text || "";
        }
        if (!sourceText.trim()) {
          output.value = t("上下文未设置");
          return;
        }
        const question = instruction.value.trim() || "请作为论文修改代理，指出问题、给出修改建议，并提供改写后的 LaTeX。";
        const payload = {
          context: sourceText,
          question,
          history: [],
          filePath: app.current.openFile || "",
          mode: "agent",
        };
        applyAiConfig(payload, "chat");
        const { result } = await api("/api/ai/chat", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        output.value = result || "";
      } catch (e) {
        output.value = e && e.message ? e.message : String(e);
      }
    },
  });

  const applyBtn = btn(t("替换选中"), {
    onClick: () => {
      if (!output.value) return;
      const rewrite = pickBestRewrite(output.value, sourceText);
      if (!rewrite) return;
      s.view.dispatch({ changes: { from, to, insert: rewrite } });
      closeModal();
    },
  });

  const insertBtn = btn(t("插入到下方"), {
    onClick: () => {
      if (!output.value) return;
      const rewrite = pickBestRewrite(output.value, sourceText);
      if (!rewrite) return;
      const insertPos = to;
      s.view.dispatch({ changes: { from: insertPos, to: insertPos, insert: `\n\n${rewrite}` } });
      closeModal();
    },
  });

  showModal({ title: t("论文代理"), bodyEl: body, actions: [runBtn, applyBtn, insertBtn] });
}

async function buildChatStateFromMode(selection, mode, session) {
  const filePath = app.current.openFile || app.current.mainFile || "";
  let baseContext = "";
  let contextTrimmed = false;
  let meta = { files: 0, total: 0, truncated: false };
  let source = mode;

  if (mode === "selection") {
    if (selection.empty) {
      source = "current";
    } else {
      baseContext = selection.text;
      if (baseContext.length > AI_CONTEXT_LIMIT) {
        baseContext = baseContext.slice(baseContext.length - AI_CONTEXT_LIMIT);
        contextTrimmed = true;
        meta.truncated = true;
      }
      meta = { files: filePath ? 1 : 0, total: baseContext.length, truncated: contextTrimmed };
    }
  }

  if (source === "current") {
    baseContext = selection.view.state.doc.toString();
    if (baseContext.length > AI_CONTEXT_LIMIT) {
      baseContext = baseContext.slice(baseContext.length - AI_CONTEXT_LIMIT);
      contextTrimmed = true;
      meta.truncated = true;
    }
    meta = { files: filePath ? 1 : 0, total: baseContext.length, truncated: contextTrimmed };
  }

  if (source === "all") {
    const texFiles = listTexFiles();
    const bibFiles = app.ui.aiContextIncludeBib ? listBibFiles() : [];
    const styleFiles = app.ui.aiContextIncludeStyle ? listStyleFiles() : [];
    const files = [...texFiles, ...bibFiles, ...styleFiles];
    const res = await buildContextFromFiles(files, AI_CONTEXT_LIMIT);
    baseContext = res.text || "";
    meta = { files: res.files.length, total: res.total, truncated: res.truncated };
    contextTrimmed = res.truncated;
  }

  const history = session && Array.isArray(session.history) ? session.history : [];

  const hint = contextTrimmed
    ? t("提示：上下文过长，已截断为最后 12000 字符。")
    : t("提示：仅使用当前 TeX 内容作为上下文。");

  return {
    filePath,
    context: baseContext,
    history,
    user: app.me.username,
    meta: { ...meta, source },
    sessionId: session ? session.id : null,
    labels: {
      title: t("AI 聊天"),
      send: t("发送"),
      clear: t("清空对话"),
      placeholder: t("输入你的问题..."),
      empty: t("暂无对话"),
      hint,
      fileLabel: source === "all" ? t("全部 TeX") : filePath || t("当前文件"),
    },
  };
}

function buildChatStateFromSession(session) {
  const meta = session.meta || { files: 0, total: 0, truncated: false, source: "current" };
  const source = meta.source || "current";
  const fileLabel = source === "all" ? t("全部 TeX") : session.filePath || t("当前文件");
  const hint = meta.truncated
    ? t("提示：上下文过长，已截断为最后 12000 字符。")
    : t("提示：仅使用当前 TeX 内容作为上下文。");
  return {
    filePath: session.filePath || "",
    context: session.context || "",
    history: session.history || [],
    user: app.me.username,
    meta,
    sessionId: session.id,
    labels: {
      title: t("AI 聊天"),
      send: t("发送"),
      clear: t("清空对话"),
      placeholder: t("输入你的问题..."),
      empty: t("暂无对话"),
      hint,
      fileLabel,
    },
  };
}

function renderChatModal(state) {
  const history = state.history || [];
  const messagesEl = h("div", { class: "ai-chat-messages" });
  const input = h("textarea", { class: "textarea ai-chat-input", placeholder: state.labels.placeholder });

  const renderMessages = () => {
    messagesEl.innerHTML = "";
    if (!history.length) {
      messagesEl.appendChild(h("div", { class: "hint", html: state.labels.empty }));
      return;
    }
    for (const msg of history) {
      const role = msg.role === "assistant" ? "assistant" : "user";
      const contentEl = h("div", { class: "ai-chat-content" });
      contentEl.textContent = msg.content || "";
      messagesEl.appendChild(
        h("div", { class: `ai-chat-msg ${role}` }, [
          h("div", { class: "ai-chat-meta", html: role === "assistant" ? "AI" : state.user }),
          contentEl,
        ])
      );
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const body = h("div", { class: "ai-chat" }, [
    h("div", { class: "hint", html: state.labels.hint }),
    h("div", { class: "label", html: state.labels.fileLabel }),
    messagesEl,
    input,
  ]);

  const sendBtn = btn(state.labels.send, {
    kind: "primary",
    onClick: async () => {
      const question = input.value.trim();
      if (!question) return;
      input.value = "";
      const priorHistory = history.slice();
      history.push({ role: "user", content: question });
      renderMessages();
      try {
        const payload = {
          context: state.context,
          question,
          history: priorHistory,
          filePath: state.filePath,
          mode: app.ui.aiChatMode === "agent" ? "agent" : "",
        };
        applyAiConfig(payload, "chat");
        const { result } = await api("/api/ai/chat", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        history.push({ role: "assistant", content: result || "" });
        renderMessages();
      } catch (e) {
        history.push({ role: "assistant", content: e && e.message ? e.message : String(e) });
        renderMessages();
      }
    },
  });

  const clearBtn = btn(state.labels.clear, {
    kind: "tiny",
    onClick: () => {
      history.length = 0;
      renderMessages();
    },
  });

  renderMessages();
  showModal({ title: state.labels.title, bodyEl: body, actions: [clearBtn, sendBtn] });
}

async function updateChatPanelFromSelection() {
  const s = getEditorSelection();
  if (!s) return alert(t("请先打开文件。"));
  const mode = app.ui.aiContextMode || "selection";
  const session = getActiveAiSession();
  const state = await buildChatStateFromMode(s, mode, session);
  if (!state) return;
  session.context = state.context;
  session.meta = state.meta;
  session.filePath = state.filePath;
  session.updatedAt = Date.now();
  app.ui.aiChatPanelState = state;
  saveAiSessions();
  if (app.ui.refreshChatPanel) app.ui.refreshChatPanel();
}

async function aiChat() {
  await updateChatPanelFromSelection();
  if (app.ui.selectRightTab) app.ui.selectRightTab("ai");
}

function renderChatPanel() {
  const container = h(
    "div",
    { class: `ai-panel split${app.ui.aiPanelCollapsed ? " collapsed" : ""}`, id: "aiPanel" }
  );

  const draw = () => {
    const frag = document.createDocumentFragment();
    const sessions = app.ui.aiSessions || [];
    if (!sessions.length) createAiSession();
    const activeSession = getActiveAiSession();
    let state = app.ui.aiChatPanelState;
    if (!state || state.sessionId !== activeSession.id) {
      state = buildChatStateFromSession(activeSession);
      app.ui.aiChatPanelState = state;
    }

    const modeSelect = h(
      "select",
      {
        class: "input ai-context-select",
        value: app.ui.aiContextMode || "selection",
        onchange: (ev) => {
          const mode = ev.target.value || "selection";
          app.ui.aiContextMode = mode;
          localStorage.setItem("ct_ai_ctx_mode", mode);
          if (app.ui.refreshChatPanel) app.ui.refreshChatPanel();
        },
      },
      [
        h("option", { value: "selection", html: t("选中段落") }),
        h("option", { value: "current", html: t("当前文件") }),
        h("option", { value: "all", html: t("全部 TeX") }),
      ]
    );

    const initBtn = btn(t("使用当前文稿"), {
      kind: "primary",
      onClick: () => {
        updateChatPanelFromSelection();
      },
    });

    const bibToggle = h("label", { class: "toggle ai-toggle" }, [
      h("input", {
        type: "checkbox",
        checked: app.ui.aiContextIncludeBib,
        disabled: (app.ui.aiContextMode || "selection") !== "all" ? "" : null,
        onchange: (ev) => {
          app.ui.aiContextIncludeBib = ev.target.checked;
          localStorage.setItem("ct_ai_ctx_bib", app.ui.aiContextIncludeBib ? "1" : "0");
        },
      }),
      h("span", { html: t("包含参考文献") }),
    ]);

    const styleToggle = h("label", { class: "toggle ai-toggle" }, [
      h("input", {
        type: "checkbox",
        checked: app.ui.aiContextIncludeStyle,
        disabled: (app.ui.aiContextMode || "selection") !== "all" ? "" : null,
        onchange: (ev) => {
          app.ui.aiContextIncludeStyle = ev.target.checked;
          localStorage.setItem("ct_ai_ctx_style", app.ui.aiContextIncludeStyle ? "1" : "0");
        },
      }),
      h("span", { html: t("包含样式文件") }),
    ]);

    const sessionList = h("div", { class: "ai-sessions" });
    const sessionHeader = h("div", { class: "ai-sessions-header" }, [
      h("div", { class: "ai-sessions-title", html: t("AI") }),
      h("div", { class: "ai-sessions-actions" }, [
        btn("+", {
          kind: "tiny",
          onClick: () => {
            const s = createAiSession();
            app.ui.aiChatPanelState = buildChatStateFromSession(s);
            if (app.ui.refreshChatPanel) app.ui.refreshChatPanel();
          },
        }),
        btn(app.ui.aiPanelCollapsed ? "»" : "«", {
          kind: "tiny",
          onClick: () => setAiPanelCollapsed(!app.ui.aiPanelCollapsed),
          title: t("会话列表"),
        }),
      ]),
    ]);
    const sessionItems = h("div", { class: "ai-sessions-list" });
    for (const s of sessions) {
      const active = s.id === activeSession.id;
      const title = s.title || "Chat";
      const updated = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "";
      const row = h("div", { class: `ai-session ${active ? "active" : ""}`.trim() }, [
        h("button", {
          class: "ai-session-title",
          title,
          onclick: () => setActiveAiSession(s.id),
          html: title,
        }),
        h("div", { class: "ai-session-meta", html: updated }),
        h("div", { class: "ai-session-actions" }, [
          btn("✎", {
            kind: "tiny",
            onClick: (ev) => {
              ev.stopPropagation();
              const next = prompt(t("重命名为"), title);
              if (!next || next === title) return;
              s.title = next.trim();
              s.updatedAt = Date.now();
              saveAiSessions();
              if (app.ui.refreshChatPanel) app.ui.refreshChatPanel();
            },
          }),
          btn("×", {
            kind: "tiny",
            onClick: (ev) => {
              ev.stopPropagation();
              const idx = sessions.findIndex((x) => x.id === s.id);
              if (idx !== -1) sessions.splice(idx, 1);
              if (!sessions.length) createAiSession();
              if (app.ui.aiActiveSessionId === s.id) {
                app.ui.aiActiveSessionId = sessions[0].id;
              }
              saveAiSessions();
              if (app.ui.refreshChatPanel) app.ui.refreshChatPanel();
            },
          }),
        ]),
      ]);
      sessionItems.appendChild(row);
    }
    sessionList.appendChild(sessionHeader);
    sessionList.appendChild(sessionItems);

    const panelMode = app.ui.aiPanelMode || "chat";
    const setPanelMode = (mode) => {
      app.ui.aiPanelMode = mode === "agent" ? "agent" : "chat";
      localStorage.setItem("ct_ai_panel_mode", app.ui.aiPanelMode);
      if (app.ui.refreshChatPanel) app.ui.refreshChatPanel();
    };

    const chatTab = btn(t("聊天"), {
      kind: "tiny",
      onClick: () => setPanelMode("chat"),
      title: t("AI 聊天"),
    });
    const agentTab = btn(t("代理"), {
      kind: "tiny",
      onClick: () => setPanelMode("agent"),
      title: t("论文代理"),
    });
    if (panelMode === "chat") chatTab.classList.add("active");
    if (panelMode === "agent") agentTab.classList.add("active");
    const modeTabs = h("div", { class: "ai-panel-tabs" }, [chatTab, agentTab]);

    if (panelMode === "agent") {
      const instruction = h("textarea", {
        class: "textarea ai-agent-input",
        placeholder: t("可选指令（例如：更学术、更简洁、保留术语）..."),
      });
      const output = h("textarea", { class: "textarea ai-agent-output", placeholder: t("AI 输出将显示在这里...") });
      output.readOnly = true;
      const previewText = state.context ? state.context.slice(-4000) : "";
      const contextPreview = h("textarea", {
        class: "textarea ai-agent-context",
        value: previewText,
        readOnly: true,
      });

      const runBtn = btn(t("运行代理"), {
        kind: "primary",
        onClick: async () => {
          if (!state.context) {
            await updateChatPanelFromSelection();
          }
          const fresh = app.ui.aiChatPanelState || state;
          const question = instruction.value.trim() || "请作为论文修改代理，指出问题、给出修改建议，并提供改写后的 LaTeX。";
          const payload = {
            context: fresh.context || "",
            question,
            history: [],
            filePath: fresh.filePath || "",
            mode: "agent",
          };
          if (!payload.context.trim()) {
            output.value = t("上下文未设置");
            return;
          }
          output.value = t("处理中...");
          applyAiConfig(payload, "chat");
          try {
            const { result } = await api("/api/ai/chat", {
              method: "POST",
              body: JSON.stringify(payload),
            });
            output.value = result || "";
          } catch (e) {
            output.value = e && e.message ? e.message : String(e);
          }
        },
      });

      const applyAgentRewrite = (mode) => {
        const s = getEditorSelection();
        if (!s) return alert(t("请先打开文件。"));
        const fullText = s.view.state.doc.toString();
        const source = mode === "replaceAll" ? fullText : s.text;
        const rewrite = pickBestRewrite(output.value, source || fullText);
        if (!rewrite) return;
        if (mode === "replaceAll") {
          s.view.dispatch({ changes: { from: 0, to: s.view.state.doc.length, insert: rewrite } });
        } else if (mode === "replace" && !s.empty) {
          s.view.dispatch({ changes: { from: s.from, to: s.to, insert: rewrite } });
        } else {
          const pos = s.to;
          s.view.dispatch({ changes: { from: pos, to: pos, insert: `\n\n${rewrite}` } });
        }
        s.view.focus();
      };

      const applyBtn = btn(t("替换选中"), { onClick: () => applyAgentRewrite("replace") });
      const replaceAllBtn = btn(t("替换全文"), { onClick: () => applyAgentRewrite("replaceAll") });
      const insertBtn = btn(t("插入到下方"), { onClick: () => applyAgentRewrite("insert") });

      const agentPane = h("div", { class: "ai-agent-pane" }, [
        modeTabs,
        h("div", { class: "ai-context-row" }, [
          h("div", { class: "label", html: t("上下文来源") }),
          modeSelect,
          initBtn,
        ]),
        h("div", { class: "ai-context-row options" }, [
          h("div", { class: "label", html: t("上下文") }),
          h("div", { class: "ai-context-options" }, [bibToggle, styleToggle]),
        ]),
        h("div", { class: "ai-context-meta", html: `${t("上下文")}: ${describeContextMeta(state.meta)}` }),
        h("div", { class: "label", html: t("上下文预览") }),
        contextPreview,
        h("div", { class: "label", html: t("指令") }),
        instruction,
        h("div", { class: "ai-agent-actions" }, [runBtn, applyBtn, replaceAllBtn, insertBtn]),
        h("div", { class: "label", html: t("结果") }),
        output,
      ]);

      container.appendChild(sessionList);
      container.appendChild(agentPane);
      return;
    }

    const messagesEl = h("div", { class: "ai-chat-messages" });
    const input = h("textarea", { class: "textarea ai-chat-input", placeholder: state.labels.placeholder });
    const history = state.history || [];

    const renderMessages = () => {
      messagesEl.innerHTML = "";
      if (!history.length) {
        messagesEl.appendChild(h("div", { class: "hint", html: state.labels.empty }));
        return;
      }
      for (const msg of history) {
        const role = msg.role === "assistant" ? "assistant" : "user";
        const contentEl = h("div", { class: "ai-chat-content" });
        contentEl.textContent = msg.content || "";
        messagesEl.appendChild(
          h("div", { class: `ai-chat-msg ${role}` }, [
            h("div", { class: "ai-chat-meta", html: role === "assistant" ? "AI" : state.user }),
            contentEl,
          ])
        );
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    const sendMessage = async () => {
      if (!state.context) {
        alert(t("上下文未设置"));
        return;
      }
      const question = input.value.trim();
      if (!question) return;
      input.value = "";
      const priorHistory = history.slice();
      history.push({ role: "user", content: question });
      renderMessages();
      try {
        const payload = {
          context: state.context,
          question,
          history: priorHistory,
          filePath: state.filePath,
          mode: app.ui.aiChatMode === "agent" ? "agent" : "",
        };
        applyAiConfig(payload, "chat");
        const { result } = await api("/api/ai/chat", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        history.push({ role: "assistant", content: result || "" });
        activeSession.history = history;
        activeSession.updatedAt = Date.now();
        saveAiSessions();
        renderMessages();
      } catch (e) {
        history.push({ role: "assistant", content: e && e.message ? e.message : String(e) });
        activeSession.history = history;
        activeSession.updatedAt = Date.now();
        saveAiSessions();
        renderMessages();
      }
    };

    const sendBtn = btn(state.labels.send, {
      kind: "primary",
      onClick: () => sendMessage(),
    });

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        sendMessage();
      }
    });

    const clearBtn = btn(state.labels.clear, {
      kind: "tiny",
      onClick: () => {
        history.length = 0;
        activeSession.history = history;
        activeSession.updatedAt = Date.now();
        saveAiSessions();
        renderMessages();
      },
    });

    const refreshBtn = btn(t("更新上下文"), {
      kind: "tiny",
      onClick: () => {
        updateChatPanelFromSelection();
      },
    });

    const metaLine = h("div", { class: "ai-context-meta", html: `${t("上下文")}: ${describeContextMeta(state.meta)}` });

    const chatModeSelect = h("select", {
      class: "input ai-context-select",
      onchange: (ev) => {
        const next = ev.target.value === "agent" ? "agent" : "assistant";
        app.ui.aiChatMode = next;
        localStorage.setItem("ct_ai_chat_mode", next);
      },
    });
    chatModeSelect.appendChild(
      h("option", { value: "assistant", html: t("助手"), selected: app.ui.aiChatMode !== "agent" ? "" : null })
    );
    chatModeSelect.appendChild(
      h("option", { value: "agent", html: t("代理"), selected: app.ui.aiChatMode === "agent" ? "" : null })
    );

    const chatModelSelect = h("select", {
      class: "input ai-context-select",
      onchange: (ev) => {
        setAiProfileForMode("chat", ev.target.value);
      },
    });
    chatModelSelect.appendChild(
      h("option", { value: "", html: t("跟随当前模型"), selected: !getAiProfileForMode("chat") ? "" : null })
    );
    for (const p of app.ui.aiProfiles || []) {
      chatModelSelect.appendChild(
        h("option", { value: p.id, html: p.name || p.model || "Model", selected: p.id === getAiProfileForMode("chat") ? "" : null })
      );
    }

    const toggleSessionsBtn = btn(app.ui.aiPanelCollapsed ? t("会话列表") : t("会话列表"), {
      kind: "tiny",
      onClick: () => setAiPanelCollapsed(!app.ui.aiPanelCollapsed),
    });

    const header = h("div", { class: "ai-chat-header" }, [
      h("div", { class: "ai-chat-title", html: state.labels.title }),
      h("div", { class: "ai-chat-actions" }, [toggleSessionsBtn, refreshBtn, clearBtn]),
    ]);

    const quickActions = [
      { label: t("审稿意见"), text: "请以顶会审稿人视角给出主要问题、风险与改进建议。" },
      { label: t("结构建议"), text: "请给出结构与逻辑层次的改进建议，并指出缺失内容。" },
      { label: t("改写当前段落"), text: "请改写当前段落，使其更学术、更清晰，保留 LaTeX。" },
      { label: t("摘要改写"), text: "请改写摘要，突出贡献与结果，保留 LaTeX。" },
    ];
    const quickRow = h("div", { class: "ai-quick-actions" });
    for (const qa of quickActions) {
      quickRow.appendChild(
        btn(qa.label, {
          kind: "tiny",
          onClick: () => {
            input.value = qa.text;
            input.focus();
          },
        })
      );
    }

    const applyRewrite = (mode) => {
      const s = getEditorSelection();
      if (!s) return alert(t("请先打开文件。"));
      const last = history.slice().reverse().find((m) => m && m.role === "assistant" && m.content);
      let latex = last ? extractLatexBlock(last.content) : "";
      if (!latex && last && last.content) latex = pickBestRewrite(last.content, s.text);
      if (!latex) return alert(t("未找到可用的 LaTeX 片段"));
      if (mode === "replace" && !s.empty) {
        s.view.dispatch({ changes: { from: s.from, to: s.to, insert: latex } });
      } else {
        const pos = s.to;
        s.view.dispatch({ changes: { from: pos, to: pos, insert: `\n\n${latex}` } });
      }
      s.view.focus();
    };

    const applyBtn = btn(t("应用改写"), { kind: "tiny", onClick: () => applyRewrite("replace") });
    const insertBtn = btn(t("插入改写"), { kind: "tiny", onClick: () => applyRewrite("insert") });

    const chatPane = h("div", { class: "ai-chat-pane" }, []);
    chatPane.appendChild(modeTabs);
    chatPane.appendChild(h("div", { class: "ai-context-row" }, [
      h("div", { class: "label", html: t("上下文来源") }),
      modeSelect,
      initBtn,
    ]));
    chatPane.appendChild(h("div", { class: "ai-context-row model" }, [
      h("div", { class: "label", html: t("AI 模式") }),
      chatModeSelect,
    ]));
    chatPane.appendChild(h("div", { class: "ai-context-row model" }, [
      h("div", { class: "label", html: t("AI 模型") }),
      chatModelSelect,
    ]));
    chatPane.appendChild(h("div", { class: "ai-context-row options" }, [
      h("div", { class: "label", html: t("上下文") }),
      h("div", { class: "ai-context-options" }, [bibToggle, styleToggle]),
    ]));
    chatPane.appendChild(header);
    chatPane.appendChild(h("div", { class: "label", html: t("快速任务") }));
    chatPane.appendChild(quickRow);
    chatPane.appendChild(h("div", { class: "hint", html: state.labels.hint }));
    chatPane.appendChild(h("div", { class: "label", html: state.labels.fileLabel }));
    chatPane.appendChild(metaLine);
    chatPane.appendChild(messagesEl);
    chatPane.appendChild(input);
    chatPane.appendChild(h("div", { class: "ai-chat-footer" }, [applyBtn, insertBtn, sendBtn]));
    renderMessages();

    container.appendChild(sessionList);
    container.appendChild(chatPane);
  };

  draw();
  app.ui.refreshChatPanel = draw;
  return container;
}

async function refreshAiFloatContext({ silent = false } = {}) {
  const s = getEditorSelection();
  if (!s) {
    if (!silent) alert(t("请先打开文件。"));
    return false;
  }
  const mode = app.ui.aiContextMode || "selection";
  const session = getActiveAiSession();
  const state = await buildChatStateFromMode(s, mode, session);
  session.context = state.context;
  session.meta = state.meta;
  session.filePath = state.filePath;
  session.updatedAt = Date.now();
  app.ui.aiChatPanelState = state;
  saveAiSessions();
  if (app.ui.refreshAiFloat) app.ui.refreshAiFloat();
  return true;
}

async function openAiFloat() {
  if (!app.ui.assistantEnabled) return;
  if (app.ui.leftPaneTab !== "files") {
    app.ui.leftPaneTab = "files";
    localStorage.setItem("ct_left_pane_tab", "files");
  }
  app.ui.aiFloatOpen = true;
  localStorage.setItem("ct_ai_float", "1");
  await refreshAiFloatContext({ silent: true });
  mount(render());
  setTimeout(() => {
    const input = document.getElementById("aiFloatInput");
    if (input) input.focus();
  }, 0);
}

function closeAiFloat() {
  app.ui.aiFloatOpen = false;
  localStorage.setItem("ct_ai_float", "0");
  mount(render());
}

function toggleAiFloat() {
  if (app.ui.aiFloatOpen) closeAiFloat();
  else openAiFloat();
}

function renderAiFloat() {
  if (!app.ui.aiFloatOpen || !app.ui.assistantEnabled) return null;
  const activeSession = getActiveAiSession();
  let state = app.ui.aiChatPanelState;
  if (!state || state.sessionId !== activeSession.id) {
    state = buildChatStateFromSession(activeSession);
    app.ui.aiChatPanelState = state;
  }
  const history = state.history || [];
  const messagesEl = h("div", { class: "ai-chat-messages terminal", id: "aiFloatMessages" });
  const input = h("textarea", {
    class: "textarea ai-chat-input terminal",
    id: "aiFloatInput",
    placeholder: state.labels.placeholder,
  });

  const metaLine = h("div", { class: "ai-context-meta ai-float-meta", html: `${t("上下文")}: ${describeContextMeta(state.meta)}` });
  const hintLine = h("div", { class: "hint ai-float-hint", html: state.labels.hint });

  const renderMessages = () => {
    messagesEl.innerHTML = "";
    if (!history.length) {
      messagesEl.appendChild(h("div", { class: "hint", html: state.labels.empty }));
      return;
    }
    for (const msg of history) {
      const role = msg.role === "assistant" ? "assistant" : "user";
      const contentEl = h("div", { class: "ai-chat-content" });
      contentEl.textContent = msg.content || "";
      messagesEl.appendChild(
        h("div", { class: `ai-chat-msg ${role}` }, [
          h("div", { class: "ai-chat-meta", html: role === "assistant" ? "AI" : state.user }),
          contentEl,
        ])
      );
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const sendMessage = async () => {
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    if (!state.context) {
      await refreshAiFloatContext({ silent: true });
      state = app.ui.aiChatPanelState || state;
    }
    if (!state.context) {
      history.push({ role: "assistant", content: t("请先打开文件以生成上下文。") });
      renderMessages();
      return;
    }
    const priorHistory = history.slice();
    history.push({ role: "user", content: question });
    renderMessages();
    try {
      const payload = {
        context: state.context,
        question,
        history: priorHistory,
        filePath: state.filePath,
        mode: app.ui.aiChatMode === "agent" ? "agent" : "",
      };
      applyAiConfig(payload, "chat");
      const { result } = await api("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      history.push({ role: "assistant", content: result || "" });
      activeSession.history = history;
      activeSession.updatedAt = Date.now();
      saveAiSessions();
      renderMessages();
    } catch (e) {
      history.push({ role: "assistant", content: e && e.message ? e.message : String(e) });
      activeSession.history = history;
      activeSession.updatedAt = Date.now();
      saveAiSessions();
      renderMessages();
    }
  };

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendMessage();
    }
  });

  const clearBtn = btn(state.labels.clear, {
    kind: "tiny",
    onClick: () => {
      history.length = 0;
      activeSession.history = history;
      activeSession.updatedAt = Date.now();
      saveAiSessions();
      renderMessages();
    },
  });
  const refreshBtn = btn(t("更新上下文"), { kind: "tiny", onClick: () => refreshAiFloatContext({ silent: false }) });
  const closeBtn = btn("×", { kind: "tiny", onClick: () => closeAiFloat() });

  const modeSelect = h("select", {
    class: "input ai-float-select",
    onchange: (ev) => {
      const mode = ev.target.value || "selection";
      app.ui.aiContextMode = mode;
      localStorage.setItem("ct_ai_ctx_mode", mode);
    },
  });
  modeSelect.appendChild(h("option", { value: "selection", html: t("选中段落"), selected: app.ui.aiContextMode === "selection" ? "" : null }));
  modeSelect.appendChild(h("option", { value: "current", html: t("当前文件"), selected: app.ui.aiContextMode === "current" ? "" : null }));
  modeSelect.appendChild(h("option", { value: "all", html: t("全部 TeX"), selected: app.ui.aiContextMode === "all" ? "" : null }));

  const header = h("div", { class: "ai-float-header" }, [
    h("div", { class: "ai-float-title", html: t("AI 终端") }),
    h("div", { class: "ai-float-actions" }, [modeSelect, refreshBtn, clearBtn, closeBtn]),
  ]);

  const body = h("div", { class: "ai-float-body" }, [
    hintLine,
    metaLine,
    messagesEl,
    input,
  ]);

  const shell = h("div", { class: "ai-float-shell" }, [header, body]);
  const wrap = h("div", { class: "ai-float" }, [shell]);

  renderMessages();
  app.ui.refreshAiFloat = () => {
    state = app.ui.aiChatPanelState || state;
    metaLine.innerHTML = `${t("上下文")}: ${describeContextMeta(state.meta)}`;
    hintLine.innerHTML = state.labels.hint;
    renderMessages();
  };
  return wrap;
}

async function runAiCompileFix() {
  const logEl = document.getElementById("compileLog");
  const rawLog = (logEl && logEl.textContent) || app.current.lastLog || "";
  if (!rawLog || !rawLog.trim()) throw new Error(t("没有可用的编译日志"));
  app.compile.aiFixStatus = "running";
  updateAiFixSummary();

  const pid = app.current.project && app.current.project.id;
  const payload = {
    log: rawLog.slice(-12000),
    diagnostics: app.compile.diagnostics || [],
    mainFile: app.current.mainFile,
    targetFile: pid ? getPdfTargetFile(pid) : "",
    compiler: app.current.compiler,
  };
  if (Array.isArray(app.current.tree)) {
    const files = app.current.tree
      .filter((f) => /\.(tex|bib|cls|sty|bst|bbx|cbx|dbx)$/i.test(f))
      .slice(0, 200);
    if (files.length) payload.files = files;
  }
  applyAiConfig(payload, "diagnose");
  try {
    const { result } = await api("/api/ai/compile-fix", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    app.compile.aiFix = result || "";
    app.compile.aiFixStatus = "done";
    updateAiFixSummary();
    return result || "";
  } catch (e) {
    app.compile.aiFixStatus = "error";
    updateAiFixSummary();
    throw e;
  }
}

async function aiCompileFix() {
  const output = h("textarea", { class: "textarea", placeholder: t("AI 输出将显示在这里...") });
  output.readOnly = true;

  const body = h("div", {}, [
    h("div", { class: "hint", html: t("将使用最近的编译日志进行诊断。") }),
    output,
  ]);

  const runBtn = btn(t("运行 AI"), {
    kind: "primary",
    onClick: async () => {
      output.value = t("处理中...");
      try {
        const result = await runAiCompileFix();
        output.value = result || "";
      } catch (e) {
        app.compile.aiFixStatus = "error";
        updateAiFixSummary();
        output.value = e && e.message ? e.message : String(e);
      }
    },
  });

  showModal({ title: t("AI 诊断结果"), bodyEl: body, actions: [runBtn] });
}

function buildErrorSummary() {
  const diags = app.compile.diagnostics || [];
  if (diags.length) {
    return diags.map((d) => `${d.file}:${d.line || 1} ${d.message || ""}`.trim()).join("\n");
  }
  const logEl = document.getElementById("compileLog");
  const raw = (logEl && logEl.textContent) || app.current.lastLog || "";
  if (!raw.trim()) return "";
  const lines = raw.split(/\r?\n/);
  const errLines = lines.filter((l) => l.startsWith("!") || l.includes("Error") || l.includes("Fatal error"));
  if (errLines.length) return errLines.slice(-6).join("\n");
  return lines.slice(-20).join("\n");
}

function normalizeLogForSummary(logText) {
  let txt = String(logText || "").replace(/\r/g, "");
  txt = txt.replace(
    /([/\\][^\n]{0,240})\n([^\n]*\.(?:tex|bib|sty|cls|bst|bbx|cbx|dbx|png|pdf|jpg|jpeg|svg|eps):\d+:)/gi,
    "$1$2"
  );
  txt = txt.replace(/(LaTeX Error:[^\n]{0,120})\n([a-z].{0,120})/g, "$1 $2");
  return txt;
}

function cleanSummaryPath(line) {
  const marker = "/collabtex-data/projects/";
  const idx = line.lastIndexOf(marker);
  if (idx === -1) {
    if (/^-[0-9a-f]{6,}\//i.test(line)) return line.replace(/^-[0-9a-f]{6,}\//i, "");
    return line;
  }
  const rest = line.slice(idx + marker.length);
  const parts = rest.split("/");
  if (parts.length <= 1) return line;
  let rel = parts.slice(1).join("/");
  if (/^-[0-9a-f]{6,}\//i.test(rel)) rel = rel.replace(/^-[0-9a-f]{6,}\//i, "");
  return rel;
}

function extractKeyLines(logText) {
  const raw = normalizeLogForSummary(logText || "");
  if (!raw.trim()) return [];
  const lines = raw.split(/\r?\n/);
  const fileLine = /^(.+?):(\d+):\s+(.*)$/;
  const keys = [];
  let lastFile = null;
  let lastLine = null;
  for (const line of lines) {
    const m = line.match(fileLine);
    if (m) {
      lastFile = m[1];
      lastLine = Number(m[2]);
      const msg = String(m[3] || "").trim();
      if (/error|fatal|undefined|missing|not found|cannot|can't/i.test(msg)) {
        const entry = `${lastFile}:${lastLine} ${msg}`.trim();
        keys.push(cleanSummaryPath(entry));
      }
      continue;
    }
    if (line.startsWith("!")) {
      const msg = line.replace(/^!\s*/, "").trim();
      if (lastFile) {
        const entry = `${lastFile}:${lastLine || 1} ${msg}`.trim();
        keys.push(cleanSummaryPath(entry));
      } else {
        keys.push(cleanSummaryPath(msg));
      }
    }
  }
  const uniq = [];
  const seen = new Set();
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(k);
  }
  return uniq.slice(-8);
}

function buildDiagnosticSummary() {
  const diags = app.compile.diagnostics || [];
  const logEl = document.getElementById("compileLog");
  const rawLog = (logEl && logEl.textContent) || app.current.lastLog || "";
  const blocks = [];
  if (diags.length) {
    blocks.push(`${t("诊断摘要")}:`);
    blocks.push(...diags.slice(0, 8).map((d) => `${d.file}:${d.line || 1} ${d.message || ""}`.trim()));
  }
  const keyLines = extractKeyLines(rawLog);
  if (keyLines.length) {
    if (blocks.length) blocks.push("");
    blocks.push(`${t("关键行号")}:`);
    blocks.push(...keyLines);
  }
  return blocks.join("\n").trim();
}

function updateLogSummary() {
  const box = document.getElementById("compileSummaryBox");
  const textEl = document.getElementById("compileSummaryText");
  if (!box || !textEl) return;
  const summary = buildDiagnosticSummary();
  if (!summary) {
    box.style.display = "none";
    textEl.textContent = "";
    updateAiFixSummary();
    return;
  }
  textEl.textContent = summary;
  box.style.display = "";
  updateAiFixSummary();
}

function jumpToFirstError() {
  const diags = app.compile.diagnostics || [];
  if (!diags.length) return alert(t("没有可跳转的错误"));
  const first = diags[0];
  if (first && first.file) {
    openFileAt(first.file, first.line || 1).catch(console.error);
  }
}

function updateAiFixSummary() {
  const box = document.getElementById("compileAiFixBox");
  const textEl = document.getElementById("compileAiFixText");
  if (!box || !textEl) return;
  const status = app.compile.aiFixStatus || "";
  if (!app.compile.aiFix && status !== "running" && status !== "error") {
    box.style.display = "none";
    textEl.textContent = "";
    return;
  }
  if (status === "running") {
    textEl.textContent = t("诊断中...");
  } else if (status === "error") {
    textEl.textContent = t("诊断失败");
  } else {
    textEl.textContent = app.compile.aiFix || "";
  }
  box.style.display = "";
}

function parseJsonFromText(raw) {
  if (!raw) return null;
  const fence = String(raw).match(/```json\\s*([\\s\\S]*?)```/i);
  const candidate = fence && fence[1] ? fence[1].trim() : String(raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // try extracting the first JSON object
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function cleanCompilePath(p) {
  return String(p || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

function resolveTreePath(candidate) {
  const tree = app.current.tree || [];
  if (tree.includes(candidate)) return candidate;
  const lower = candidate.toLowerCase();
  for (const f of tree) {
    if (f.toLowerCase() === lower) return f;
  }
  return "";
}

function extractCompileFixFilesFromLog(logText) {
  const raw = String(logText || "");
  const out = new Set();
  const re1 = /`([^`]+\\.(?:tex|bib|sty|cls|bst|bbx|cbx|dbx))`/gi;
  const re2 = /\\b([^\\s:]+\\.(?:tex|bib|sty|cls|bst|bbx|cbx|dbx))\\b/gi;
  let m;
  while ((m = re1.exec(raw))) out.add(m[1]);
  while ((m = re2.exec(raw))) out.add(m[1]);
  const keyLines = extractKeyLines(raw);
  for (const line of keyLines) {
    const match = line.match(/([^\\s:]+\\.(?:tex|bib|sty|cls|bst|bbx|cbx|dbx))/i);
    if (match) out.add(match[1]);
  }
  return Array.from(out);
}

function parseUsepackageSet(text) {
  const set = new Set();
  const raw = String(text || "");
  const re = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/gi;
  let m;
  while ((m = re.exec(raw))) {
    const names = String(m[1] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const n of names) set.add(n);
  }
  return set;
}

function insertPackagesIntoPreamble(text, packages) {
  const list = (packages || []).map((p) => String(p || "").trim()).filter(Boolean);
  if (!list.length) return null;
  const raw = String(text || "");
  const idx = raw.search(/\\begin\s*\{document\}/i);
  if (idx === -1) return null;
  let head = raw.slice(0, idx);
  const tail = raw.slice(idx);
  if (!head.endsWith("\n")) head += "\n";
  const insertLines = list.map((p) => `\\usepackage{${p}}`).join("\n") + "\n";
  return head + insertLines + tail;
}

function extractUndefinedCommands(logText) {
  const raw = String(logText || "");
  const lines = raw.split(/\r?\n/);
  const out = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !/Undefined control sequence/i.test(line)) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
      const m = lines[j].match(/\\[A-Za-z@]+/);
      if (m && m[0]) {
        out.add(m[0].slice(1));
        break;
      }
    }
  }
  return Array.from(out);
}

function extractUndefinedEnvironments(logText) {
  const raw = String(logText || "");
  const out = new Set();
  const re = /Environment\s+([A-Za-z*]+)\s+undefined/gi;
  let m;
  while ((m = re.exec(raw))) {
    if (m[1]) out.add(m[1]);
  }
  return Array.from(out);
}

function detectMissingPackages(logText, sourceText) {
  const pkgs = new Set();
  const text = String(sourceText || "");
  const hasPkgs = parseUsepackageSet(text);
  const hasBiblatex = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*biblatex[^}]*\}/i.test(text) || /\\printbibliography/i.test(text);

  const add = (pkg, cond = true) => {
    if (!cond) return;
    if (!hasPkgs.has(pkg)) pkgs.add(pkg);
  };

  const cmds = extractUndefinedCommands(logText);
  for (const c of cmds) {
    const key = c.toLowerCase();
    if (key === "toprule") add("booktabs");
    else if (key === "midrule") add("booktabs");
    else if (key === "bottomrule") add("booktabs");
    else if (key === "cmidrule") add("booktabs");
    else if (key === "includegraphics") add("graphicx");
    else if (key === "multirow") add("multirow");
    else if (key === "mathbb") add("amssymb");
    else if (key === "cfrac") add("amsmath");
    else if (key === "textcolor" || key === "color") add("xcolor");
    else if (key === "todo") add("todonotes");
    else if ((key === "citep" || key === "citet") && !hasBiblatex) add("natbib");
  }

  const envs = extractUndefinedEnvironments(logText);
  for (const e of envs) {
    const key = e.toLowerCase();
    if (key === "align" || key === "align*" || key === "gather" || key === "gather*" || key === "multline") add("amsmath");
    else if (key === "algorithm") add("algorithm");
    else if (key === "algorithmic") add("algorithmic");
    else if (key === "tikzpicture") add("tikz");
    else if (key === "axis") add("pgfplots");
  }

  if (/\\includegraphics\b/i.test(text)) add("graphicx");
  if (/\\toprule|\\midrule|\\bottomrule|\\cmidrule/i.test(text)) add("booktabs");
  if (/\\multirow\b/i.test(text)) add("multirow");
  if (/\\mathbb\b/i.test(text)) add("amssymb");
  if (/\\cfrac\b|\\dfrac\b|\\tfrac\b/i.test(text)) add("amsmath");
  if (/\\begin\{align\*?\}|\\begin\{gather\*?\}|\\begin\{multline\*?\}/i.test(text)) add("amsmath");
  if (/\\begin\{tikzpicture\}|\\usetikzlibrary/i.test(text)) add("tikz");
  if (/\\begin\{axis\}|\\addplot/i.test(text)) add("pgfplots");
  if (/\\textcolor\b|\\color\b/i.test(text)) add("xcolor");
  if ((/\\citep\b|\\citet\b/i.test(text)) && !hasBiblatex) add("natbib");

  return Array.from(pkgs);
}

function detectPreferredCompiler(logText, sourceText) {
  const raw = `${logText || ""}\n${sourceText || ""}`.toLowerCase();
  if (raw.includes("fontspec") || raw.includes("\\setmainfont") || raw.includes("xecjk") || raw.includes("\\setcjkmainfont")) {
    return "xelatex";
  }
  return "";
}

function needsDocumentSkeleton(logText, text) {
  const raw = String(text || "");
  if (/\\documentclass/i.test(raw)) return false;
  if (/\\begin\s*\{document\}/i.test(raw)) return true;
  const log = String(logText || "");
  if (/Missing \\begin\{document\}/i.test(log)) return true;
  if (/Environment\s+[A-Za-z*]+\s+undefined/i.test(log)) return true;
  return false;
}

function wrapWithDocumentSkeleton(text) {
  const raw = String(text || "");
  if (/\\documentclass/i.test(raw)) return null;
  const hasBegin = /\\begin\s*\{document\}/i.test(raw);
  const hasEnd = /\\end\s*\{document\}/i.test(raw);
  if (hasBegin && hasEnd) {
    return `\\documentclass{article}\n${raw}`;
  }
  const body = raw.trim();
  return `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
}

async function runHeuristicCompileFix() {
  const logEl = document.getElementById("compileLog");
  const rawLog = (logEl && logEl.textContent) || app.current.lastLog || "";
  if (!rawLog || !rawLog.trim()) return null;
  const projectId = app.current.project && app.current.project.id;
  if (!projectId) return null;
  const mainFile = getPdfTargetFile(projectId) || app.current.mainFile;
  if (!mainFile || !mainFile.endsWith(".tex")) return null;
  const originalText = await getCurrentFileText(mainFile);
  let updatedText = originalText;
  const reasons = [];
  if (needsDocumentSkeleton(rawLog, updatedText)) {
    const wrapped = wrapWithDocumentSkeleton(updatedText);
    if (wrapped && wrapped !== updatedText) {
      updatedText = wrapped;
      reasons.push(t("已补全文档结构"));
    }
  }
  const packages = detectMissingPackages(rawLog, updatedText);
  if (packages.length) {
    const updated = insertPackagesIntoPreamble(updatedText, packages);
    if (updated && updated !== updatedText) {
      updatedText = updated;
      reasons.push(`${t("已补充宏包")}: ${packages.join(", ")}`);
    }
  }
  const edits = [];
  if (updatedText !== originalText) {
    edits.push({
      path: mainFile,
      content: updatedText,
      reason: reasons.join(" · "),
    });
  }
  const preferredCompiler = detectPreferredCompiler(rawLog, updatedText);
  const compiler =
    preferredCompiler && preferredCompiler !== app.current.compiler ? preferredCompiler : "";

  if (!edits.length && !compiler) return null;
  return { edits, compiler, notes: edits.length ? `${t("已补充宏包")}: ${packages.join(", ")}` : "" };
}

function collectCompileFixFiles() {
  const files = [];
  const seen = new Set();
  const tree = app.current.tree || [];
  const diags = app.compile.diagnostics || [];
  for (const d of diags) {
    const raw = cleanCompilePath(d.file || "");
    const resolved = resolveTreePath(raw);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      files.push(resolved);
    }
  }
  const logEl = document.getElementById("compileLog");
  const rawLog = (logEl && logEl.textContent) || app.current.lastLog || "";
  for (const f of extractCompileFixFilesFromLog(rawLog)) {
    const cleaned = cleanCompilePath(f);
    const resolved = resolveTreePath(cleaned);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      files.push(resolved);
    }
  }
  const main = resolveTreePath(cleanCompilePath(app.current.mainFile || ""));
  if (main && !seen.has(main)) files.push(main);
  const fallback = tree.find((f) => f.endsWith(".tex"));
  if (fallback && !seen.has(fallback)) files.push(fallback);
  return files.slice(0, 6);
}

async function applyCompilePatchEdits(edits) {
  const projectId = app.current.project && app.current.project.id;
  if (!projectId || !Array.isArray(edits) || !edits.length) return;
  for (const edit of edits) {
    const rel = resolveTreePath(cleanCompilePath(edit.path || ""));
    const path = rel || cleanCompilePath(edit.path || "");
    if (!path) continue;
    const content = String(edit.content || "");
    if (app.current.openFile === path) {
      if (!replaceEditorContent(content)) {
        await api(`/api/projects/${projectId}/file`, {
          method: "POST",
          body: JSON.stringify({ path, content }),
        });
      }
      updateDocCaches(path, content);
    } else {
      await api(`/api/projects/${projectId}/file`, {
        method: "POST",
        body: JSON.stringify({ path, content }),
      });
    }
  }
  await loadProject(projectId);
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();
}

function shouldAutoAiFix(job) {
  if (!app.ui.aiAutoFix) return false;
  if (!job || job.status !== "error") return false;
  if (app.compile.aiPatchStatus === "running") return false;
  const now = Date.now();
  if (app.compile.lastAiAutoFixAt && now - app.compile.lastAiAutoFixAt < 3000) return false;
  app.compile.lastAiAutoFixAt = now;
  return true;
}

function setAiOneClickProgress(step, state = "running") {
  app.compile.aiOneClickStep = step || "";
  app.compile.aiOneClickStatus = state || "";
  app.compile.aiOneClickMark = Date.now();
  const btnEl = document.getElementById("aiOneClickFixBtn");
  if (btnEl) btnEl.disabled = state === "running";
  const el = document.getElementById("aiOneClickProgress");
  if (!el) return;
  if (!step) {
    el.textContent = "";
    el.dataset.state = "";
    el.style.display = "none";
    return;
  }
  el.textContent = step;
  el.dataset.state = state || "";
  el.style.display = "inline-flex";
}

function clearAiOneClickProgress(delay = 0) {
  const mark = app.compile.aiOneClickMark;
  const clearNow = () => {
    if (app.compile.aiOneClickMark !== mark) return;
    setAiOneClickProgress("", "");
  };
  if (delay > 0) setTimeout(clearNow, delay);
  else clearNow();
}

async function flushActiveFileToDisk() {
  const projectId = app.current.project && app.current.project.id;
  const filePath = app.current.openFile;
  if (!projectId || !filePath) return;
  if (isAssetFile(filePath) || isFolderPlaceholder(filePath)) return;
  if (!app.editor || !app.editor.view) return;
  try {
    const content = app.editor.view.state.doc.toString();
    await api(`/api/projects/${projectId}/file`, {
      method: "POST",
      body: JSON.stringify({ path: filePath, content }),
    });
    updateDocCaches(filePath, content);
  } catch {
    // ignore flush errors
  }
}

function syncPdfTargetToJob(job) {
  if (!job || !job.mainFile) return;
  const mainFile = String(job.mainFile || "");
  if (!mainFile) return;
  if (app.current.mainFile !== mainFile) app.current.mainFile = mainFile;
  const pid = app.current.project && app.current.project.id;
  if (!pid) return;
  if (app.ui.pdfTargetFile !== mainFile) {
    app.ui.pdfTargetFile = mainFile;
    localStorage.setItem(`ct_pdfTarget_${pid}`, mainFile);
    resetPdfState();
    const select = document.getElementById("pdfTargetSelect");
    if (select) select.value = mainFile;
    const mainSelect = document.getElementById("mainSelect");
    if (mainSelect) mainSelect.value = mainFile;
  }
}

async function runAiCompilePatch({ silent = false } = {}) {
  const logEl = document.getElementById("compileLog");
  const rawLog = (logEl && logEl.textContent) || app.current.lastLog || "";
  if (!rawLog || !rawLog.trim()) {
    if (silent) return null;
    throw new Error(t("没有可用的编译日志"));
  }
  const pid = app.current.project && app.current.project.id;
  if (!pid) return null;

  let payload = {
    projectId: pid,
    log: rawLog.slice(-12000),
    diagnostics: app.compile.diagnostics || [],
    mainFile: app.current.mainFile,
    targetFile: pid ? getPdfTargetFile(pid) : "",
    compiler: app.current.compiler,
  };
  const useServer = !!app.ui.aiUseServer;
  if (useServer) {
    setBottomMode("terminal");
    appendBottomTerminal("[codex] start");
  }

  if (!useServer) {
    const files = collectCompileFixFiles();
    if (!files.length) {
      if (silent) return null;
      throw new Error(t("未找到可修复的文件"));
    }

    const filePayload = [];
    const skipped = [];
    for (const f of files) {
      try {
        const content = await getCurrentFileText(f);
        if (content && content.length > 80000) {
          skipped.push(f);
          continue;
        }
        filePayload.push({ path: f, content: content || "" });
      } catch {
        skipped.push(f);
      }
    }
    if (!filePayload.length) {
      if (silent) return null;
      throw new Error(t("未找到可修复的文件"));
    }

    payload = { ...payload, files: filePayload, skipped };
    applyAiConfig(payload, "diagnose");
  }
  app.compile.aiPatchStatus = "running";
  app.compile.aiPatch = null;
  try {
    const endpoint = useServer ? "/api/ai/compile-codex" : "/api/ai/compile-patch";
    const { result } = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    let parsed = null;
    if (result && typeof result === "object") {
      parsed = result;
    } else {
      parsed = parseJsonFromText(result);
    }
    if (!parsed) {
      parsed = { notes: result || "", edits: [] };
    } else {
      if (!Array.isArray(parsed.edits)) parsed.edits = [];
      if (!parsed.notes && typeof result === "string") parsed.notes = result;
    }
    if (useServer) {
      const notes = parsed && parsed.notes ? String(parsed.notes) : "";
      if (notes) appendBottomTerminal(`[codex]\n${notes}`);
      else appendBottomTerminal("[codex] done");
    }
    app.compile.aiPatch = parsed;
    app.compile.aiPatchStatus = "done";
    return parsed;
  } catch (e) {
    app.compile.aiPatchStatus = "error";
    if (useServer) {
      const msg = e && e.message ? e.message : String(e);
      appendBottomTerminal(`[codex] error: ${msg}`);
    }
    if (silent) return null;
    throw e;
  }
}

function showAiCompilePatchModal({ patch = null, auto = false } = {}) {
  const body = h("div", { class: "ai-patch-body" }, [
    h("div", { class: "hint", html: t("处理中...") }),
  ]);
  const applyAllBtn = btn(t("应用全部"), {
    kind: "primary",
    disabled: true,
    onClick: async () => {
      const patch = app.compile.aiPatch;
      if (!patch || !Array.isArray(patch.edits) || !patch.edits.length) return;
      try {
        await applyCompilePatchEdits(patch.edits);
        alert(t("应用完成"));
        closeModal();
      } catch (e) {
        alert(t("应用失败"));
      }
    },
  });
  const applyAndCompileBtn = btn(t("应用并重新编译"), {
    kind: "primary",
    disabled: true,
    onClick: async () => {
      const patch = app.compile.aiPatch;
      if (!patch || !Array.isArray(patch.edits) || !patch.edits.length) return;
      try {
        await applyCompilePatchEdits(patch.edits);
        closeModal();
        compileProject({ mode: "quick", origin: "manual" }).catch(console.error);
      } catch (e) {
        alert(t("应用失败"));
      }
    },
  });
  showModal({ title: t("AI 自动修复结果"), bodyEl: body, actions: [applyAllBtn, applyAndCompileBtn] });

  const renderResult = (patch) => {
    body.innerHTML = "";
    const notes = patch && patch.notes ? String(patch.notes) : "";
    if (notes) body.appendChild(h("pre", { class: "ai-patch-notes" }, [notes]));
    const edits = patch && Array.isArray(patch.edits) ? patch.edits : [];
    if (!edits.length) {
      body.appendChild(h("div", { class: "hint", html: t("未返回可应用的修改") }));
      return;
    }
    applyAllBtn.disabled = false;
    applyAndCompileBtn.disabled = false;
    for (const edit of edits) {
      const card = h("div", { class: "ai-patch-card" });
      const header = h("div", { class: "ai-patch-header" }, [
        h("div", { class: "ai-patch-file", html: edit.path || "" }),
        btn(t("应用此文件"), {
          kind: "tiny",
          onClick: async () => {
            try {
              await applyCompilePatchEdits([edit]);
              alert(t("应用完成"));
            } catch {
              alert(t("应用失败"));
            }
          },
        }),
      ]);
      const ta = h("textarea", { class: "textarea", value: String(edit.content || "") });
      ta.readOnly = true;
      card.appendChild(header);
      if (edit.reason) card.appendChild(h("div", { class: "hint", html: edit.reason }));
      card.appendChild(ta);
      body.appendChild(card);
    }
  };

  if (patch) {
    renderResult(patch);
    return;
  }
  runAiCompilePatch({ silent: !!auto })
    .then((patchResult) => {
      if (!patchResult) {
        body.innerHTML = "";
        body.appendChild(h("div", { class: "hint", html: t("未返回可应用的修改") }));
        return;
      }
      renderResult(patchResult);
    })
    .catch((e) => {
      body.innerHTML = "";
      body.appendChild(h("div", { class: "hint", html: e && e.message ? e.message : String(e) }));
    });
}

async function oneClickAiCompileFix() {
  if (app.compile.aiPatchStatus === "running") return;
  const logEl = document.getElementById("compileLog");
  if (logEl) logEl.textContent += `${t("AI 修复中...")}\n`;
  try {
    setAiOneClickProgress(t("AI 生成修改..."), "running");
    const patch = await runAiCompilePatch({ silent: false });
    if (!patch || !Array.isArray(patch.edits) || !patch.edits.length) {
      setAiOneClickProgress(t("AI 未返回修改"), "error");
      clearAiOneClickProgress(2500);
      alert(t("未返回可应用的修改"));
      return;
    }
    setAiOneClickProgress(t("AI 应用修改..."), "running");
    await applyCompilePatchEdits(patch.edits);
    setAiOneClickProgress(t("AI 重新编译..."), "running");
    await compileProject({ mode: "quick", origin: "manual" });
    setAiOneClickProgress(t("AI 修复完成"), "success");
    clearAiOneClickProgress(2500);
    alert(t("已自动修复并重新编译"));
  } catch (e) {
    setAiOneClickProgress(t("AI 修复失败"), "error");
    clearAiOneClickProgress(3000);
    alert(e && e.message ? e.message : String(e));
  }
}

async function copyCompileError() {
  const summary = buildErrorSummary();
  if (!summary) return alert(t("没有可复制的错误原因"));
  try {
    await navigator.clipboard.writeText(summary);
    alert(t("已复制错误原因"));
  } catch {
    const ta = h("textarea", { class: "textarea", value: summary });
    const body = h("div", {}, [
      h("div", { class: "hint", html: t("复制失败，请手动复制：") }),
      ta,
    ]);
    showModal({ title: t("复制错误"), bodyEl: body, actions: [] });
  }
}

async function copyDiagnosticSummary() {
  const summary = buildDiagnosticSummary();
  if (!summary) return alert(t("没有可复制的诊断摘要"));
  try {
    await navigator.clipboard.writeText(summary);
    alert(t("已复制诊断摘要"));
  } catch {
    const ta = h("textarea", { class: "textarea", value: summary });
    const body = h("div", {}, [
      h("div", { class: "hint", html: t("复制失败，请手动复制：") }),
      ta,
    ]);
    showModal({ title: t("诊断摘要"), bodyEl: body, actions: [] });
  }
}

function updateProblems(diags) {
  const host = document.getElementById("problemsList");
  if (!host) return;
  host.innerHTML = "";

  const list = Array.isArray(diags) ? diags : [];
  if (list.length === 0) {
    host.appendChild(h("div", { class: "hint", html: t("(无)") }));
    updateLogSummary();
    updateAiFixSummary();
    return;
  }

  for (const d of list.slice(0, 30)) {
    const fp = String(d.file || "").replace(/^\.\//, "");
    const line = d.line || 1;
    const msg = d.message || t("错误");
    host.appendChild(
      h("div", { class: "project-row" }, [
        h("div", { class: "project-meta" }, [
          h("div", { class: "project-name", html: `${fp}:${line}` }),
          h("div", { class: "hint", html: msg }),
        ]),
        btn(t("打开"), {
          onClick: async () => {
            await openFileAt(fp, line);
          },
        }),
      ])
    );
  }

  updateLogSummary();
  updateAiFixSummary();
}

async function loadHistory(filePath, { force = false } = {}) {
  const projectId = app.current.project && app.current.project.id;
  if (!projectId) return;
  if (!filePath) {
    app.ui.historyEntries = [];
    app.ui.historyFile = null;
    app.ui.historyLoading = false;
    if (app.ui.refreshHistory) app.ui.refreshHistory();
    return;
  }

  const targetFile = filePath;
  if (!force && app.ui.historyFile === filePath && app.ui.historyEntries.length) {
    if (app.ui.refreshHistory) app.ui.refreshHistory();
    return;
  }

  app.ui.historyLoading = true;
  app.ui.historyFile = targetFile;
  app.ui.historyError = "";
  if (app.ui.refreshHistory) app.ui.refreshHistory();

  try {
    const data = await api(`/api/projects/${projectId}/history?file=${encodeURIComponent(targetFile)}`);
    if (app.ui.historyFile !== targetFile) return;
    app.ui.historyEntries = Array.isArray(data && data.entries) ? data.entries : [];
  } catch (e) {
    console.warn(e);
    if (app.ui.historyFile === targetFile) {
      app.ui.historyEntries = [];
      app.ui.historyError = e && e.message ? e.message : String(e);
    }
  } finally {
    if (app.ui.historyFile === targetFile) {
      app.ui.historyLoading = false;
      if (app.ui.refreshHistory) app.ui.refreshHistory();
    }
  }
}

function replaceEditorContent(text) {
  const view = app.editor && app.editor.view;
  if (!view) return false;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text || "" },
  });
  view.focus();
  return true;
}

async function viewHistoryItem(entry) {
  const projectId = app.current.project && app.current.project.id;
  const file = app.ui.historyFile || app.current.openFile;
  if (!projectId || !file || !entry || !entry.id) return;
  try {
    const text = await api(
      `/api/projects/${projectId}/history/item?file=${encodeURIComponent(file)}&id=${encodeURIComponent(entry.id)}`
    );
    const ta = h("textarea", { class: "textarea", value: text || "" });
    ta.readOnly = true;
    const body = h("div", {}, [
      h("div", { class: "hint", html: `${file} · ${formatTime(entry.ts)}` }),
      ta,
    ]);
    const restoreBtn = btn(t("恢复"), {
      kind: "primary",
      onClick: async () => {
        closeModal();
        await restoreHistoryItem(entry);
      },
    });
    showModal({ title: t("历史"), bodyEl: body, actions: [restoreBtn] });
  } catch (e) {
    alert(e && e.message ? e.message : String(e));
  }
}

async function restoreHistoryItem(entry) {
  const projectId = app.current.project && app.current.project.id;
  const file = app.ui.historyFile || app.current.openFile;
  if (!projectId || !file || !entry || !entry.id) return;
  if (!confirm(t("恢复此版本？"))) return;
  try {
    const text = await api(
      `/api/projects/${projectId}/history/item?file=${encodeURIComponent(file)}&id=${encodeURIComponent(entry.id)}`
    );
    if (app.current.openFile !== file) {
      await openFile(file);
    }
    if (!replaceEditorContent(text)) {
      await api(`/api/projects/${projectId}/file`, {
        method: "POST",
        body: JSON.stringify({ path: file, content: text || "" }),
      });
    }
    await loadHistory(file, { force: true });
  } catch (e) {
    alert(e && e.message ? e.message : String(e));
  }
}

async function getCurrentFileText(file) {
  if (app.current.openFile === file && app.editor && app.editor.view) {
    return app.editor.view.state.doc.toString();
  }
  const projectId = app.current.project && app.current.project.id;
  if (!projectId) return "";
  return await api(`/api/projects/${projectId}/file?path=${encodeURIComponent(file)}`);
}

function listFilesByExts(exts) {
  if (!Array.isArray(app.current.tree)) return [];
  const set = new Set(exts.map((x) => String(x || "").toLowerCase()));
  return app.current.tree.filter((f) => set.has(fileExt(f)));
}

function listTexFiles() {
  return listFilesByExts([".tex"]);
}

function listBibFiles() {
  return listFilesByExts([".bib"]);
}

function listStyleFiles() {
  return listFilesByExts([".sty", ".cls", ".bst", ".bbx", ".cbx", ".dbx"]);
}

async function refreshBibKeyCache() {
  const projectId = app.current.project && app.current.project.id;
  if (!projectId) return;
  const files = listBibFiles();
  const byFile = {};
  const all = new Set();
  for (const f of files) {
    try {
      const text = await api(`/api/projects/${projectId}/file?path=${encodeURIComponent(f)}`);
      const keys = extractBibKeys(text);
      byFile[f] = keys;
      for (const k of keys) all.add(k);
    } catch {
      // ignore individual file errors
    }
  }
  app.ui.bibKeyCache = {
    projectId,
    keys: Array.from(all).sort(),
    byFile,
    updatedAt: Date.now(),
  };
}

async function refreshLabelCache() {
  const projectId = app.current.project && app.current.project.id;
  if (!projectId) return;
  const files = listTexFiles();
  const cache = {};
  for (const f of files) {
    try {
      const text = await api(`/api/projects/${projectId}/file?path=${encodeURIComponent(f)}`);
      cache[f] = extractLabels(text);
    } catch {
      // ignore individual file errors
    }
  }
  app.ui.labelCache = cache;
}

function fileGroupKey(filePath) {
  const ext = fileExt(filePath);
  if (ext === ".tex") return "tex";
  if (isAssetFile(filePath)) return "fig";
  if (ext === ".bib") return "bib";
  if (STYLE_EXTS.has(ext)) return "style";
  return "other";
}

function collectDirPaths(paths) {
  const dirs = new Set([""]);
  for (const p of paths || []) {
    const parts = String(p || "").split("/").filter(Boolean);
    if (parts.length <= 1) continue;
    let cur = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      cur = cur ? `${cur}/${parts[i]}` : parts[i];
      dirs.add(cur);
    }
  }
  return dirs;
}

function expandAllFolders() {
  const tree = Array.isArray(app.current.tree) ? app.current.tree : [];
  const dirs = collectDirPaths(tree);
  if (app.ui.fileView !== "all") {
    const groups = new Set(tree.map(fileGroupKey));
    for (const g of groups) dirs.add(`@group/${g}`);
  }
  app.ui.openFolders = dirs;
  app.ui.groupTreeInit = true;
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();
}

function collapseAllFolders() {
  app.ui.openFolders = new Set([""]);
  app.ui.groupTreeInit = true;
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();
}

function revealActiveFile() {
  const file = app.current.openFile;
  if (!file) return;
  const dirs = collectDirPaths([file]);
  const next = new Set(app.ui.openFolders || []);
  for (const d of dirs) next.add(d);
  if (app.ui.fileView !== "all") next.add(`@group/${fileGroupKey(file)}`);
  app.ui.openFolders = next;
  app.ui.groupTreeInit = true;
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();
  setTimeout(() => {
    const row = document.querySelector(".tree-row.file.active");
    if (row) row.scrollIntoView({ block: "center" });
  }, 0);
}

function toggleFileMultiSelect() {
  app.ui.fileMultiSelect = !app.ui.fileMultiSelect;
  app.ui.selectedFiles = new Set();
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();
}

function toggleFileSelection(path) {
  if (!app.ui.selectedFiles) app.ui.selectedFiles = new Set();
  if (app.ui.selectedFiles.has(path)) app.ui.selectedFiles.delete(path);
  else app.ui.selectedFiles.add(path);
  if (app.ui.refreshFileTree) app.ui.refreshFileTree();
}

async function deleteSelectedFiles() {
  const files = Array.from(app.ui.selectedFiles || []);
  if (!files.length) return;
  if (!confirm(t("确认删除 {name} ?", { name: files.join(", ") }))) return;
  const projectId = app.current.project && app.current.project.id;
  if (!projectId) return;
  for (const file of files) {
    try {
      await api(`/api/projects/${projectId}/file`, {
        method: "DELETE",
        body: JSON.stringify({ path: file }),
      });
    } catch {
      // ignore per-file failure
    }
    if (app.current.openFile === file) {
      app.current.openFile = null;
      cleanupEditor();
    }
    setOpenFiles(app.ui.openFiles.filter((p) => p !== file));
  }
  setPinnedFiles(app.ui.pinnedFiles.filter((p) => !files.includes(p)));
  app.ui.selectedFiles = new Set();
  await loadProject(projectId);
  cleanupEditor();
  mount(render());
}

async function moveSelectedFiles() {
  const files = Array.from(app.ui.selectedFiles || []);
  if (!files.length) return;
  const dest = prompt(t("移动到"), "");
  if (dest === null) return;
  const prefix = String(dest || "").trim().replace(/\/+$/, "");
  const projectId = app.current.project && app.current.project.id;
  if (!projectId) return;
  let nextPinned = Array.isArray(app.ui.pinnedFiles) ? app.ui.pinnedFiles.slice() : [];
  for (const file of files) {
    const base = fileBaseName(file);
    const newPath = prefix ? `${prefix}/${base}` : base;
    if (!newPath || newPath === file) continue;
    try {
      await api(`/api/projects/${projectId}/rename`, {
        method: "POST",
        body: JSON.stringify({ oldPath: file, newPath }),
      });
      setOpenFiles(app.ui.openFiles.map((p) => (p === file ? newPath : p)));
      if (app.current.openFile === file) app.current.openFile = newPath;
      nextPinned = remapPathList(nextPinned, file, newPath);
    } catch {
      // ignore per-file failure
    }
  }
  setPinnedFiles(nextPinned);
  app.ui.selectedFiles = new Set();
  await loadProject(projectId);
  cleanupEditor();
  mount(render());
}

async function buildContextFromFiles(files, limit = AI_CONTEXT_LIMIT) {
  let total = 0;
  let out = "";
  let truncated = false;
  const used = [];
  for (const f of files) {
    const header = `\n% ==== file: ${f} ====\n`;
    if (total + header.length > limit) {
      truncated = true;
      break;
    }
    out += header;
    total += header.length;
    const text = await getCurrentFileText(f);
    if (total + text.length > limit) {
      out += text.slice(0, Math.max(0, limit - total));
      total = out.length;
      truncated = true;
      used.push(f);
      break;
    }
    out += text + "\n";
    total = out.length;
    used.push(f);
  }
  return { text: out.trim(), total, truncated, files: used };
}

function describeContextMeta(meta) {
  if (!meta) return "";
  const parts = [
    `${t("文件数")}: ${meta.files || 0}`,
    `${t("长度")}: ${meta.total || 0}`,
  ];
  if (meta.truncated) parts.push(t("已截断"));
  return parts.join(" · ");
}

function aiSessionsKey() {
  const pid = app.current.project && app.current.project.id;
  return pid ? `ct_ai_sessions_${pid}` : "ct_ai_sessions";
}

function loadAiSessions() {
  const key = aiSessionsKey();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && s.id)
      .map((s) => ({
        id: String(s.id),
        title: String(s.title || "Chat"),
        history: Array.isArray(s.history) ? s.history.slice(0, 50) : [],
        context: String(s.context || ""),
        meta: s.meta || null,
        filePath: String(s.filePath || ""),
        updatedAt: s.updatedAt || Date.now(),
      }));
  } catch {
    return [];
  }
}

function saveAiSessions() {
  const key = aiSessionsKey();
  try {
    const sessions = app.ui.aiSessions || [];
    const trimmed = sessions.slice(0, 30).map((s) => ({
      id: s.id,
      title: s.title,
      history: Array.isArray(s.history) ? s.history.slice(0, 50) : [],
      context: String(s.context || "").slice(0, AI_CONTEXT_LIMIT),
      meta: s.meta || null,
      filePath: s.filePath || "",
      updatedAt: s.updatedAt || Date.now(),
    }));
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // ignore storage errors
  }
}

function newAiSessionTitle() {
  const count = (app.ui.aiSessions || []).length + 1;
  return `Chat ${count}`;
}

function createAiSession(title) {
  const id = `chat_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const session = {
    id,
    title: title || newAiSessionTitle(),
    history: [],
    context: "",
    meta: null,
    filePath: "",
    updatedAt: Date.now(),
  };
  app.ui.aiSessions.unshift(session);
  app.ui.aiActiveSessionId = id;
  saveAiSessions();
  return session;
}

function getActiveAiSession() {
  const sessions = app.ui.aiSessions || [];
  if (!sessions.length) return createAiSession();
  const activeId = app.ui.aiActiveSessionId;
  const found = sessions.find((s) => s.id === activeId);
  if (found) return found;
  app.ui.aiActiveSessionId = sessions[0].id;
  return sessions[0];
}

function setActiveAiSession(id) {
  app.ui.aiActiveSessionId = id;
  if (app.ui.refreshChatPanel) app.ui.refreshChatPanel();
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
  const container = h("div", { class: "history-panel", id: "historyPanel" });

  const draw = () => {
    container.innerHTML = "";
    const file = app.ui.historyFile || app.current.openFile;

    const header = h("div", { class: "history-header" }, [
      h("div", { class: "history-title", html: t("历史") }),
      h("div", { class: "history-file", html: file || t("请先打开文件。"), title: file || "" }),
      btn(t("刷新"), {
        kind: "tiny",
        onClick: () => {
          if (!file) return;
          loadHistory(file, { force: true }).catch(console.error);
        },
      }),
    ]);

    container.appendChild(header);

    if (!file) {
      container.appendChild(h("div", { class: "hint history-empty", html: t("请先打开文件。") }));
      return;
    }
    if (app.ui.historyLoading) {
      container.appendChild(h("div", { class: "hint history-empty", html: t("加载中...") }));
      return;
    }
    const entries = Array.isArray(app.ui.historyEntries) ? app.ui.historyEntries : [];
    if (app.ui.historyError) {
      container.appendChild(h("div", { class: "hint history-empty", html: `${t("历史记录加载失败")}: ${app.ui.historyError}` }));
      return;
    }
    if (!entries.length) {
      container.appendChild(h("div", { class: "hint history-empty", html: t("暂无历史记录") }));
      return;
    }

    const list = h("div", { class: "history-list" });
    for (const entry of entries.slice(0, 60)) {
      const meta = h("div", { class: "history-meta" }, [
        h("div", { class: "history-time", html: entry.ts ? new Date(entry.ts).toLocaleString() : "-" }),
        h("div", {
          class: "history-sub",
          html: `${entry.user || "-"} · ${formatBytes(entry.size || 0)}`,
        }),
      ]);
      const row = h("div", { class: "history-row" }, [
        meta,
        h("div", { class: "history-actions" }, [
          btn(t("查看"), { kind: "tiny", onClick: () => viewHistoryItem(entry) }),
          btn(t("对比"), { kind: "tiny", onClick: () => compareHistoryItem(entry) }),
          btn(t("恢复"), { kind: "tiny", onClick: () => restoreHistoryItem(entry) }),
        ]),
      ]);
      list.appendChild(row);
    }
    container.appendChild(list);
  };

  draw();
  app.ui.refreshHistory = draw;
  return container;
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
  if (app.view !== "project") return;
  if (!app.current.openFile) return alert(t("请先打开文件。"));
  const outline = Array.isArray(app.current.outline) ? app.current.outline.slice() : [];
  if (!outline.length) return alert(t("(未找到章节)"));

  const query = h("input", { class: "input", placeholder: t("大纲跳转") });
  query.autocomplete = "off";
  const list = h("div", { class: "quick-list" });
  const hint = h("div", { class: "quick-hint", html: t("回车打开，Esc 关闭") });

  let results = [];
  let selected = 0;

  const appendHighlighted = (el, text, q) => {
    if (!q) {
      el.textContent = text;
      return;
    }
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx === -1) {
      el.textContent = text;
      return;
    }
    el.appendChild(document.createTextNode(text.slice(0, idx)));
    const mark = h("span", { class: "quick-mark" });
    mark.textContent = text.slice(idx, idx + q.length);
    el.appendChild(mark);
    el.appendChild(document.createTextNode(text.slice(idx + q.length)));
  };

  const renderResults = () => {
    const q = query.value.trim().toLowerCase();
    const scored = outline
      .map((item, idx) => {
        const hay = `${item.title} ${item.kind}`.toLowerCase();
        const pos = q ? hay.indexOf(q) : 0;
        if (q && pos === -1) return null;
        return { item, score: q ? pos : idx };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40);

    results = scored.map((x) => x.item);
    if (selected >= results.length) selected = results.length - 1;
    if (selected < 0) selected = 0;

    list.innerHTML = "";
    if (!results.length) {
      list.appendChild(h("div", { class: "hint", html: t("(无结果)") }));
      return;
    }

    results.forEach((item, idx) => {
      const row = h("div", { class: `quick-item ${idx === selected ? "active" : ""}`.trim() });
      const meta = h("div", { class: "quick-meta" });
      const name = h("div", { class: "quick-name" });
      appendHighlighted(name, item.title || "(untitled)", query.value.trim());
      meta.appendChild(name);
      meta.appendChild(h("div", { class: "quick-path", html: `${item.kind} · ${t("行")} ${item.line}` }));
      row.appendChild(meta);
      row.addEventListener("click", async () => {
        closeModal();
        await openFileAt(app.current.openFile, item.line);
      });
      list.appendChild(row);
    });
  };

  const moveSelection = (delta) => {
    if (!results.length) return;
    selected = Math.max(0, Math.min(results.length - 1, selected + delta));
    const items = list.querySelectorAll(".quick-item");
    items.forEach((el, idx) => el.classList.toggle("active", idx === selected));
    const active = items[selected];
    if (active) active.scrollIntoView({ block: "nearest" });
  };

  query.addEventListener("input", () => {
    selected = 0;
    renderResults();
  });
  query.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      moveSelection(1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      moveSelection(-1);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const item = results[selected];
      if (item) {
        closeModal();
        openFileAt(app.current.openFile, item.line).catch(console.error);
      }
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeModal();
    }
  });

  const body = h("div", { class: "quick-body" }, [query, list, hint]);
  showModal({ title: t("大纲跳转"), bodyEl: body, actions: [] });
  renderResults();
  setTimeout(() => query.focus(), 0);
}

function showQuickOpen() {
  if (app.view !== "project") return;
  const allFiles = Array.isArray(app.current.tree)
    ? app.current.tree.filter((p) => !isFolderPlaceholder(p))
    : [];
  const recents = Array.isArray(app.ui.openFiles) ? app.ui.openFiles : [];

  const query = h("input", { class: "input", placeholder: t("输入过滤文件...") });
  query.autocomplete = "off";
  const list = h("div", { class: "quick-list" });
  const hint = h("div", { class: "quick-hint", html: t("回车打开，Esc 关闭") });

  let results = [];
  let selected = 0;

  const scorePath = (path, q) => {
    if (!q) return 0;
    const p = path.toLowerCase();
    const qq = q.toLowerCase();
    const idx = p.indexOf(qq);
    if (idx !== -1) return idx;
    let pi = 0;
    let qi = 0;
    let score = 0;
    while (pi < p.length && qi < qq.length) {
      if (p[pi] === qq[qi]) {
        score += pi;
        qi += 1;
      }
      pi += 1;
    }
    if (qi !== qq.length) return Number.POSITIVE_INFINITY;
    return 1000 + score;
  };

  const appendHighlighted = (el, text, q) => {
    if (!q) {
      el.textContent = text;
      return;
    }
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx === -1) {
      el.textContent = text;
      return;
    }
    el.appendChild(document.createTextNode(text.slice(0, idx)));
    const mark = h("span", { class: "quick-mark" });
    mark.textContent = text.slice(idx, idx + q.length);
    el.appendChild(mark);
    el.appendChild(document.createTextNode(text.slice(idx + q.length)));
  };

  const renderResults = () => {
    const q = query.value.trim();
    const scored = allFiles
      .map((p) => {
        const s = scorePath(p, q);
        const boost = recents.includes(p) ? -50 : 0;
        return { path: p, score: s + boost };
      })
      .filter((x) => Number.isFinite(x.score))
      .sort((a, b) => a.score - b.score)
      .slice(0, 30);

    results = scored.map((x) => x.path);
    if (selected >= results.length) selected = results.length - 1;
    if (selected < 0) selected = 0;

    list.innerHTML = "";
    if (results.length === 0) {
      list.appendChild(h("div", { class: "hint", html: t("(无结果)") }));
      return;
    }

    results.forEach((fp, idx) => {
      const base = fp.split("/").pop() || fp;
      const dir = fp.includes("/") ? fp.slice(0, fp.lastIndexOf("/")) : "";
      const row = h("div", { class: `quick-item ${idx === selected ? "active" : ""}`.trim() });
      const meta = h("div", { class: "quick-meta" });
      const name = h("div", { class: "quick-name" });
      appendHighlighted(name, base, q);
      meta.appendChild(name);
      if (dir) meta.appendChild(h("div", { class: "quick-path", html: dir }));
      row.appendChild(meta);
      if (recents.includes(fp)) row.appendChild(h("div", { class: "quick-tag", html: t("已打开") }));
      row.addEventListener("click", async () => {
        closeModal();
        await openFile(fp);
      });
      list.appendChild(row);
    });
  };

  const moveSelection = (delta) => {
    if (!results.length) return;
    selected = Math.max(0, Math.min(results.length - 1, selected + delta));
    const items = list.querySelectorAll(".quick-item");
    items.forEach((el, idx) => el.classList.toggle("active", idx === selected));
    const active = items[selected];
    if (active) active.scrollIntoView({ block: "nearest" });
  };

  query.addEventListener("input", () => {
    selected = 0;
    renderResults();
  });
  query.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      moveSelection(1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      moveSelection(-1);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const fp = results[selected];
      if (fp) {
        closeModal();
        openFile(fp).catch(console.error);
      }
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeModal();
    }
  });

  const body = h("div", { class: "quick-body" }, [query, list, hint]);
  showModal({ title: t("快速打开"), bodyEl: body, actions: [] });
  renderResults();
  setTimeout(() => query.focus(), 0);
}

function showProjectSearch() {
  if (app.view !== "project") return;
  const projectId = app.current.project && app.current.project.id;
  if (!projectId) return;

  const query = h("input", { class: "input", placeholder: t("搜索关键词...") });
  query.autocomplete = "off";

  const regexToggle = h("label", { class: "toggle" }, [
    h("input", { type: "checkbox" }),
    h("span", { html: t("正则") }),
  ]);
  const regexInput = regexToggle.querySelector("input");
  const caseToggle = h("label", { class: "toggle" }, [
    h("input", { type: "checkbox" }),
    h("span", { html: t("大小写敏感") }),
  ]);
  const caseInput = caseToggle.querySelector("input");

  const scopeSelect = h(
    "select",
    { class: "input search-scope", value: "tex" },
    [
      h("option", { value: "tex", html: t("仅 TeX") }),
      h("option", { value: "texbib", html: t("TeX + 参考文献") }),
      h("option", { value: "texbibstyle", html: t("TeX + Bib + 样式") }),
      h("option", { value: "all", html: t("全部文件") }),
    ]
  );

  const meta = h("div", { class: "search-meta hint" });
  const results = h("div", { class: "search-results" });

  const scopeToExts = (scope) => {
    if (scope === "tex") return [".tex"];
    if (scope === "texbib") return [".tex", ".bib"];
    if (scope === "texbibstyle") return [".tex", ".bib", ".sty", ".cls", ".bst", ".bbx", ".cbx", ".dbx"];
    return [];
  };

  const appendHighlighted = (el, text, q, useRegex, cs) => {
    if (!q) {
      el.textContent = text;
      return;
    }
    let re = null;
    try {
      const flags = cs ? "g" : "gi";
      re = new RegExp(useRegex ? q : escapeRegExp(q), flags);
    } catch {
      el.textContent = text;
      return;
    }
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = h("span", { class: "search-mark" });
      mark.textContent = m[0] || "";
      el.appendChild(mark);
      last = m.index + (m[0] || "").length;
      if (m.index === re.lastIndex) re.lastIndex += 1;
      if (last >= text.length) break;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  };

  let token = 0;
  const runSearch = async () => {
    const q = query.value.trim();
    if (!q) {
      meta.textContent = t("搜索关键词...");
      results.innerHTML = "";
      return;
    }
    const myToken = ++token;
    meta.textContent = t("正在搜索...");
    results.innerHTML = "";
    try {
      const payload = {
        query: q,
        regex: regexInput && regexInput.checked,
        caseSensitive: caseInput && caseInput.checked,
        exts: scopeToExts(scopeSelect.value),
        limit: 300,
      };
      const res = await api(`/api/projects/${projectId}/search`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (myToken !== token) return;
      const list = Array.isArray(res && res.results) ? res.results : [];
      if (!list.length) {
        results.appendChild(h("div", { class: "hint", html: t("未找到结果") }));
      } else {
        for (const r of list) {
          const row = h("div", { class: "search-row" });
          const left = h("div", { class: "search-main" });
          const title = h("div", { class: "search-title" });
          title.textContent = `${r.file}:${r.line}`;
          const snippet = h("div", { class: "search-snippet" });
          appendHighlighted(snippet, r.preview || "", q, payload.regex, payload.caseSensitive);
          left.appendChild(title);
          left.appendChild(snippet);
          row.appendChild(left);
          row.appendChild(
            btn(t("打开"), {
              kind: "tiny",
              onClick: async () => {
                closeModal();
                await openFileAt(r.file, r.line);
              },
            })
          );
          results.appendChild(row);
        }
      }
      const msg = t("搜索完成：{n} 条结果 / 扫描 {m} 个文件", {
        n: list.length,
        m: res && Number.isFinite(res.scanned) ? res.scanned : 0,
      });
      meta.textContent = res && res.truncated ? `${msg} · ${t("搜索被截断")}` : msg;
    } catch (e) {
      if (myToken !== token) return;
      meta.textContent = e && e.message ? e.message : String(e);
    }
  };

  query.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      runSearch();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeModal();
    }
  });

  const controls = h("div", { class: "search-controls" }, [
    query,
    btn(t("搜索"), { kind: "primary", onClick: runSearch }),
  ]);
  const options = h("div", { class: "search-options" }, [
    h("div", { class: "label", html: t("范围") }),
    scopeSelect,
    regexToggle,
    caseToggle,
  ]);

  const body = h("div", { class: "search-body" }, [controls, options, meta, results]);
  showModal({ title: t("项目搜索"), bodyEl: body, actions: [] });
  setTimeout(() => query.focus(), 0);
}

function detectDelimiter(line) {
  if (line.includes("\t")) return "\t";
  if (line.includes(";") && !line.includes(",")) return ";";
  return ",";
}

function parseTable(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = detectDelimiter(lines[0]);
  return lines.map((l) => l.split(delim).map((v) => v.trim()));
}

function isNumeric(val) {
  if (val === null || val === undefined) return false;
  const s = String(val).trim();
  if (!s) return false;
  return Number.isFinite(Number(s));
}

function generatePgfplots({
  type,
  table,
  header,
  xlabel,
  ylabel,
  title,
  caption,
  label,
  theme = "default",
  smooth = false,
  stacked = false,
}) {
  if (!table.length) return "";
  let rows = table;
  let seriesNames = [];
  if (header) {
    const head = rows[0];
    rows = rows.slice(1);
    seriesNames = head.slice(1).filter(Boolean);
  }
  if (!rows.length) return "";
  const xVals = rows.map((r) => r[0]);
  const xIsNumeric = xVals.every((x) => isNumeric(x));
  const seriesCount = Math.max(1, rows[0].length - 1);
  if (!seriesNames.length) {
    seriesNames = Array.from({ length: seriesCount }, (_, i) => `Series ${i + 1}`);
  }

  const palettes = {
    default: ["blue!70!black", "red!70!black", "green!60!black", "magenta!70!black", "cyan!60!black", "black"],
    vivid: ["blue", "red", "green", "magenta", "cyan", "black"],
    mono: ["black", "black!70", "black!55", "black!40", "black!25"],
  };
  const palette = palettes[theme] || palettes.default;
  const pickColor = (idx) => palette[idx % palette.length];

  const axis = [];
  axis.push("width=0.9\\\\linewidth");
  axis.push("height=0.55\\\\linewidth");
  if (xlabel) axis.push(`xlabel={${xlabel}}`);
  if (ylabel) axis.push(`ylabel={${ylabel}}`);
  if (title) axis.push(`title={${title}}`);
  axis.push("grid=both");
  axis.push("tick style={black!60}");
  axis.push("label style={font=\\\\small}");
  axis.push("legend style={font=\\\\small}");
  if (type === "bar") {
    axis.push(stacked ? "ybar stacked" : "ybar");
    axis.push("bar width=12pt");
    axis.push("enlarge x limits=0.15");
  }
  if (!xIsNumeric) {
    const uniq = [];
    const seen = new Set();
    for (const x of xVals) {
      const s = String(x).trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      uniq.push(s);
    }
    if (uniq.length) {
      axis.push(`symbolic x coords={${uniq.join(",")}}`);
      axis.push("xtick=data");
    }
  }
  if (seriesNames.length > 1) {
    axis.push("legend style={at={(0.5,-0.22)},anchor=north,legend columns=2}");
  }

  const lines = [];
  lines.push("\\\\begin{figure}[t]");
  lines.push("  \\\\centering");
  lines.push("  \\\\begin{tikzpicture}");
  lines.push(`    \\\\begin{axis}[${axis.join(", ")}]`);

  for (let s = 0; s < seriesCount; s += 1) {
    const coords = [];
    for (const r of rows) {
      if (!r.length) continue;
      const x = r[0];
      const y = r[s + 1];
      if (x === undefined || y === undefined || String(y).trim() === "") continue;
      coords.push(`(${x},${y})`);
    }
    const color = pickColor(s);
    const styleParts = [];
    if (type === "bar") {
      styleParts.push(`fill=${color}`, "draw=none");
      if (stacked) styleParts.push("area legend");
    } else {
      styleParts.push(`color=${color}`);
      if (type === "scatter") {
        styleParts.push("only marks", "mark=*");
      } else {
        styleParts.push("mark=*");
        if (smooth) styleParts.push("smooth");
      }
      styleParts.push("line width=1pt");
    }
    const style = styleParts.join(", ");
    lines.push(`      \\\\addplot+[${style}] coordinates {`);
    lines.push(`        ${coords.join(" ")}`);
    lines.push("      };");
    if (seriesNames[s]) lines.push(`      \\\\addlegendentry{${seriesNames[s]}}`);
  }

  lines.push("    \\\\end{axis}");
  lines.push("  \\\\end{tikzpicture}");
  if (caption) lines.push(`  \\\\caption{${caption}}`);
  if (label) lines.push(`  \\\\label{${label}}`);
  lines.push("\\\\end{figure}");
  return lines.join("\n");
}

function showChartBuilder() {
  if (app.view !== "project") return;
  const typeSelect = h("select", { class: "input" }, [
    h("option", { value: "line", html: t("折线图") }),
    h("option", { value: "bar", html: t("柱状图") }),
    h("option", { value: "scatter", html: t("散点图") }),
  ]);
  const styleSelect = h("select", { class: "input" }, [
    h("option", { value: "default", html: t("默认") }),
    h("option", { value: "vivid", html: t("鲜明") }),
    h("option", { value: "mono", html: t("灰度") }),
  ]);
  const headerToggle = h("label", { class: "toggle" }, [
    h("input", { type: "checkbox" }),
    h("span", { html: t("首行标题") }),
  ]);
  const smoothInput = h("input", { type: "checkbox" });
  const smoothToggle = h("label", { class: "toggle" }, [
    smoothInput,
    h("span", { html: t("平滑曲线") }),
  ]);
  const stackedInput = h("input", { type: "checkbox" });
  const stackedToggle = h("label", { class: "toggle" }, [
    stackedInput,
    h("span", { html: t("堆叠柱") }),
  ]);
  const dataInput = h("textarea", {
    class: "textarea",
    placeholder: "x,SeriesA,SeriesB\n1,2,3\n2,4,5\n3,6,7",
  });
  const xlabelInput = h("input", { class: "input", placeholder: t("X 轴") });
  const ylabelInput = h("input", { class: "input", placeholder: t("Y 轴") });
  const titleInput = h("input", { class: "input", placeholder: t("图标题") });
  const captionInput = h("input", { class: "input", placeholder: t("图注") });
  const labelInput = h("input", { class: "input", placeholder: "fig:chart" });
  const output = h("textarea", { class: "textarea", placeholder: t("AI 输出将显示在这里...") });
  output.readOnly = true;

  const generate = () => {
    const table = parseTable(dataInput.value);
    const code = generatePgfplots({
      type: typeSelect.value,
      table,
      header: !!headerToggle.querySelector("input").checked,
      theme: styleSelect.value,
      smooth: !!smoothInput.checked,
      stacked: !!stackedInput.checked,
      xlabel: xlabelInput.value.trim(),
      ylabel: ylabelInput.value.trim(),
      title: titleInput.value.trim(),
      caption: captionInput.value.trim(),
      label: labelInput.value.trim(),
    });
    output.value = code;
  };

  const insertBtn = btn(t("插入"), {
    kind: "primary",
    onClick: () => {
      if (!output.value) generate();
      if (!output.value) return;
      insertSnippet(`\n${output.value}\n`);
      closeModal();
    },
  });
  const copyBtn = btn(t("复制代码"), {
    kind: "tiny",
    onClick: async () => {
      if (!output.value) generate();
      if (!output.value) return;
      try {
        await navigator.clipboard.writeText(output.value);
      } catch {
        // ignore
      }
    },
  });

  const updateToggles = () => {
    smoothInput.disabled = typeSelect.value !== "line";
    stackedInput.disabled = typeSelect.value !== "bar";
  };
  typeSelect.addEventListener("change", updateToggles);
  updateToggles();

  const body = h("div", { class: "chart-body" }, [
    h("div", { class: "label", html: t("图表类型") }),
    typeSelect,
    h("div", { class: "label", html: t("图表风格") }),
    styleSelect,
    h("div", { class: "chart-toggles" }, [headerToggle, smoothToggle, stackedToggle]),
    h("div", { class: "label", html: t("数据") }),
    dataInput,
    h("div", { class: "chart-grid" }, [xlabelInput, ylabelInput, titleInput, captionInput, labelInput]),
    h("div", { class: "hint", html: t("需要在导言区引入 pgfplots") }),
    h("div", { class: "chart-actions" }, [
      btn(t("生成"), { kind: "primary", onClick: generate }),
      copyBtn,
    ]),
    output,
  ]);

  showModal({ title: t("图表生成"), bodyEl: body, actions: [insertBtn] });
}

function buildFigureSnippet({ filePath, width, caption, label }) {
  const widthVal = width && width.trim() ? width.trim() : "0.8\\linewidth";
  const lines = [
    "\\begin{figure}[t]",
    "  \\centering",
    `  \\includegraphics[width=${widthVal}]{${filePath}}`,
  ];
  if (caption && caption.trim()) lines.push(`  \\caption{${caption.trim()}}`);
  if (label && label.trim()) lines.push(`  \\label{${label.trim()}}`);
  lines.push("\\end{figure}");
  return lines.join("\n");
}

function showImageInsert() {
  if (app.view !== "project") return;
  const files = listImageFiles(app.current.tree || []);
  const filterInput = h("input", { class: "input", placeholder: t("筛选文件...") });
  const widthInput = h("input", { class: "input", value: "0.8\\linewidth" });
  const captionInput = h("input", { class: "input", placeholder: t("图注") });
  const labelInput = h("input", { class: "input", placeholder: "fig:label" });
  const fileList = h("div", { class: "file-list" });
  const hint = h("div", { class: "hint", html: files.length ? "" : t("暂无图片文件") });
  let selected = files[0] || "";

  const renderList = () => {
    fileList.innerHTML = "";
    const q = filterInput.value.trim().toLowerCase();
    const items = q ? files.filter((f) => f.toLowerCase().includes(q)) : files;
    if (!items.length) {
      fileList.appendChild(h("div", { class: "hint", html: t("(无匹配文件)") }));
      return;
    }
    for (const fp of items.slice(0, 160)) {
      const row = h("button", {
        class: `file-item${fp === selected ? " active" : ""}`.trim(),
        title: fp,
        onclick: () => {
          selected = fp;
          renderList();
        },
      });
      row.textContent = fp;
      fileList.appendChild(row);
    }
  };
  filterInput.addEventListener("input", renderList);
  renderList();

  const body = h("div", { class: "insert-image" }, [
    h("div", { class: "label", html: t("选择图片") }),
    filterInput,
    fileList,
    hint,
    h("div", { class: "label", html: t("插入设置") }),
    h("div", { class: "chart-grid" }, [widthInput, captionInput, labelInput]),
  ]);

  const insertBtn = btn(t("插入"), {
    kind: "primary",
    onClick: () => {
      if (!selected) return;
      const snippet = buildFigureSnippet({
        filePath: selected,
        width: widthInput.value,
        caption: captionInput.value,
        label: labelInput.value,
      });
      insertSnippet(`\n${snippet}\n`);
      closeModal();
    },
  });

  showModal({ title: t("插入图片"), bodyEl: body, actions: [insertBtn] });
}

function renderRecentFiles() {
  const list = Array.isArray(app.ui.openFiles) ? app.ui.openFiles.slice(0, 6) : [];
  if (!list.length) return null;
  const wrap = h("div", { class: "recent-files" });
  wrap.appendChild(h("div", { class: "recent-title", html: t("最近文件") }));
  const items = h("div", { class: "recent-list" });
  for (const fp of list) {
    const name = fileBaseName(fp);
    const row = h("button", {
      class: "recent-item",
      title: fp,
      onclick: () => openFile(fp).catch(console.error),
    });
    row.appendChild(h("span", { class: "recent-name", html: name }));
    row.appendChild(h("span", { class: "recent-path", html: fp }));
    items.appendChild(row);
  }
  wrap.appendChild(items);
  return wrap;
}

function renderPinnedFiles() {
  const list = Array.isArray(app.ui.pinnedFiles) ? app.ui.pinnedFiles.slice(0, 10) : [];
  if (!list.length) return null;
  const wrap = h("div", { class: "pinned-files", id: "pinnedFiles" });
  wrap.appendChild(h("div", { class: "recent-title", html: t("置顶文件") }));
  const items = h("div", { class: "recent-list" });
  for (const fp of list) {
    const name = fileBaseName(fp);
    const row = h("div", { class: "pinned-item" }, [
      h("button", {
        class: "recent-item",
        title: fp,
        onclick: () => openFile(fp).catch(console.error),
      }, [
        h("span", { class: "recent-name", html: name }),
        h("span", { class: "recent-path", html: fp }),
      ]),
      btn(t("取消置顶"), { kind: "tiny", onClick: () => togglePinnedFile(fp) }),
    ]);
    items.appendChild(row);
  }
  wrap.appendChild(items);
  app.ui.refreshPinnedFiles = () => {
    const next = renderPinnedFiles();
    if (!next) {
      wrap.remove();
      return;
    }
    wrap.replaceWith(next);
  };
  return wrap;
}

function isPathUnderPrefix(path, prefix) {
  if (!path || !prefix) return false;
  if (path === prefix) return true;
  return path.startsWith(`${prefix}/`);
}

function remapPathPrefix(path, fromPrefix, toPrefix) {
  const from = String(fromPrefix || "").replace(/\/+$/, "");
  const to = String(toPrefix || "").replace(/\/+$/, "");
  if (!from) return path;
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return path;
}

function remapPathList(list, fromPrefix, toPrefix) {
  const out = [];
  const seen = new Set();
  for (const p of list || []) {
    const next = remapPathPrefix(p, fromPrefix, toPrefix);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

function filterPathList(list, prefix) {
  return (list || []).filter((p) => !isPathUnderPrefix(p, prefix));
}

function remapPathSet(set, fromPrefix, toPrefix) {
  const out = new Set();
  for (const p of set || []) {
    const next = remapPathPrefix(p, fromPrefix, toPrefix);
    if (next) out.add(next);
  }
  return out;
}

function filterPathSet(set, prefix) {
  const out = new Set();
  for (const p of set || []) {
    if (!isPathUnderPrefix(p, prefix)) out.add(p);
  }
  return out;
}

function normalizeTagList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((v) => String(v || "").trim()).filter(Boolean)));
  }
  if (!value) return [];
  const raw = String(value || "");
  const parts = raw.split(/[,，;；]/).map((v) => v.trim()).filter(Boolean);
  return Array.from(new Set(parts)).slice(0, 20);
}

function formatTagList(tags) {
  const list = Array.isArray(tags) ? tags : normalizeTagList(tags || "");
  return list.filter(Boolean);
}

function projectMatchesFilter(project, filterText, category) {
  if (!project) return false;
  const cat = String(category || "all");
  if (cat && cat !== "all") {
    if (String(project.category || "") !== cat) return false;
  }
  const q = String(filterText || "").trim().toLowerCase();
  if (!q) return true;
  const tags = formatTagList(project.tags || []).join(" ").toLowerCase();
  const hay = [
    project.name,
    project.id,
    project.owner,
    project.category,
    tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function projectMatchesScope(project, scope, me) {
  if (!project) return false;
  const mode = String(scope || "all");
  if (mode === "mine") return !!me && project.owner === me.username;
  if (mode === "shared") return !!me && project.owner !== me.username;
  return true;
}

function formatProjectAge(project) {
  const stamp = project && (project.updatedAt || project.createdAt);
  const ts = stamp ? Date.parse(stamp) : NaN;
  if (!Number.isFinite(ts)) return "";
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("刚刚");
  if (mins < 60) return t("{n}分钟", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("{n}小时", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("{n}天", { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t("{n}月", { n: months });
  const years = Math.floor(months / 12);
  return t("{n}年", { n: years });
}

function renderFileTree() {
  const container = h("div", { class: "filetree", id: "fileTree" });

  const draw = () => {
    container.innerHTML = "";
    const frag = document.createDocumentFragment();
    const filter = app.ui.fileFilter.trim().toLowerCase();
    const baseList = app.current.tree || [];
    const viewList = app.ui.fileView === "all" ? baseList : baseList.filter((p) => isFocusFile(p));
    const list = filter ? viewList.filter((p) => p.toLowerCase().includes(filter)) : viewList;
    if (viewList.length === 0 && app.ui.fileView !== "all") {
      frag.appendChild(h("div", { class: "hint", html: t("暂无文稿文件") }));
      container.replaceChildren(frag);
      return;
    }
    if (list.length === 0) {
      frag.appendChild(h("div", { class: "hint", html: t("(无匹配文件)") }));
      container.replaceChildren(frag);
      return;
    }
    const getExt = (p) => {
      const lower = String(p || "").toLowerCase();
      const idx = lower.lastIndexOf(".");
      return idx === -1 ? "" : lower.slice(idx);
    };
    const groupDefs = [
      { key: "tex", label: t("TeX 文稿"), order: 1, match: (p) => getExt(p) === ".tex" },
      { key: "fig", label: t("图片/图表"), order: 2, match: (p) => isAssetFile(p) },
      { key: "bib", label: t("参考文献"), order: 3, match: (p) => getExt(p) === ".bib" },
      { key: "style", label: t("样式文件"), order: 4, match: (p) => STYLE_EXTS.has(getExt(p)) },
      { key: "other", label: t("其他"), order: 5, match: (_p) => true },
    ];

    const buildGroupedTree = (paths) => {
      const buckets = new Map();
      for (const def of groupDefs) buckets.set(def.key, []);
      for (const p of paths) {
        const def = groupDefs.find((d) => d.match(p)) || groupDefs[groupDefs.length - 1];
        buckets.get(def.key).push(p);
      }
      const root = { type: "dir", name: "", path: "", children: new Map() };
      for (const def of groupDefs) {
        const items = buckets.get(def.key) || [];
        if (!items.length) continue;
        const groupTree = buildTree(items);
        const node = {
          type: "dir",
          name: def.label,
          path: `@group/${def.key}`,
          group: true,
          order: def.order,
          children: groupTree.children,
        };
        root.children.set(def.key, node);
      }
      return root;
    };

    const tree = app.ui.fileView === "all" ? buildTree(list) : buildGroupedTree(list);
    const countCache = new Map();
    const countFiles = (node) => {
      if (!node) return 0;
      if (node.type === "file") return isFolderPlaceholder(node.path || node.name) ? 0 : 1;
      if (countCache.has(node)) return countCache.get(node);
      let total = 0;
      for (const child of node.children.values()) total += countFiles(child);
      countCache.set(node, total);
      return total;
    };

    const renderNode = (node, prefix, depth) => {
      for (const child of sortedChildren(node)) {
        const full = child.path || (prefix ? `${prefix}/${child.name}` : child.name);
        const rowStyle = `--indent:${Math.max(0, depth)}`;

        if (child.type === "dir") {
          const isGroup = !!child.group;
          const open =
            filter ? true : app.ui.openFolders.has(full) || (isGroup && !app.ui.groupTreeInit && !app.ui.openFolders.has(full));
          const toggleDir = () => {
            if (app.ui.openFolders.has(full)) app.ui.openFolders.delete(full);
            else app.ui.openFolders.add(full);
            draw();
          };
          const fileCount = countFiles(child);
          const countEl = fileCount > 0 ? h("span", { class: "tree-count", html: String(fileCount) }) : null;
          const actions = !isGroup
            ? (() => {
                const menuId = `tree:${encodeURIComponent(full)}`;
                const menuBtn = h("button", {
                  class: "tree-menu-btn",
                  title: t("操作"),
                  onclick: (ev) => toggleDropdown(menuId, ev),
                });
                menuBtn.appendChild(iconSvg("more", { size: 12 }));
                const menu = dropdownMenu(
                  menuId,
                  h("div", { class: "dropdown-panel tree-action-panel" }, [
                    btn(t("新文件夹"), {
                      kind: "menu-item",
                      onClick: async (ev) => {
                        ev.stopPropagation();
                        const rel = prompt(t("文件夹路径"), full ? `${full}/assets` : "assets");
                        const clean = String(rel || "").trim().replace(/\/+$/, "");
                        if (!clean) return;
                        await api(`/api/projects/${app.current.project.id}/file`, {
                          method: "POST",
                          body: JSON.stringify({ path: `${clean}/${FOLDER_PLACEHOLDER}`, content: "" }),
                        });
                        await loadProject(app.current.project.id);
                        cleanupEditor();
                        clearDropdowns();
                        mount(render());
                      },
                    }),
                    btn(t("重命名"), {
                      kind: "menu-item",
                      onClick: async (ev) => {
                        ev.stopPropagation();
                        const np = prompt(t("重命名为"), full);
                        if (!np || np === full) return;
                        const projectId = app.current.project && app.current.project.id;
                        const nextOpenFiles = remapPathList(app.ui.openFiles, full, np);
                        const nextSelected = remapPathSet(app.ui.selectedFiles, full, np);
                        const nextPinned = remapPathList(app.ui.pinnedFiles, full, np);
                        const nextOpenFile = app.current.openFile ? remapPathPrefix(app.current.openFile, full, np) : null;
                        await api(`/api/projects/${app.current.project.id}/rename`, {
                          method: "POST",
                          body: JSON.stringify({ oldPath: full, newPath: np }),
                        });
                        if (projectId) {
                          setOpenFiles(nextOpenFiles);
                          setPinnedFiles(nextPinned);
                          if (nextOpenFile) localStorage.setItem(lastOpenFileKey(projectId), nextOpenFile);
                        }
                        await loadProject(app.current.project.id);
                        app.ui.selectedFiles = nextSelected;
                        const filtered = nextOpenFiles.filter((p) => app.current.tree.includes(p));
                        if (filtered.length) setOpenFiles(filtered);
                        clearDropdowns();
                        if (nextOpenFile && app.current.tree.includes(nextOpenFile)) {
                          await openFile(nextOpenFile);
                          return;
                        }
                        cleanupEditor();
                        mount(render());
                      },
                    }),
                    btn(t("删除"), {
                      kind: "menu-item danger",
                      onClick: async (ev) => {
                        ev.stopPropagation();
                        if (!confirm(t("确认删除 {name} ?", { name: full }))) return;
                        const projectId = app.current.project && app.current.project.id;
                        const nextOpenFiles = filterPathList(app.ui.openFiles, full);
                        const nextSelected = filterPathSet(app.ui.selectedFiles, full);
                        const nextPinned = filterPathList(app.ui.pinnedFiles, full);
                        const wasOpen = app.current.openFile && isPathUnderPrefix(app.current.openFile, full);
                        await api(`/api/projects/${app.current.project.id}/file`, {
                          method: "DELETE",
                          body: JSON.stringify({ path: full }),
                        });
                        if (projectId) {
                          setOpenFiles(nextOpenFiles);
                          setPinnedFiles(nextPinned);
                          const last = localStorage.getItem(lastOpenFileKey(projectId)) || "";
                          if (last && isPathUnderPrefix(last, full)) localStorage.removeItem(lastOpenFileKey(projectId));
                        }
                        await loadProject(app.current.project.id);
                        app.ui.selectedFiles = nextSelected;
                        if (nextOpenFiles.length) {
                          const filtered = nextOpenFiles.filter((p) => app.current.tree.includes(p));
                          if (filtered.length) setOpenFiles(filtered);
                        }
                        clearDropdowns();
                        if (wasOpen) {
                          app.current.openFile = null;
                          cleanupEditor();
                          mount(render());
                          return;
                        }
                        cleanupEditor();
                        mount(render());
                      },
                    }),
                  ])
                );
                return h(
                  "div",
                  { class: "dropdown dropdown-right tree-action-wrap", "data-dropdown-id": menuId },
                  [menuBtn, menu]
                );
              })()
            : null;
          const metaChildren = [];
          if (countEl) metaChildren.push(countEl);
          if (actions) metaChildren.push(actions);
          const meta = metaChildren.length ? h("div", { class: "tree-meta" }, metaChildren) : null;
          const row = h(
            "div",
            { class: `tree-row dir ${isGroup ? "group" : ""}`.trim(), style: rowStyle, onclick: toggleDir, title: full },
            [
            h("button", {
              class: `tree-toggle ${open ? "open" : ""}`.trim(),
              title: open ? t("收起") : t("展开"),
              html: "",
              onclick: (ev) => {
                ev.stopPropagation();
                toggleDir();
              },
            }),
            h("div", { class: "tree-text" }, [
              h("button", {
                class: "tree-filebtn tree-dirname",
                html: child.name,
                title: full,
                onclick: (ev) => {
                  ev.stopPropagation();
                  toggleDir();
                },
              }),
            ]),
            meta,
          ]);
          frag.appendChild(row);
          if (open) renderNode(child, full, depth + 1);
          continue;
        }

          if (isFolderPlaceholder(full)) continue;
          const active = full === app.current.openFile;
          const multi = !!app.ui.fileMultiSelect;
          const selected = multi && app.ui.selectedFiles && app.ui.selectedFiles.has(full);
          const pinned = Array.isArray(app.ui.pinnedFiles) && app.ui.pinnedFiles.includes(full);
          const ext = child.name.includes(".") ? child.name.split(".").pop() : "";
          const extLower = String(ext || "").toLowerCase();
          const extLabel = ext ? ext.slice(0, 4).toUpperCase() : "FILE";
          const nameBtn = h("button", {
            class: "tree-filebtn",
            html: child.name,
            title: full,
            onclick: async (ev) => {
              ev.stopPropagation();
              await openFile(full);
            },
          });
          const badgeEls = [];
          if (full === app.current.mainFile) {
            badgeEls.push(h("span", { class: "tree-badge", html: t("主") }));
          }
          if (pinned) {
            badgeEls.push(h("span", { class: "tree-pin-ind", html: "PIN", title: t("置顶") }));
          }
          const nameRow = h("div", { class: "tree-name-row" }, [nameBtn, ...badgeEls]);
          const textChildren = [nameRow];
          const slashIdx = full.lastIndexOf("/");
          if (slashIdx > 0) {
            const sub = full.slice(0, slashIdx);
            if (sub) textChildren.push(h("div", { class: "tree-subpath", html: sub, title: sub }));
          }

          const menuId = `tree:${encodeURIComponent(full)}`;
          const menuBtn = h("button", {
            class: "tree-menu-btn",
            title: t("操作"),
            onclick: (ev) => toggleDropdown(menuId, ev),
          });
          menuBtn.appendChild(iconSvg("more", { size: 12 }));
          const fileMenu = dropdownMenu(
            menuId,
            h("div", { class: "dropdown-panel tree-action-panel" }, [
              btn(pinned ? t("取消置顶") : t("置顶"), {
                kind: "menu-item",
                onClick: async (ev) => {
                  ev.stopPropagation();
                  togglePinnedFile(full);
                  clearDropdowns();
                },
              }),
              btn(t("重命名"), {
                kind: "menu-item",
                onClick: async (ev) => {
                  ev.stopPropagation();
                  const np = prompt(t("重命名为"), full);
                  if (!np || np === full) return;
                  const wasOpen = app.current.openFile === full;
                  const nextPinned = remapPathList(app.ui.pinnedFiles, full, np);
                  await api(`/api/projects/${app.current.project.id}/rename`, {
                    method: "POST",
                    body: JSON.stringify({ oldPath: full, newPath: np }),
                  });
                  await loadProject(app.current.project.id);
                  if (wasOpen) app.current.openFile = np;
                  setOpenFiles(app.ui.openFiles.map((p) => (p === full ? np : p)));
                  setPinnedFiles(nextPinned);
                  clearDropdowns();
                  if (wasOpen) {
                    await openFile(np);
                    return;
                  }
                  cleanupEditor();
                  mount(render());
                },
              }),
              btn(t("删除"), {
                kind: "menu-item danger",
                onClick: async (ev) => {
                  ev.stopPropagation();
                  if (!confirm(t("确认删除 {name} ?", { name: full }))) return;
                  await api(`/api/projects/${app.current.project.id}/file`, {
                    method: "DELETE",
                    body: JSON.stringify({ path: full }),
                  });
                  if (app.current.openFile === full) {
                    app.current.openFile = null;
                    cleanupEditor();
                  }
                  setOpenFiles(app.ui.openFiles.filter((p) => p !== full));
                  setPinnedFiles(app.ui.pinnedFiles.filter((p) => p !== full));
                  await loadProject(app.current.project.id);
                  clearDropdowns();
                  cleanupEditor();
                  mount(render());
                },
              }),
            ])
          );
          const actionWrap = h(
            "div",
            { class: "dropdown dropdown-right tree-action-wrap", "data-dropdown-id": menuId },
            [menuBtn, fileMenu]
          );
          const row = h(
            "div",
            {
              class: `tree-row file ${active ? "active" : ""} ${multi ? "multi" : ""} ${selected ? "selected" : ""} ${
                pinned ? "pinned" : ""
              }`.trim(),
              style: rowStyle,
              onclick: async (ev) => {
                if (multi) {
                  if (
                    ev.target.closest(".tree-filebtn") ||
                  ev.target.closest(".tree-actions") ||
                  ev.target.closest(".tree-check")
                ) {
                  return;
                }
                toggleFileSelection(full);
                return;
              }
              await openFile(full);
            },
          },
          [
            ...(multi
              ? [
                  h("input", {
                    class: "tree-check",
                    type: "checkbox",
                    checked: selected,
                    onclick: (ev) => {
                      ev.stopPropagation();
                      toggleFileSelection(full);
                    },
                  }),
                ]
              : []),
            h("span", { class: "tree-icon", "data-ext": extLabel, "data-kind": extLower }),
            h("div", { class: "tree-text" }, textChildren),
            actionWrap,
          ]
        );
        frag.appendChild(row);
      }
    };

    renderNode(tree, "", 0);
    container.replaceChildren(frag);
    if (app.ui.fileView !== "all" && !app.ui.groupTreeInit) {
      app.ui.groupTreeInit = true;
    }
  };

  draw();
  app.ui.refreshFileTree = draw;
  return container;
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
  const container = h("div", { class: "file-tabs" });

  const draw = () => {
    container.innerHTML = "";
    const list = Array.isArray(app.ui.openFiles) ? app.ui.openFiles : [];
    if (list.length === 0) {
      container.appendChild(h("div", { class: "hint", html: t("打开文件开始编辑。") }));
      return;
    }
    for (const fp of list) {
      const active = fp === app.current.openFile;
      const name = fp.split("/").pop() || fp;
      const tab = h("div", { class: `file-tab ${active ? "active" : ""}`.trim() });
      const tabBtn = h("button", {
        class: "file-tab-btn",
        title: fp,
        onclick: () => {
          if (fp === app.current.openFile) return;
          openFile(fp).catch(console.error);
        },
      });
      tabBtn.textContent = name;
      const closeBtn = h("button", {
        class: "file-tab-close",
        title: t("关闭"),
        onclick: (ev) => {
          ev.stopPropagation();
          closeTab(fp);
        },
      });
      closeBtn.textContent = "x";
      tab.appendChild(tabBtn);
      tab.appendChild(closeBtn);
      container.appendChild(tab);
    }
  };

  draw();
  app.ui.refreshFileTabs = draw;
  return container;
}

function renderLogin() {
  const user = input({ placeholder: t("用户名 (admin / user01..user09)") });
  const pass = input({ placeholder: t("密码"), type: "password" });
  const err = h("div", { class: "hint error" });

  setTimeout(() => {
    applyLayoutClass();
    updateTopbarButtons();
    updateToolbarCollapsed();
    updateBottomConsoleVisibility();
    updateRightPaneFloat();
  }, 0);

  return h("div", { class: "page" }, [
    topbar(t("内网协作 LaTeX"), []),
    h("div", { class: "center" }, [
      h("div", { class: "card auth" }, [
        h("div", { class: "h1", html: t("登录") }),
        h("div", { class: "hint", html: t("不开放注册，账号由服务器本地创建。") }),
        h("div", { class: "form" }, [
          h("div", { class: "label", html: t("用户名") }),
          user,
          h("div", { class: "label", html: t("密码") }),
          pass,
          btn(t("登录"), {
            kind: "primary",
            onClick: async () => {
              err.textContent = "";
              try {
                const loginRes = await api("/api/login", {
                  method: "POST",
                  body: JSON.stringify({ username: user.value.trim(), password: pass.value }),
                });
                if (loginRes && loginRes.token) localStorage.setItem("ct_session_token", loginRes.token);
                localStorage.setItem("ct_last_user", user.value.trim() || "admin");
                await loadMe();
                await loadProjects();
                app.view = "projects";
                mount(render());
              } catch (e) {
                err.textContent = e && e.message ? e.message : String(e);
              }
            },
          }),
          err,
        ]),
      ]),
    ]),
  ]);
}

function renderProjects() {
  const importZip = input({ type: "file", id: "projectImportInput" });
  importZip.accept = ".zip";
  importZip.style.display = "none";
  importZip.onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (app.ui.guestMode) {
      app.ui.importError = t("请先切换用户");
      mount(render());
      ev.target.value = "";
      return;
    }
    const baseName = file.name.replace(/\.[^.]+$/, "").trim();
    const fd = new FormData();
    if (baseName) fd.append("name", baseName);
    fd.append("mainFile", "main.tex");
    fd.append("zip", file);
    app.ui.importError = "";
    try {
      const res = await api("/api/projects/import", { method: "POST", body: fd });
      await loadProjects();
      clearDropdowns();
      const created = res && res.project ? res.project : null;
      if (created && created.id) {
        await openProject(created);
      } else {
        mount(render());
      }
    } catch (e) {
      app.ui.importError = e && e.message ? e.message : String(e);
      mount(render());
    } finally {
      importZip.value = "";
    }
  };

  if (app.ui.projectCategory !== "all") {
    app.ui.projectCategory = "all";
    localStorage.setItem("ct_project_category", "all");
  }
  if (!["all", "mine", "shared"].includes(app.ui.projectScope)) {
    app.ui.projectScope = "mine";
    localStorage.setItem("ct_project_scope", "mine");
  }
  if (!["list", "grid"].includes(app.ui.projectView)) {
    app.ui.projectView = "list";
    localStorage.setItem("ct_project_view", "list");
  }

  const scopeLabel = (scope) => {
    if (scope === "all") return t("所有项目");
    if (scope === "shared") return t("与你共享");
    return t("你的项目");
  };

  const openProject = async (p) => {
    if (!p || !p.id) return;
    const hash = `#project/${p.id}`;
    if (location.hash !== hash) history.pushState({}, "", hash);
    await openProjectById(p.id, { pushHash: false, resetTab: true, seedProject: p });
  };

  const createProject = async () => {
    if (app.ui.guestMode) {
      app.ui.importError = t("请先切换用户");
      mount(render());
      return;
    }
    try {
      const res = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          mainFile: "main.tex",
          template: "blank",
        }),
      });
      await loadProjects();
      clearDropdowns();
      const created = res && res.project ? res.project : null;
      if (created && created.id) {
        await openProject(created);
      } else {
        mount(render());
      }
    } catch (e) {
      app.ui.importError = e && e.message ? e.message : String(e);
      mount(render());
    }
  };

  const list = h("div", { class: "project-rows", id: "projectList" });

  const drawList = () => {
    const frag = document.createDocumentFragment();
    list.classList.toggle("grid", app.ui.projectView === "grid");
    const filtered = app.projects.filter((p) =>
      projectMatchesScope(p, app.ui.projectScope, app.me) &&
      projectMatchesFilter(p, app.ui.projectFilter, app.ui.projectCategory)
    );
    if (!filtered.length) {
      const emptyLabel = app.ui.guestMode ? t("临时用户暂无项目") : t("(无匹配文件)");
      frag.appendChild(h("div", { class: "hint", html: emptyLabel }));
      list.replaceChildren(frag);
      return;
    }
    const sorted = filtered.slice().sort((a, b) => {
      const ta = Date.parse(a.updatedAt || a.createdAt || 0);
      const tb = Date.parse(b.updatedAt || b.createdAt || 0);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
    for (const p of sorted) {
      const menuId = `project:${p.id}`;
      const actionsMenu = dropdownMenu(menuId, buildProjectSettingsPanel(p));
      const actionsBtn = h("button", {
        class: "project-item-more",
        onclick: (ev) => toggleDropdown(menuId, ev),
      });
      actionsBtn.appendChild(iconSvg("more", { size: 14 }));
      const actionsWrap = h("div", {
        class: "dropdown dropdown-right",
        "data-dropdown-id": menuId,
        onclick: (ev) => ev.stopPropagation(),
      }, [
        actionsBtn,
        actionsMenu,
      ]);

      const row = h("div", {
        class: "project-item",
        role: "button",
        tabindex: "0",
        onclick: (ev) => {
          if (
            ev.target.closest(".project-item-actions") ||
            ev.target.closest(".project-item-more") ||
            ev.target.closest(".dropdown-menu")
          ) {
            return;
          }
          openProject(p);
        },
        onkeydown: (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            openProject(p);
          }
        },
        title: p.name || p.id,
      }, [
        h("div", { class: "project-item-icon" }, [
          h("img", { class: "project-item-thumb", src: PROJECT_THUMB_URL, alt: "PDF" }),
        ]),
        h("div", { class: "project-item-main" }, [
          h("div", { class: "project-item-name", html: p.name || p.id }),
        h("div", {
          class: "project-item-sub",
          html: app.me && p.owner === app.me.username ? "" : (p.owner || ""),
        }),
        ]),
        h("div", { class: "project-item-actions" }, [
          h("div", { class: "project-item-time", html: formatProjectAge(p) }),
          actionsWrap,
        ]),
      ]);
      frag.appendChild(row);
    }
    list.replaceChildren(frag);
  };
  drawList();
  app.ui.refreshProjectList = drawList;

  const scopeButtons = {};
  const setProjectScope = (scope) => {
    app.ui.projectScope = scope;
    localStorage.setItem("ct_project_scope", scope);
    for (const [k, b] of Object.entries(scopeButtons)) b.classList.toggle("active", k === scope);
    titleEl.textContent = scopeLabel(scope);
    drawList();
  };
  const setProjectView = (view) => {
    const next = view === "grid" ? "grid" : "list";
    app.ui.projectView = next;
    localStorage.setItem("ct_project_view", next);
    listBtn.classList.toggle("active", next === "list");
    gridBtn.classList.toggle("active", next === "grid");
    drawList();
  };

  const projectFilterInput = h("input", {
    class: "projects-search-input",
    placeholder: t("搜索项目..."),
    value: app.ui.projectFilter,
    oninput: (ev) => {
      app.ui.projectFilter = ev.target.value || "";
      localStorage.setItem("ct_project_filter", app.ui.projectFilter);
      drawList();
    },
  });

  const listBtn = h("button", {
    class: `view-toggle ${app.ui.projectView !== "grid" ? "active" : ""}`.trim(),
    title: t("列表视图"),
    onclick: () => setProjectView("list"),
  });
  listBtn.appendChild(iconSvg("list", { size: 14 }));
  const gridBtn = h("button", {
    class: `view-toggle ${app.ui.projectView === "grid" ? "active" : ""}`.trim(),
    title: t("网格视图"),
    onclick: () => setProjectView("grid"),
  });
  gridBtn.appendChild(iconSvg("grid", { size: 14 }));

  const titleEl = h("div", { class: "projects-title", html: scopeLabel(app.ui.projectScope) });

  const navItem = (scope, label) => {
    const b = h("button", {
      class: `projects-nav-item ${app.ui.projectScope === scope ? "active" : ""}`.trim(),
      onclick: () => setProjectScope(scope),
      html: label,
    });
    scopeButtons[scope] = b;
    return b;
  };

  const user = app.me || { username: "User", isAdmin: false };
  const color = pickColor(user.username || "U");
  const userCard = h("button", {
    class: "user-card dropdown-trigger",
    onclick: (ev) => toggleDropdown("user", ev),
  }, [
    h("div", { class: "user-avatar", html: (user.username || "U").charAt(0).toUpperCase() }),
    h("div", { class: "user-meta" }, [
      h("div", { class: "user-name", html: user.username || "User" }),
    ]),
    h("div", { class: "user-caret", html: "▾" }),
  ]);
  userCard.style.setProperty("--user-accent", color.color);

  const doLogout = async () => {
    try { await api("/api/logout", { method: "POST" }); } catch {}
    localStorage.removeItem("ct_session_token");
    cleanupEditor();
    app.current.openFile = null;
    app.ui.openFiles = [];
    app.ui.fileFilter = "";
    enterGuestMode();
    await loadProjects();
    mount(render());
  };

  const doSwitchUser = async (username, password) => {
    const clean = String(username || "").trim();
    const pass = String(password || "").trim();
    if (!clean || !pass) {
      app.ui.switchError = t("请输入用户名和密码");
      mount(render());
      return;
    }
    app.ui.switchError = "";
    try {
      const loginRes = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: clean, password: pass }),
      });
      if (loginRes && loginRes.token) localStorage.setItem("ct_session_token", loginRes.token);
      localStorage.setItem("ct_last_user", clean);
      await loadMe();
      await loadProjects();
      clearDropdowns();
      app.view = "projects";
      mount(render());
    } catch (e) {
      app.ui.switchError = e && e.message ? e.message : String(e);
      mount(render());
    }
  };

  const switchUserInput = input({ placeholder: t("用户名") });
  const switchPassInput = input({ placeholder: t("密码"), type: "password" });
  const userMenu = dropdownMenu("user", h("div", { class: "user-menu" }, [
    h("div", { class: "user-menu-title", html: t("切换用户") }),
    h("div", { class: "user-menu-row" }, [
      switchUserInput,
      switchPassInput,
      btn(t("切换"), {
        kind: "primary",
        onClick: (ev) => {
          ev.stopPropagation();
          doSwitchUser(switchUserInput.value, switchPassInput.value);
        },
      }),
    ]),
    app.ui.switchError ? h("div", { class: "hint error", html: app.ui.switchError }) : null,
  ]));
  const sidebar = h("aside", { class: "projects-sidebar" }, [
    h("div", { class: "dropdown dropdown-left", "data-dropdown-id": "user" }, [userCard, userMenu]),
    h("div", { class: "projects-nav" }, [
      navItem("all", t("所有项目")),
      navItem("mine", t("你的项目")),
      navItem("shared", t("与你共享")),
    ]),
    h("div", { class: "sidebar-spacer" }),
  ]);

  const canEditProjects = !app.ui.guestMode;
  const actions = h("div", { class: "projects-actions" }, [
    h("div", { class: "view-toggle-group" }, [listBtn, gridBtn]),
    importZip,
    btn(t("导入"), { kind: "pill", disabled: !canEditProjects, onClick: () => importZip.click() }),
    btn(`+ ${t("新建")}`, {
      kind: "pill primary",
      disabled: !canEditProjects,
      onClick: (ev) => { ev.stopPropagation(); createProject(); },
    }),
  ]);

  const importErrorEl = app.ui.importError
    ? h("div", { class: "hint error project-import-error", html: app.ui.importError })
    : null;

  const main = h("div", { class: "projects-main" }, [
    h("div", { class: "projects-topbar" }, [
      titleEl,
      h("div", { class: "projects-search" }, [projectFilterInput]),
      actions,
    ]),
    h("div", { class: "projects-content" }, [importErrorEl, list]),
  ]);

  return h("div", { class: "page projects-page" }, [
    h("div", { class: "projects-shell" }, [sidebar, main]),
  ]);
}

function renderProject() {
  const p = app.current.project;
  if (!p || !p.id) return renderLoading();
  const me = app.me || { username: "", isAdmin: false };
  applySplitVars();
  const isOwnerOrAdmin = me.isAdmin || p.owner === me.username;

  const goProjects = async () => {
    cleanupEditor();
    stopMonitorPolling();
    app.ui.selectRightTab = null;
    app.current.project = null;
    app.current.openFile = null;
    app.ui.openFiles = [];
    app.ui.fileFilter = "";
    app.view = "projects";
    app.ui.dropdownOpen = "";
    app.ui.projectRenameId = "";
    app.ui.projectDeleteArmed = "";
    if (location.hash !== "#projects") location.hash = "#projects";
    try {
      await loadProjects();
    } catch (e) {
      console.error(e);
    }
    mount(render());
  };

  const doLogout = async () => {
    try { await api("/api/logout", { method: "POST" }); } catch {}
    localStorage.removeItem("ct_session_token");
    cleanupEditor();
    stopMonitorPolling();
    app.ui.selectRightTab = null;
    app.ui.openFiles = [];
    app.ui.fileFilter = "";
    enterGuestMode();
    await loadProjects();
    mount(render());
  };

  const exportProjectZip = () => {
    if (!app.current.project) return;
    const token = localStorage.getItem("ct_session_token") || "";
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    const baseName = String(app.current.project.name || `project-${app.current.project.id.slice(0, 8)}`)
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_");
    const name = baseName || "collabtex-project";
    const url = `/api/projects/${app.current.project.id}/export.zip${qs}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };


  const uploadFile = async (file, targetPath) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("path", targetPath);
    fd.append("file", file);
    await api(`/api/projects/${p.id}/upload`, { method: "POST", body: fd });
  };

  const uploadInput = h("input", {
    id: "uploadInput",
    type: "file",
    style: "display:none",
    onchange: async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const target = prompt(t("上传到路径"), file.name);
      if (!target) return;
      await uploadFile(file, target);
      ev.target.value = "";
      await loadProject(p.id);
      cleanupEditor();
      mount(render());
    },
  });

  const openShareModal = () => {
    const userInput = input({ placeholder: t("分享给 (如 user01)") });
    const body = h("div", { class: "modal-form" }, [
      h("div", { class: "label", html: t("分享给 (如 user01)") }),
      userInput,
    ]);
    const shareBtn = btn(t("分享"), {
      kind: "primary",
      onClick: async () => {
        const username = userInput.value.trim();
        if (!username) return;
        await api(`/api/projects/${p.id}/share`, {
          method: "POST",
          body: JSON.stringify({ username }),
        });
        closeModal();
      },
    });
    showModal({ title: t("分享"), bodyEl: body, actions: [shareBtn] });
  };

  let filterTimer = null;
  const filterInput = h("input", {
    class: "left-search-input",
    placeholder: t("筛选文件..."),
    value: app.ui.fileFilter,
    oninput: (ev) => {
      app.ui.fileFilter = ev.target.value;
      if (filterTimer) clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        filterTimer = null;
        if (app.ui.refreshFileTree) app.ui.refreshFileTree();
      }, 120);
    },
  });
  const onDrop = async (ev) => {
    ev.preventDefault();
    ev.currentTarget.classList.remove("drop-ready");
    const files = Array.from(ev.dataTransfer && ev.dataTransfer.files ? ev.dataTransfer.files : []);
    if (files.length === 0) return;

    if (files.length === 1) {
      const target = prompt(t("上传到路径"), files[0].name);
      if (!target) return;
      await uploadFile(files[0], target);
    } else {
      const base = prompt(t("上传到文件夹 (可选)"), "");
      if (base === null) return;
      const prefix = base.trim().replace(/\/+$/, "");
      for (const file of files) {
        const target = prefix ? `${prefix}/${file.name}` : file.name;
        await uploadFile(file, target);
      }
    }

    await loadProject(p.id);
    cleanupEditor();
    mount(render());
  };

  if (app.ui.leftRailMode !== "files") app.ui.leftRailMode = "files";
  if (app.ui.leftPaneTab !== "files" && app.ui.leftPaneTab !== "chats") app.ui.leftPaneTab = "files";
  if (!app.ui.assistantEnabled && app.ui.leftPaneTab === "chats") app.ui.leftPaneTab = "files";

  const setLeftRailMode = (mode) => {
    const next = "files";
    app.ui.leftRailMode = next;
    localStorage.setItem("ct_left_rail_mode", next);
    if (app.ui.leftPaneTab !== "files") {
      app.ui.leftPaneTab = "files";
      localStorage.setItem("ct_left_pane_tab", "files");
    }
    if (app.ui.leftCollapsed) setLeftCollapsed(false);
    mount(render());
  };
  const setLeftPaneTab = (tab) => {
    const next = tab === "chats" ? "chats" : "files";
    app.ui.leftPaneTab = next;
    localStorage.setItem("ct_left_pane_tab", next);
    mount(render());
  };
  const setAssistantEnabled = (next) => {
    app.ui.assistantEnabled = !!next;
    localStorage.setItem("ct_assistant_enabled", app.ui.assistantEnabled ? "1" : "0");
    if (!app.ui.assistantEnabled && app.ui.leftPaneTab === "chats") {
      app.ui.leftPaneTab = "files";
      localStorage.setItem("ct_left_pane_tab", "files");
    }
    if (!app.ui.assistantEnabled && app.ui.rightTab === "ai") {
      app.ui.rightTab = "pdf";
      localStorage.setItem("ct_rightTab", "pdf");
    }
    if (!app.ui.assistantEnabled && app.ui.aiFloatOpen) {
      app.ui.aiFloatOpen = false;
      localStorage.setItem("ct_ai_float", "0");
    }
    mount(render());
  };

  const openChatPane = () => {
    if (!app.ui.assistantEnabled) return;
    toggleAiFloat();
  };

  const texFiles = Array.isArray(app.current.tree) ? app.current.tree.filter((f) => f.endsWith(".tex")) : [];
  const mainSelect = h("select", { class: "input", id: "mainSelect" }, []);
  for (const f of texFiles) {
    const opt = h("option", { value: f, selected: f === app.current.mainFile ? "" : null, html: f });
    mainSelect.appendChild(opt);
  }
  mainSelect.disabled = !isOwnerOrAdmin;

  const compilerSelect = h("select", { class: "input", id: "compilerSelect" }, [
    h("option", { value: "pdflatex", selected: app.current.compiler === "pdflatex" ? "" : null, html: "pdfLaTeX" }),
    h("option", { value: "xelatex", selected: app.current.compiler === "xelatex" ? "" : null, html: "XeLaTeX" }),
    h("option", { value: "lualatex", selected: app.current.compiler === "lualatex" ? "" : null, html: "LuaLaTeX" }),
  ]);
  compilerSelect.disabled = !isOwnerOrAdmin;

  const targetFiles = texFiles.slice();
  if (app.ui.pdfTargetFile && !targetFiles.includes(app.ui.pdfTargetFile)) targetFiles.unshift(app.ui.pdfTargetFile);
  if (!targetFiles.length && app.current.mainFile) targetFiles.push(app.current.mainFile);
  const pdfTargetSelect = h("select", {
    class: "input pdf-target",
    id: "pdfTargetSelect",
    onchange: (ev) => setPdfTargetFile(ev.target.value),
  });
  for (const f of targetFiles) {
    const opt = h("option", { value: f, selected: f === getPdfTargetFile(p.id) ? "" : null, html: f });
    pdfTargetSelect.appendChild(opt);
  }

  const pdfZoomSelect = h(
    "select",
    {
      class: "input pdf-zoom",
      id: "pdfZoomSelect",
      onchange: (ev) => setPdfView({ projectId: p.id, zoom: ev.target.value }),
    },
    [
      h("option", { value: "page-width", html: t("适合宽度"), selected: app.ui.pdfZoom === "page-width" ? "" : null }),
      h("option", { value: "page-fit", html: t("适合页面"), selected: app.ui.pdfZoom === "page-fit" ? "" : null }),
      h("option", { value: "100", html: "100%", selected: app.ui.pdfZoom === "100" ? "" : null }),
      h("option", { value: "125", html: "125%", selected: app.ui.pdfZoom === "125" ? "" : null }),
      h("option", { value: "150", html: "150%", selected: app.ui.pdfZoom === "150" ? "" : null }),
      h("option", { value: "200", html: "200%", selected: app.ui.pdfZoom === "200" ? "" : null }),
    ]
  );

  const hasPdf = !!(app.current.artifacts && app.current.artifacts.pdf && app.current.artifacts.pdf.exists);
  const openPdfMenuBtn = btn(t("打开 PDF"), {
    kind: "menu-item",
    disabled: !hasPdf,
    onClick: (ev) => {
      ev.stopPropagation();
      window.open(pdfUrl(p.id, Date.now(), app.ui.pdfPage, app.ui.pdfZoom, getPdfTargetFile(p.id)), "_blank");
      clearDropdowns();
    },
  });
  openPdfMenuBtn.id = "openPdfBtn";

  const refreshPdfMenuBtn = btn(t("刷新预览"), {
    kind: "menu-item",
    onClick: (ev) => {
      ev.stopPropagation();
      setPdfView({ projectId: p.id, refresh: true });
      clearDropdowns();
    },
  });

  const applyMainBtn = btn(t("设置"), {
    kind: "tiny",
    disabled: !isOwnerOrAdmin,
    onClick: async (ev) => {
      ev.stopPropagation();
      if (!mainSelect.value) return;
      await api(`/api/projects/${p.id}/main`, {
        method: "POST",
        body: JSON.stringify({ mainFile: mainSelect.value }),
      });
      await loadProject(p.id);
      cleanupEditor();
      mount(render());
    },
  });

  const applyCompilerBtn = btn(t("设置"), {
    kind: "tiny",
    disabled: !isOwnerOrAdmin,
    onClick: async (ev) => {
      ev.stopPropagation();
      await api(`/api/projects/${p.id}/compiler`, {
        method: "POST",
        body: JSON.stringify({ compiler: compilerSelect.value }),
      });
      await loadProject(p.id);
      cleanupEditor();
      mount(render());
    },
  });

  const autoCompileToggle = h("label", { class: "toggle" }, [
    h("input", {
      type: "checkbox",
      checked: app.ui.autoCompile,
      onchange: (ev) => {
        app.ui.autoCompile = ev.target.checked;
        localStorage.setItem("ct_autoCompile", app.ui.autoCompile ? "1" : "0");
      },
    }),
    h("span", { html: t("自动编译") }),
  ]);

  const autoSyncToggle = h("label", { class: "toggle" }, [
    h("input", {
      type: "checkbox",
      checked: app.ui.autoSyncPdf,
      onchange: (ev) => {
        app.ui.autoSyncPdf = ev.target.checked;
        localStorage.setItem("ct_autoSyncPdf", app.ui.autoSyncPdf ? "1" : "0");
        if (app.ui.autoSyncPdf) schedulePdfSync();
      },
    }),
    h("span", { html: t("自动同步 PDF") }),
  ]);

  const deleteProjectBtn = btn(t("删除项目"), {
    kind: "menu-item danger",
    disabled: !isOwnerOrAdmin,
    onClick: async (ev) => {
      ev.stopPropagation();
      if (!confirm(t("确认删除 {name} ?", { name: p.name || p.id }))) return;
      await api(`/api/projects/${p.id}`, { method: "DELETE" });
      clearDropdowns();
      await goProjects();
    },
  });

  const settingsMenu = dropdownMenu("panel-settings", h("div", { class: "dropdown-panel settings-panel" }, [
    h("div", { class: "label", html: t("预览文件") }),
    pdfTargetSelect,
    h("div", { class: "label", html: t("缩放") }),
    pdfZoomSelect,
    h("div", { class: "menu-sep" }),
    h("div", { class: "label", html: t("主文件") }),
    h("div", { class: "row" }, [mainSelect, applyMainBtn]),
    h("div", { class: "label", html: t("编译器") }),
    h("div", { class: "row" }, [compilerSelect, applyCompilerBtn]),
    h("div", { class: "settings-toggles" }, [autoCompileToggle, autoSyncToggle]),
    h("div", { class: "menu-sep" }),
    openPdfMenuBtn,
    refreshPdfMenuBtn,
    h("div", { class: "menu-sep" }),
    deleteProjectBtn,
  ]));

  const settingsBtn = btn(t("设置"), { kind: "tiny", onClick: (ev) => toggleDropdown("panel-settings", ev) });
  const settingsWrap = h(
    "div",
    { class: "dropdown dropdown-left", "data-dropdown-id": "panel-settings" },
    [settingsBtn, settingsMenu]
  );

  const recentFilesEl = null;
  const pinnedFilesEl = renderPinnedFiles();

  const projectSettingsMenu = dropdownMenu("project-settings", buildProjectSettingsPanel(p, { onDelete: goProjects }));
  const projectBtn = h("button", {
    class: "project-title-btn dropdown-trigger",
    title: p.name || p.id,
    onclick: (ev) => toggleDropdown("project-settings", ev),
    html: `${p.name || p.id} ▾`,
  });
  const projectBtnWrap = h("div", {
    class: "dropdown dropdown-left",
    "data-dropdown-id": "project-settings",
    onclick: (ev) => toggleDropdown("project-settings", ev),
  }, [projectBtn, projectSettingsMenu]);
  const shareInput = input({ placeholder: t("分享给 (如 user01)") });
  const shareMenu = dropdownMenu("share", h("div", { class: "dropdown-panel share-panel" }, [
    h("div", { class: "label", html: t("分享给") }),
    shareInput,
    btn(t("分享"), {
      kind: "primary",
      onClick: async (ev) => {
        ev.stopPropagation();
        const username = shareInput.value.trim();
        if (!username) return;
        await api(`/api/projects/${p.id}/share`, {
          method: "POST",
          body: JSON.stringify({ username }),
        });
        shareInput.value = "";
        clearDropdowns();
      },
    }),
  ]));
  const shareBtn = h("button", { class: "share-btn dropdown-trigger", onclick: (ev) => toggleDropdown("share", ev), html: t("分享") });
  const shareWrap = h("div", { class: "dropdown dropdown-right", "data-dropdown-id": "share" }, [shareBtn, shareMenu]);

  const newFileBtn = h("button", {
    class: "left-icon-btn",
    title: t("+ 新文件"),
    onclick: async () => {
      const rel = prompt(t("新文件路径"), "main.tex");
      if (!rel) return;
      await api(`/api/projects/${p.id}/file`, {
        method: "POST",
        body: JSON.stringify({ path: rel, content: "" }),
      });
      await loadProject(p.id);
      cleanupEditor();
      mount(render());
    },
  });
  newFileBtn.appendChild(iconSvg("plus"));
  const uploadBtn = h("button", {
    class: "left-icon-btn",
    title: t("上传"),
    onclick: () => uploadInput.click(),
  });
  uploadBtn.appendChild(iconSvg("upload"));
  const exportBtn = h("button", {
    class: "left-icon-btn",
    title: t("导出 Zip"),
    onclick: () => exportProjectZip(),
  });
  exportBtn.appendChild(iconSvg("download"));

  const toolsRow = h("div", { class: "left-tools" }, [
    filterInput,
    newFileBtn,
    uploadBtn,
    exportBtn,
  ]);
  const headerActions = h("div", { class: "left-header-actions" }, [shareWrap, settingsWrap]);
  const headerChildren = [
    h("div", { class: "left-header-top" }, [projectBtnWrap, headerActions]),
  ];
  if (app.ui.leftRailMode === "files") {
    if (app.ui.leftPaneTab === "files") headerChildren.push(toolsRow);
    else headerChildren.push(h("div", { class: "left-header-sub", html: t("聊天") }));
  }

  const leftHeader = h("div", { class: "left-pane-header" }, headerChildren);

  const leftBody = h("div", { class: "left-pane-body" }, []);
  if (app.ui.leftPaneTab === "chats" && app.ui.assistantEnabled) {
    leftBody.appendChild(renderChatPanel());
  } else {
    leftBody.appendChild(renderFileTree());
  }

  const left = h(
    "div",
    {
      class: "pane left",
      ondragover: (ev) => {
        ev.preventDefault();
        ev.currentTarget.classList.add("drop-ready");
      },
      ondragleave: (ev) => {
        ev.currentTarget.classList.remove("drop-ready");
      },
      ondrop: onDrop,
    },
    [leftHeader, uploadInput, leftBody]
  );

  const editorToolbar = h("div", { class: "editor-toolbar minimal", id: "editorToolbar" }, []);

  const bottomLog = h("pre", { class: "bottom-log", id: "bottomLog" });
  bottomLog.textContent = app.ui.bottomMode === "log" ? app.current.lastLog || "" : app.ui.bottomTerminalLog || "";
  const termBtn = btn(t("终端"), { kind: "tiny", onClick: () => setBottomMode("terminal"), id: "bottomModeTerm" });
  const logBtn = btn(t("日志"), { kind: "tiny", onClick: () => setBottomMode("log"), id: "bottomModeLog" });
  if (app.ui.bottomMode === "terminal") termBtn.classList.add("active");
  if (app.ui.bottomMode === "log") logBtn.classList.add("active");
  const clearBtn = btn(t("清空"), {
    kind: "tiny",
    onClick: () => {
      if (app.ui.bottomMode === "terminal") clearBottomTerminal();
      else {
        app.current.lastLog = "";
        const logEl = document.getElementById("compileLog");
        if (logEl) logEl.textContent = "";
        updateBottomConsoleMode();
      }
    },
  });
  const bottomHeader = h("div", { class: "bottom-header" }, [
    h("div", { class: "bottom-title", html: t("控制台") }),
    h("div", { class: "bottom-actions" }, [termBtn, logBtn, clearBtn, btn(t("关闭"), { kind: "tiny", onClick: () => setBottomConsole(false) })]),
  ]);
  const bottomInput = h("input", {
    class: "input bottom-input",
    placeholder: t("输入命令，回车执行"),
  });
  bottomInput.autocomplete = "off";
  const runBottomCommand = async (raw) => {
    const cmd = String(raw || "").trim();
    if (!cmd) return;
    appendBottomTerminal(`> ${cmd}`);
    app.ui.bottomHistory = app.ui.bottomHistory || [];
    app.ui.bottomHistory.push(cmd);
    if (app.ui.bottomHistory.length > 50) app.ui.bottomHistory = app.ui.bottomHistory.slice(-50);
    app.ui.bottomHistoryIndex = app.ui.bottomHistory.length;
    const parts = cmd.split(/\s+/);
    const head = parts.shift().toLowerCase();
    const rest = parts.join(" ");
    if (head === "help") {
      appendBottomTerminal(
        "commands: help, compile, quick, clean, open <file>, reveal, ai-fix, ai-patch, mode <terminal|log>, clear, ls"
      );
      return;
    }
    if (head === "mode") {
      if (parts[0] === "log") setBottomMode("log");
      else setBottomMode("terminal");
      return;
    }
    if (head === "clear") {
      clearBottomTerminal();
      return;
    }
    if (head === "ls") {
      const files = (app.current.tree || []).filter((p) => !isFolderPlaceholder(p));
      const slice = files.slice(0, 40);
      appendBottomTerminal(slice.join("\n"));
      if (files.length > slice.length) appendBottomTerminal(`... +${files.length - slice.length}`);
      return;
    }
    if (head === "open") {
      if (!rest) {
        appendBottomTerminal("usage: open <file>");
        return;
      }
      openFile(rest).catch((e) => appendBottomTerminal(e && e.message ? e.message : String(e)));
      return;
    }
    if (head === "reveal") {
      revealActiveFile();
      return;
    }
    if (head === "compile" || head === "build") {
      compileProject({ mode: "full", origin: "manual" }).catch((e) =>
        appendBottomTerminal(e && e.message ? e.message : String(e))
      );
      return;
    }
    if (head === "quick") {
      compileProject({ mode: "quick", origin: "manual" }).catch((e) =>
        appendBottomTerminal(e && e.message ? e.message : String(e))
      );
      return;
    }
    if (head === "clean") {
      compileProject({ mode: "full", clean: true, origin: "manual" }).catch((e) =>
        appendBottomTerminal(e && e.message ? e.message : String(e))
      );
      return;
    }
    if (head === "ai-fix") {
      oneClickAiCompileFix().catch((e) => appendBottomTerminal(e && e.message ? e.message : String(e)));
      return;
    }
    if (head === "ai-patch") {
      showAiCompilePatchModal();
      return;
    }
    appendBottomTerminal(`unknown command: ${head}`);
  };
  bottomInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      const v = bottomInput.value;
      bottomInput.value = "";
      runBottomCommand(v);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      const idx = app.ui.bottomHistoryIndex ?? app.ui.bottomHistory.length;
      const next = Math.max(0, idx - 1);
      app.ui.bottomHistoryIndex = next;
      bottomInput.value = app.ui.bottomHistory[next] || "";
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      const idx = app.ui.bottomHistoryIndex ?? app.ui.bottomHistory.length;
      const next = Math.min(app.ui.bottomHistory.length, idx + 1);
      app.ui.bottomHistoryIndex = next;
      bottomInput.value = app.ui.bottomHistory[next] || "";
    }
  });
  const runBtn = btn(t("执行"), {
    kind: "tiny",
    onClick: () => {
      const v = bottomInput.value;
      bottomInput.value = "";
      runBottomCommand(v);
    },
  });
  const bottomInputRow = h("div", { class: "bottom-input-row" }, [
    h("span", { class: "bottom-prompt", html: "&gt;" }),
    bottomInput,
    runBtn,
  ]);
  const bottomConsole = h(
    "div",
    { class: "bottom-console", id: "bottomConsole", style: app.ui.bottomConsole ? "" : "display:none" },
    [bottomHeader, bottomInputRow, bottomLog]
  );
  const bottomGutter = h("div", {
    class: "bottom-gutter",
    id: "bottomGutter",
    style: app.ui.bottomConsole ? "" : "display:none",
    onmousedown: (ev) => startBottomDrag(ev),
  });
  const bottomCollapsed = h(
    "div",
    {
      class: "bottom-collapsed",
      id: "bottomCollapsed",
      style: app.ui.bottomConsole ? "display:none" : "",
      onclick: () => setBottomConsole(true),
    },
    [
      h("div", { class: "bottom-collapsed-title", html: t("控制台") }),
      h("div", { class: "bottom-collapsed-hint", html: t("点击展开控制台") }),
    ]
  );

  const editor = h("div", { class: "pane editor-pane" }, [
    h("div", { class: "pane-header" }, [
      h("div", {
        class: "pane-title",
        id: "editorTitle",
        title: app.current.openFile || "",
        html: app.current.openFile ? fileBaseName(app.current.openFile) : t("编辑器"),
      }),
    ]),
    editorToolbar,
    h("div", { class: "editor", id: "editorHost" }),
    h("div", { class: "editor-status", id: "editorStatus" }, [
      h("span", { class: "hint", html: t("打开文件开始编辑。") }),
    ]),
  ]);

  const themeSelect = h(
    "select",
    {
      class: "input",
      onchange: (ev) => {
        setTheme(ev.target.value);
      },
    },
    [
      h("option", { value: "default", html: t("默认"), selected: app.ui.theme === "default" ? "" : null }),
      h("option", { value: "vscode-dark", html: t("VSCode 深色"), selected: app.ui.theme === "vscode-dark" ? "" : null }),
      h("option", { value: "vscode-light", html: t("VSCode 浅色"), selected: app.ui.theme === "vscode-light" ? "" : null }),
    ]
  );

  const fontSizeInput = input({ type: "number", value: String(app.ui.editorFontSize) });
  fontSizeInput.classList.add("compact");
  fontSizeInput.setAttribute("min", "11");
  fontSizeInput.setAttribute("max", "22");
  fontSizeInput.setAttribute("step", "0.5");
  fontSizeInput.onchange = (ev) => setEditorFontSize(ev.target.value);

  const lineHeightInput = input({ type: "number", value: String(app.ui.editorLineHeight) });
  lineHeightInput.classList.add("compact");
  lineHeightInput.setAttribute("min", "1.2");
  lineHeightInput.setAttribute("max", "2.4");
  lineHeightInput.setAttribute("step", "0.05");
  lineHeightInput.onchange = (ev) => setEditorLineHeight(ev.target.value);

  const padYInput = input({ type: "number", value: String(app.ui.editorPadY) });
  padYInput.classList.add("compact");
  padYInput.setAttribute("min", "8");
  padYInput.setAttribute("max", "32");
  padYInput.setAttribute("step", "1");
  padYInput.onchange = (ev) => setEditorPaddingY(ev.target.value);

  const padXInput = input({ type: "number", value: String(app.ui.editorPadX) });
  padXInput.classList.add("compact");
  padXInput.setAttribute("min", "8");
  padXInput.setAttribute("max", "32");
  padXInput.setAttribute("step", "1");
  padXInput.onchange = (ev) => setEditorPaddingX(ev.target.value);

  const treeDensitySelect = h(
    "select",
    {
      class: "input",
      onchange: (ev) => setTreeDensity(ev.target.value),
    },
    [
      h("option", { value: "comfortable", html: t("舒适"), selected: app.ui.treeDensity !== "compact" ? "" : null }),
      h("option", { value: "compact", html: t("紧凑"), selected: app.ui.treeDensity === "compact" ? "" : null }),
    ]
  );
  treeDensitySelect.classList.add("compact");

  const compileBtn = btn("", { kind: "", onClick: () => compileProject({ mode: "full" }), id: "compileBtn" });
  compileBtn.title = t("编译 (Ctrl/Cmd+S)");
  compileBtn.classList.add("compile-btn");
  const compileIcon = iconSvg("compile", { size: 14, className: "compile-icon" });
  const compileLabel = h("span", { class: "compile-label", html: t("编译") });
  compileBtn.appendChild(compileIcon);
  compileBtn.appendChild(compileLabel);

  const aiProfiles = app.ui.aiProfiles || [];

  const activeProfileSelect = h("select", {
    class: "input",
    onchange: (ev) => {
      setActiveAiProfile(ev.target.value);
      saveAiProfiles();
    },
  });
  if (app.ui.aiUseServer) activeProfileSelect.disabled = true;
  if (!aiProfiles.length) addAiProfile();
  for (const p of app.ui.aiProfiles) {
    activeProfileSelect.appendChild(
      h("option", { value: p.id, html: p.name || p.model || "Model", selected: p.id === app.ui.aiActiveProfileId ? "" : null })
    );
  }

  const addProfileBtn = btn(t("新增模型"), {
    kind: "tiny",
    disabled: app.ui.aiUseServer,
    onClick: () => {
      const seed = getAiProfileById(app.ui.aiActiveProfileId) || {};
      addAiProfile(seed);
      mount(render());
    },
  });

  const modeSelect = (mode, label) => {
    const sel = h("select", {
      class: "input ai-mode-select",
      disabled: app.ui.aiUseServer,
      onchange: (ev) => setAiProfileForMode(mode, ev.target.value),
    });
    sel.appendChild(h("option", { value: "", html: t("跟随当前模型"), selected: !getAiProfileForMode(mode) ? "" : null }));
    for (const p of app.ui.aiProfiles) {
      sel.appendChild(h("option", { value: p.id, html: p.name || p.model || "Model", selected: p.id === getAiProfileForMode(mode) ? "" : null }));
    }
    return h("div", { class: "ai-mode-row" }, [
      h("div", { class: "label", html: label }),
      sel,
    ]);
  };

  const profileCards = h("div", { class: "ai-profiles", style: app.ui.aiUseServer ? "display:none" : "" });
  const renderProfileCard = (p) => {
    const nameInput = h("input", {
      class: "input",
      placeholder: t("模型名称"),
      value: p.name,
      onchange: (ev) => {
        p.name = ev.target.value.trim() || p.name;
        saveAiProfiles();
        mount(render());
      },
    });

    const keyInput = h("input", {
      class: "input",
      type: "password",
      placeholder: t("Qwen3-VL API 密钥"),
      value: p.apiKey || "",
      oninput: (ev) => {
        p.apiKey = ev.target.value;
        saveAiProfiles();
      },
    });
    keyInput.autocomplete = "off";
    let keyToggle;
    keyToggle = btn(t("显示"), {
      kind: "tiny",
      onClick: () => {
        const reveal = keyInput.type === "password";
        keyInput.type = reveal ? "text" : "password";
        keyToggle.textContent = reveal ? t("隐藏") : t("显示");
      },
    });

    const baseInput = h("input", {
      class: "input",
      placeholder: t("Base URL (OpenAI 兼容)"),
      value: p.baseUrl || "",
      oninput: (ev) => {
        p.baseUrl = ev.target.value.trim();
        saveAiProfiles();
      },
    });

    const modelInput = h("input", {
      class: "input",
      placeholder: t("模型 (例如 qwen3-vl)"),
      value: p.model || "",
      oninput: (ev) => {
        p.model = ev.target.value.trim();
        saveAiProfiles();
      },
    });

    const styleSelect = h(
      "select",
      {
        class: "input",
        onchange: (ev) => {
          p.apiStyle = ev.target.value;
          saveAiProfiles();
        },
      },
      [
        h("option", { value: "", html: t("API 类型"), selected: !p.apiStyle ? "" : null }),
        h("option", { value: "responses", html: t("responses (兼容)"), selected: p.apiStyle === "responses" ? "" : null }),
        h("option", { value: "chat", html: t("chat (兼容)"), selected: p.apiStyle === "chat" ? "" : null }),
      ]
    );

    const deleteBtn = btn(t("删除模型"), {
      kind: "tiny danger",
      onClick: () => {
        if (app.ui.aiProfiles.length <= 1) return;
        removeAiProfile(p.id);
        mount(render());
      },
    });

    return h("div", { class: "ai-profile-card" }, [
      h("div", { class: "ai-profile-header" }, [nameInput, deleteBtn]),
      h("div", { class: "row" }, [keyInput, keyToggle]),
      h("div", { class: "row" }, [baseInput, modelInput]),
      h("div", { class: "row" }, [styleSelect]),
    ]);
  };

  for (const p of app.ui.aiProfiles) profileCards.appendChild(renderProfileCard(p));

  const wsInput = h("input", {
    class: "input",
    placeholder: t("WebSocket 地址 (可选)"),
    value: app.ui.wsUrlOverride || "",
    oninput: (ev) => setWsUrlOverride(ev.target.value),
  });
  const wsClearBtn = btn(t("清除"), {
    kind: "tiny",
    onClick: () => {
      wsInput.value = "";
      setWsUrlOverride("");
    },
  });
  const wsPortGuess = (() => {
    const u = new URL(location.href);
    const param = u.searchParams.get("wsPort");
    if (param) return param;
    if (app.ui.wsUrlOverride) {
      try {
        const parsed = new URL(app.ui.wsUrlOverride);
        if (parsed.port) return parsed.port;
      } catch {
        // ignore parse errors
      }
    }
    const basePort = Number(location.port);
    if (Number.isFinite(basePort) && basePort > 0) return String(basePort + 1);
    return "";
  })();
  const wsPortInput = h("input", {
    class: "input",
    placeholder: t("WS 端口"),
    value: wsPortGuess,
    oninput: (ev) => {
      const v = ev.target.value.replace(/[^\d]/g, "");
      if (v !== ev.target.value) ev.target.value = v;
    },
  });
  const wsPortApplyBtn = btn(t("应用"), {
    kind: "tiny",
    onClick: () => {
      const port = wsPortInput.value.trim();
      if (!port) return;
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const url = `${scheme}://${location.hostname}:${port}`;
      setWsUrlOverride(url);
      wsInput.value = url;
    },
  });

  const pdfHint = h("div", {
    class: "hint",
    id: "pdfHint",
    html: hasPdf ? "" : t("暂无 PDF，请点击编译生成。"),
    style: hasPdf ? "display:none" : null,
  });

  const pdfPages = h("div", { class: "pdf-pages", id: "pdfPages" });
  const pdfMarker = h("div", { class: "pdf-marker", id: "pdfMarker" });
  const pdfViewer = h("div", { class: "pdf-viewer", id: "pdfViewer" }, [pdfPages, pdfMarker, pdfHint]);
  let lastPdfClickAt = 0;
  pdfViewer.onclick = async (ev) => {
    if (!app.current.project) return;
    const now = Date.now();
    if (now - lastPdfClickAt < 250) return;
    lastPdfClickAt = now;
    const target = ev.target;
    const canvas = target && target.closest ? target.closest("canvas.pdf-canvas") : null;
    if (!canvas) return;
    const page = Number(canvas.getAttribute("data-page") || canvas.dataset.page || app.ui.pdfPage || 1);
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xCss = ev.clientX - rect.left;
    const yCss = ev.clientY - rect.top;
    if (xCss < 0 || yCss < 0 || xCss > rect.width || yCss > rect.height) return;
    const scale = app.ui.pdfScale || 1;
    const x = xCss / scale;
    const y = yCss / scale;
    const pageHeight = app.ui.pdfPageHeights ? app.ui.pdfPageHeights[page] : null;
    app.ui.pdfPage = page;
    const pageInput = document.getElementById("pdfPageInput");
    if (pageInput) pageInput.value = String(page);
    app.ui.pdfMarker = { page, x, y };
    app.ui.pdfMarkerFocus = false;
    app.ui.pdfMarkerPulse = true;
    placePdfMarker();
    pulsePdfMarker();
    try {
      const res = await api(`/api/projects/${p.id}/synctex/edit`, {
        method: "POST",
        body: JSON.stringify({
          page,
          x,
          y,
          pageHeight,
          target: getPdfTargetFile(p.id),
        }),
      });
      if (res && res.file && res.line) {
        await openFileAt(res.file, res.line, { skipPdfSync: true });
      }
    } catch {
      // ignore failed click mapping
    }
  };
  pdfViewer.addEventListener(
    "wheel",
    (ev) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      if (ev.deltaY < 0) zoomStep(1);
      else zoomStep(-1);
    },
    { passive: false }
  );
  pdfViewer.addEventListener("scroll", () => {
    if (pdfScrollRaf) cancelAnimationFrame(pdfScrollRaf);
    pdfScrollRaf = requestAnimationFrame(() => {
      pdfScrollRaf = null;
      handlePdfScroll();
    });
  });
  if (hasPdf) {
    const ts = Date.now();
    app.ui.pdfTs = ts;
    setTimeout(() => {
      renderPdfPages({ projectId: p.id, refresh: true }).catch(() => {});
    }, 0);
  }
  compileBtn.classList.add("pdf-action");
  const pageInfo = h("div", {
    class: "pdf-page-badge",
    id: "pdfPageInfo",
    html: formatPdfPageInfo(app.ui.pdfPage || 1, app.ui.pdfPageCount || 1),
  });
  const pdfActions = h("div", { class: "pdf-action-bar" }, [
    h("div", { class: "pdf-action-left" }, [compileBtn]),
    h("div", { class: "pdf-action-right" }, [pageInfo]),
  ]);

  const logDiv = h("div", { class: "log", id: "compileLog" });
  logDiv.textContent = app.current.lastLog || "";

  const logHeader = h("div", { class: "log-header" }, [
    h("div", { class: "log-group" }, [
      h("div", { class: "log-title", html: t("编译") }),
      btn(t("一键修复"), { kind: "tiny primary", onClick: () => oneClickAiCompileFix(), id: "aiOneClickFixBtn" }),
      h("span", {
        class: "ai-progress",
        id: "aiOneClickProgress",
        "data-state": app.compile.aiOneClickStatus || "",
        style: app.compile.aiOneClickStep ? "" : "display:none",
        html: app.compile.aiOneClickStep || "",
      }),
    ]),
  ]);

  const summaryText = buildDiagnosticSummary();
  const summaryTextEl = h("pre", { class: "summary-text", id: "compileSummaryText" });
  summaryTextEl.textContent = summaryText || "";
  const summaryBox = h(
    "div",
    { class: "log-summary", id: "compileSummaryBox", style: summaryText ? "" : "display:none" },
    [h("div", { class: "summary-title", html: t("诊断摘要") }), summaryTextEl]
  );

  const aiFixTextEl = h("pre", { class: "summary-text", id: "compileAiFixText" });
  const aiFixInitial =
    app.compile.aiFixStatus === "running"
      ? t("诊断中...")
      : app.compile.aiFixStatus === "error"
        ? t("诊断失败")
        : app.compile.aiFix || "";
  aiFixTextEl.textContent = aiFixInitial;
  const aiFixBox = h(
    "div",
    {
      class: "log-summary ai-fix",
      id: "compileAiFixBox",
      style: aiFixInitial ? "" : "display:none",
    },
    [h("div", { class: "summary-title", html: t("AI 修复建议") }), aiFixTextEl]
  );

  const pdfPane = h("div", { class: "pdf-pane" }, [pdfViewer, pdfActions]);
  const tabPages = {
    pdf: h("div", { class: "tab-page pdf-page", id: "tab_pdf" }, [pdfPane]),
    logs: h("div", { class: "tab-page log-page", id: "tab_logs" }, [logHeader, summaryBox, aiFixBox, logDiv]),
  };

  const selectTab = () => {
    const key = "pdf";
    app.ui.rightTab = key;
    localStorage.setItem("ct_rightTab", key);
    for (const [k, el] of Object.entries(tabPages)) el.style.display = k === key ? "" : "none";
    stopMonitorPolling();
  };
  app.ui.selectRightTab = selectTab;
  selectTab();

  const right = h("div", { class: "pane right-pane", id: "rightPane" }, [
    h("div", { class: "tab-body" }, Object.values(tabPages)),
  ]);

  if (app.ui.pendingOpenFile && app.ui.pendingOpenFile !== app.current.openFile) {
    const target = app.ui.pendingOpenFile;
    app.ui.pendingOpenFile = null;
    setTimeout(() => {
      openFile(target).catch(console.error);
    }, 0);
  }
  if (!app.current.openFile && !app.ui.pendingOpenFile) {
    const fallback = app.current.mainFile && app.current.tree.includes(app.current.mainFile)
      ? app.current.mainFile
      : pickDefaultOpenFile(app.current.tree, app.current.mainFile);
    if (fallback) {
      app.ui.pendingOpenFile = fallback;
      setTimeout(() => {
        const target = app.ui.pendingOpenFile;
        app.ui.pendingOpenFile = null;
        if (target) openFile(target).catch(console.error);
      }, 0);
    }
  }

  const layout = h("div", { class: computeLayoutClass(), id: "layoutRoot" }, [
    left,
    h("div", { class: "gutter gutter-left", onmousedown: (ev) => startDrag("left", ev) }),
    editor,
    h("div", { class: "gutter gutter-right", onmousedown: (ev) => startDrag("right", ev) }),
    right,
  ]);

  const railUser = me || { username: "User" };
  const railColor = pickColor(railUser.username || "U");
  const railAvatar = h("div", { class: "rail-avatar", html: (railUser.username || "U").charAt(0).toUpperCase() });
  railAvatar.style.setProperty("--user-accent", railColor.color);
  const railIconBtn = (icon, title, onClick, { active = false, kind = "" } = {}) => {
    const cls = `rail-btn ${kind} ${active ? "active" : ""}`.trim();
    const btnEl = h("button", { class: cls, title, onclick: onClick });
    btnEl.appendChild(iconSvg(icon, { size: 16 }));
    return btnEl;
  };
  const railActionBtn = (icon, title, onClick) => railIconBtn(icon, title, onClick, { kind: "rail-action" });
  const railActionLink = (icon, title, href, onClick) => {
    const linkEl = h("a", { class: "rail-btn rail-action", title, href, onclick: onClick });
    linkEl.appendChild(iconSvg(icon, { size: 16 }));
    return linkEl;
  };
  const railChatBtn = app.ui.assistantEnabled
    ? railIconBtn("chat", t("聊天"), () => openChatPane(), { active: app.ui.leftPaneTab === "chats" })
    : null;
  const rail = h("div", { class: "studio-rail" }, [
    h("div", { class: "studio-rail-group" }, [
      railActionLink("back", t("返回项目列表"), "#projects", () => goProjects()),
      railActionBtn("panel", app.ui.leftCollapsed ? t("显示侧栏") : t("隐藏侧栏"), () => toggleLeftPane()),
      railIconBtn("files", t("文件"), () => setLeftRailMode("files"), { active: app.ui.leftRailMode === "files" }),
      railChatBtn,
    ]),
    h("div", { class: "studio-rail-footer" }, [
      railAvatar,
    ]),
  ]);

  const shell = h("div", { class: "studio-shell" }, [
    rail,
    h("div", { class: "studio-main" }, [layout]),
  ]);

  const aiFloat = renderAiFloat();
  return h("div", { class: "page studio-page" }, aiFloat ? [shell, aiFloat] : [shell]);
}

function renderLoading() {
  return h("div", { class: "page" }, [
    topbar(t("加载中..."), []),
    h("div", { class: "center" }, [h("div", { class: "hint", html: t("加载中...") })]),
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
        h("div", { class: "modal-title", html: title || "AI" }),
      ]),
      h("div", { class: "modal-body" }, [bodyEl]),
      actionRow,
    ]),
  ]);
}

function render() {
  let page;
  if (app.view === "loading") page = renderLoading();
  else if (app.view === "login") page = renderProjects();
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
  applySplitVars();
  mount(render());

  await loadMe().catch(() => {});
  if (!app.me) {
    const ok = await tryAutoLogin();
    if (ok) await loadMe().catch(() => {});
  }
  if (!app.me) {
    localStorage.removeItem("ct_session_token");
    enterGuestMode();
    await loadProjects();
    mount(render());
    return;
  }

  await loadProjects();
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
  if (ev.key === "Escape" && app && app.ui && app.ui.aiFloatOpen) {
    closeAiFloat();
    return;
  }
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
  enterGuestMode();
  loadProjects().then(() => mount(render())).catch(() => mount(render()));
});
