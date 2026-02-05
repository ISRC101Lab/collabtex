// CollabTeX: minimal intranet Overleaf-like editor (real-time collaboration + LaTeX compile).
//
// Start:
//   npm install
//   npm run build
//   npm run start
//
import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

import { resolveDataDir, ensureDir } from "./lib/paths.js";
import { ensureDefaultUsers, loadUsers, authenticate, findUser } from "./lib/users.js";
import {
  initSession,
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
} from "./lib/session.js";
import { parseCookieHeader } from "./lib/cookies.js";
import {
  loadProjects,
  saveProjects,
  createProject,
  canAccessProject,
  projectPath,
  listProjectTree,
  cleanupProject,
  resolveProjectFilePath,
} from "./lib/projects.js";
import { startCompile, getJob, subscribeJob, publicJob, getCompileOverview } from "./lib/compile.js";
import { listHistory, readHistoryItem, recordHistory } from "./lib/history.js";
import { createCollabServer } from "./collab.js";

import Busboy from "busboy";
import unzipper from "unzipper";
import archiver from "archiver";

const WEB_PORT = Number(process.env.WEB_PORT || 4092);
const WS_PORT = Number(process.env.WS_PORT || (Number.isFinite(WEB_PORT) ? WEB_PORT + 1 : 4093));
const WEB_HOST = process.env.WEB_HOST || "0.0.0.0";
const WS_HOST = process.env.WS_HOST || "0.0.0.0";

function jsonError(res, status, message) {
  res.status(status).json({ error: message });
}

function normalizeTags(input) {
  if (Array.isArray(input)) {
    return Array.from(
      new Set(
        input.map((v) => String(v || "").trim()).filter((v) => v.length > 0)
      )
    ).slice(0, 20);
  }
  if (!input) return [];
  const parts = String(input)
    .split(/[,，;；]/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return Array.from(new Set(parts)).slice(0, 20);
}

function normalizeRelPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function sanitizeZipName(name) {
  const safe = String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
  return safe || "collabtex-project";
}

function remapPathPrefix(pathStr, fromPrefix, toPrefix) {
  const path = normalizeRelPath(pathStr);
  const from = normalizeRelPath(fromPrefix);
  const to = normalizeRelPath(toPrefix);
  if (!path || !from) return pathStr;
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return pathStr;
}

async function fileExists(p) {
  try {
    const st = await fs.stat(p);
    return st && st.isFile();
  } catch {
    return false;
  }
}

const DEFAULT_MAIN_TEMPLATE = [
  "\\documentclass{article}",
  "\\begin{document}",
  "Hello, CollabTeX!",
  "\\end{document}",
  "",
].join("\n");

function getTokenFromReq(req, session) {
  const cookies = parseCookieHeader(req.headers.cookie);
  let token = cookies[session.cookieName];
  if (!token) {
    const auth = req.headers.authorization || req.headers.Authorization;
    if (auth && typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
      token = auth.slice(7).trim();
    }
  }
  if (!token && req.query && typeof req.query.token === "string") {
    token = req.query.token;
  }
  return token || "";
}

function getSessionFromReq(req, session) {
  const token = getTokenFromReq(req, session);
  return verifySession(session.secret, token);
}

function requireAuth(session) {
  return (req, res, next) => {
    const sess = getSessionFromReq(req, session);
    if (!sess || !sess.username) return jsonError(res, 401, "unauthorized");
    req.user = sess;
    next();
  };
}

function normalizeZipPath(p) {
  // Zip files may use backslashes; always treat paths as POSIX-like.
  return String(p || "")
    .replaceAll("\\\\", "/")
    .replace(/^\/+/, "");
}

function detectZipRootPrefix(paths) {
  const top = new Set();
  let hasRootFiles = false;
  for (const p of paths) {
    const clean = String(p || "");
    if (!clean) continue;
    const parts = clean.split("/");
    if (parts.length <= 1) {
      hasRootFiles = true;
      break;
    }
    if (parts[0]) top.add(parts[0]);
  }
  if (!hasRootFiles && top.size === 1) {
    const [prefix] = Array.from(top);
    return `${prefix}/`;
  }
  return "";
}

function scoreMainCandidate(filePath, content) {
  const lowerPath = String(filePath || "").toLowerCase();
  const name = path.posix.basename(lowerPath);
  const depth = lowerPath.split("/").length - 1;
  let score = Math.max(0, 4 - depth) * 6;

  if (name === "main.tex") score += 50;
  if (name.includes("main")) score += 20;
  if (
    name.includes("paper") ||
    name.includes("manuscript") ||
    name.includes("submission") ||
    name.includes("camera") ||
    name.includes("final")
  ) {
    score += 16;
  }

  if (
    lowerPath.includes("/section") ||
    lowerPath.includes("/sections") ||
    lowerPath.includes("/sec") ||
    lowerPath.includes("/chapter") ||
    lowerPath.includes("/chapters") ||
    lowerPath.includes("/appendix") ||
    lowerPath.includes("/supp")
  ) {
    score -= 18;
  }
  if (/^\d/.test(name)) score -= 10;

  const text = String(content || "");
  if (text.includes("\\documentclass")) score += 60;
  if (text.includes("\\begin{document}")) score += 40;
  if (text.includes("\\end{document}")) score += 30;
  if (text.includes("\\input{") || text.includes("\\include{")) score += 6;

  return score;
}

function isDefaultMainTemplate(text) {
  const raw = String(text || "");
  if (!raw) return false;
  return raw.includes("Hello, CollabTeX!") && raw.includes("\\documentclass");
}

async function readHead(absPath, limit = 8000) {
  try {
    const buf = await fs.readFile(absPath, "utf8");
    return buf.slice(0, limit);
  } catch {
    return "";
  }
}

function hasLatexPreamble(text) {
  const raw = String(text || "");
  return raw.includes("\\documentclass") || raw.includes("\\begin{document}");
}

async function pickBestMainFile(projDir, currentRel = "") {
  const tree = await listProjectTree(projDir).catch(() => []);
  const texFiles = tree.filter((f) => f.toLowerCase().endsWith(".tex"));
  if (!texFiles.length) return { selected: currentRel || "", changed: false };

  let currentScore = -1;
  if (currentRel && texFiles.includes(currentRel)) {
    const currentAbs = path.join(projDir, currentRel);
    const currentText = await readHead(currentAbs);
    currentScore = scoreMainCandidate(currentRel, currentText);
  }

  let best = "";
  let bestScore = -1;
  for (const f of texFiles) {
    const abs = path.join(projDir, f);
    const text = await readHead(abs);
    const score = scoreMainCandidate(f, text);
    if (score > bestScore || (score === bestScore && f.length < best.length)) {
      best = f;
      bestScore = score;
    }
  }

  if (!best) return { selected: currentRel || "", changed: false };
  if (!currentRel || currentRel === best) return { selected: best, changed: false };
  if (bestScore >= currentScore + 12) return { selected: best, changed: true };
  return { selected: currentRel, changed: false };
}

async function repairSymlinkPlaceholders(projDir) {
  const exts = new Set([".cls", ".sty", ".bib", ".bst", ".bbx", ".cbx", ".dbx"]);
  const fixed = [];
  const skipped = [];

  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        const rel = path.relative(projDir, abs).replaceAll("\\\\", "/");
        if (rel === "build" || rel.startsWith("build/")) continue;
        if (rel.startsWith(".collabtex-history")) continue;
        await walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!exts.has(ext)) continue;

      const st = await fs.stat(abs);
      if (st.size <= 0 || st.size > 512) continue;
      const raw = await fs.readFile(abs, "utf8");
      const t = raw.replace(/\0/g, "").trim();
      if (!t) continue;
      if (t.includes("\n") || t.includes("\r") || t.includes("\t") || t.includes(" ")) continue;
      if (!(t.startsWith("./") || t.startsWith("../"))) continue;
      if (path.isAbsolute(t)) continue;
      if (path.extname(t).toLowerCase() !== ext) continue;

      const targetAbs = path.resolve(path.dirname(abs), t);
      const inside = targetAbs === projDir || targetAbs.startsWith(projDir + path.sep);
      if (!inside) {
        skipped.push({ file: path.relative(projDir, abs).replaceAll("\\\\", "/"), reason: "target escapes project", target: t });
        continue;
      }

      try {
        const tstat = await fs.stat(targetAbs);
        if (!tstat.isFile()) {
          skipped.push({ file: path.relative(projDir, abs).replaceAll("\\\\", "/"), reason: "target not a file", target: t });
          continue;
        }
        const buf = await fs.readFile(targetAbs);
        await fs.writeFile(abs, buf);
        fixed.push({
          file: path.relative(projDir, abs).replaceAll("\\\\", "/"),
          target: path.relative(projDir, targetAbs).replaceAll("\\\\", "/"),
        });
      } catch (e) {
        skipped.push({ file: path.relative(projDir, abs).replaceAll("\\\\", "/"), reason: e && e.message ? e.message : String(e), target: t });
      }
    }
  };

  await walk(projDir);
  return { fixed, skipped };
}

function zipUnixMode(entry) {
  // In zip: upper 16 bits often store UNIX mode+type (e.g. 0120777 for symlink).
  const n = Number(entry && entry.externalFileAttributes ? entry.externalFileAttributes : 0);
  return (n >>> 16) & 0xffff;
}

function isZipSymlink(entry) {
  const mode = zipUnixMode(entry);
  // 0120000 is the UNIX file type for symlink.
  return (mode & 0o170000) === 0o120000;
}

const TEMPLATE_CATALOG = [
  { id: "blank", name: "Blank (Article)", mainFile: "main.tex", dir: "" },
  { id: "acm-sigconf", name: "ACM SIGCONF (acmart)", mainFile: "main.tex", dir: "acm-sigconf" },
];

function templateRoot() {
  return path.resolve(new URL("./templates", import.meta.url).pathname);
}

async function copyDir(src, dst) {
  await ensureDir(dst);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      await copyDir(s, d);
    } else if (ent.isFile()) {
      await ensureDir(path.dirname(d));
      await fs.copyFile(s, d);
    }
  }
}

async function applyTemplate(templateId, projectDir) {
  const tpl = TEMPLATE_CATALOG.find((t) => t.id === templateId);
  if (!tpl || !tpl.dir) return { applied: false, mainFile: tpl ? tpl.mainFile : "main.tex" };
  const src = path.join(templateRoot(), tpl.dir);
  try {
    const st = await fs.stat(src);
    if (!st.isDirectory()) return { applied: false, mainFile: tpl.mainFile };
  } catch {
    return { applied: false, mainFile: tpl.mainFile };
  }
  await copyDir(src, projectDir);
  return { applied: true, mainFile: tpl.mainFile };
}

async function main() {
  const umaskRaw = process.env.FILE_UMASK;
  const umaskVal = umaskRaw ? Number.parseInt(umaskRaw, 8) : 0o077;
  try {
    if (Number.isFinite(umaskVal)) process.umask(umaskVal);
  } catch {
    // ignore umask errors
  }

  const dataDir = resolveDataDir();
  await ensureDir(dataDir);

  const session = await initSession();
  let usersDb = await ensureDefaultUsers(dataDir);

  const app = express();
  app.set("etag", false);
  app.use(express.json({ limit: "20mb" }));

  const setNoStoreHeaders = (res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  };

  // Minimal API access log to help debug "button does nothing" reports.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      try {
        if (!req.path.startsWith("/api/")) return;
        const ms = Date.now() - start;
        console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
      } catch {
        // ignore
      }
    });
    next();
  });

  // Static/page access log to confirm the browser reaches the server.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      try {
        if (req.path.startsWith("/api/")) return;
        const shouldLog =
          req.path === "/" ||
          req.path === "/index.html" ||
          req.path.endsWith(".js") ||
          req.path.endsWith(".css");
        if (!shouldLog) return;
        const ms = Date.now() - start;
        const host = req.headers.host || "";
        console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms ${host}`);
      } catch {
        // ignore
      }
    });
    next();
  });

  // Prevent stale API responses (304) from breaking client logic.
  app.use((req, res, next) => {
    if (req.path && req.path.startsWith("/api/")) {
      setNoStoreHeaders(res);
    }
    next();
  });

  // Auth
  app.post("/api/login", async (req, res) => {
    const body = req.body || {};
    const username = body.username;
    const password = body.password;
    if (!username || !password) return jsonError(res, 400, "missing username/password");

    usersDb = await loadUsers(dataDir);
    const user = await authenticate(usersDb, username, password);
    if (!user) return jsonError(res, 401, "bad credentials");

    const token = signSession(session.secret, {
      username: user.username,
      isAdmin: !!user.isAdmin,
      exp: Date.now() + 7 * 24 * 3600 * 1000,
    });

    setSessionCookie(res, session.cookieName, token);
    res.json({ ok: true, username: user.username, isAdmin: !!user.isAdmin, token });
  });

  app.post("/api/logout", async (_req, res) => {
    clearSessionCookie(res, session.cookieName);
    res.json({ ok: true });
  });

  app.get("/api/me", async (req, res) => {
    const sess = getSessionFromReq(req, session);
    if (!sess || !sess.username) return res.json({ authenticated: false });
    const token = getTokenFromReq(req, session);
    res.json({ authenticated: true, username: sess.username, isAdmin: !!sess.isAdmin, token });
  });

  app.get("/api/ping", (req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
      host: req.headers.host || "",
      forwardedHost: req.headers["x-forwarded-host"] || "",
      forwardedProto: req.headers["x-forwarded-proto"] || "",
      remote: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "",
    });
  });

  // Projects
  app.get("/api/projects", requireAuth(session), async (req, res) => {
    const db = await loadProjects(dataDir);
    const projects = db.projects.filter((p) => canAccessProject(p, req.user.username));
    res.json({ projects });
  });

  app.get("/api/templates", requireAuth(session), async (req, res) => {
    const templates = TEMPLATE_CATALOG.map((t) => ({ id: t.id, name: t.name, mainFile: t.mainFile }));
    res.json({ templates });
  });

  app.post("/api/projects", requireAuth(session), async (req, res) => {
    const body = req.body || {};
    const name = body.name;
    const templateId = body.template || "blank";
    const tpl = TEMPLATE_CATALOG.find((t) => t.id === templateId) || TEMPLATE_CATALOG[0];
    const mainFile = (tpl && tpl.mainFile) || body.mainFile || "main.tex";
    const p = await createProject(dataDir, { owner: req.user.username, name, mainFile });
    if (templateId && templateId !== "blank") {
      const projDir = projectPath(dataDir, p.id);
      await applyTemplate(templateId, projDir);
    }
    res.json({ project: p });
  });

  app.post("/api/projects/:id/share", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const username = (req.body || {}).username;
    if (!username) return jsonError(res, 400, "missing username");

    usersDb = await loadUsers(dataDir);
    if (!findUser(usersDb, username)) return jsonError(res, 404, "user not found");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (p.owner !== req.user.username && !req.user.isAdmin) return jsonError(res, 403, "forbidden");

    p.collaborators = Array.from(new Set([...(p.collaborators || []), username]));
    p.updatedAt = new Date().toISOString();
    await saveProjects(dataDir, db);
    res.json({ ok: true });
  });

  app.post("/api/projects/:id/meta", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const body = req.body || {};
    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (p.owner !== req.user.username && !req.user.isAdmin) return jsonError(res, 403, "forbidden");

    if (typeof body.name === "string" && body.name.trim()) {
      p.name = body.name.trim();
    }
    if (typeof body.category === "string") {
      p.category = body.category.trim();
    }
    if (typeof body.tags !== "undefined") {
      p.tags = normalizeTags(body.tags);
    }
    p.updatedAt = new Date().toISOString();
    await saveProjects(dataDir, db);
    res.json({ ok: true, project: p });
  });

  app.delete("/api/projects/:id", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const idx = db.projects.findIndex((x) => x.id === projectId);
    if (idx === -1) return jsonError(res, 404, "project not found");
    const p = db.projects[idx];
    if (p.owner !== req.user.username && !req.user.isAdmin) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const trashRoot = path.join(dataDir, "projects-trash");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const trashPath = path.join(trashRoot, `${projectId}-${stamp}`);
    try {
      await ensureDir(trashRoot);
      await fs.rename(projDir, trashPath);
    } catch {
      try {
        await fs.rm(projDir, { recursive: true, force: true });
      } catch (e) {
        return jsonError(res, 500, e && e.message ? e.message : String(e));
      }
    }
    db.projects.splice(idx, 1);
    await saveProjects(dataDir, db);
    res.json({ ok: true });
  });

  app.get("/api/projects/:id/tree", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const forceClean = String(req.query && req.query.cleanup ? req.query.cleanup : "") === "1";
    await cleanupProject(projDir, p.mainFile, { force: forceClean });
    const tree = await listProjectTree(projDir);
    res.json({ tree, mainFile: p.mainFile, compiler: p.compiler || "pdflatex" });
  });

  app.get("/api/projects/:id/export.zip", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const files = await listProjectTree(projDir);
    const zipName = `${sanitizeZipName(p.name || `project-${projectId.slice(0, 8)}`)}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      try {
        res.status(500).end(err && err.message ? err.message : "zip failed");
      } catch {
        // ignore
      }
    });
    archive.pipe(res);

    for (const rel of files) {
      const abs = resolveProjectFilePath(dataDir, projectId, rel);
      archive.file(abs, { name: rel });
    }
    archive.finalize();
  });

  app.post("/api/projects/:id/search", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const body = req.body || {};
    const query = String(body.query || "").trim();
    if (!query) return jsonError(res, 400, "missing query");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const limitRaw = Number(body.limit || 200);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 1000)) : 200;
    const caseSensitive = !!body.caseSensitive;
    const useRegex = !!body.regex;
    const extsRaw = Array.isArray(body.exts) ? body.exts : [];
    const maxBytesRaw = Number(body.maxBytes || 2_000_000);
    const maxBytes = Number.isFinite(maxBytesRaw) ? Math.max(10_000, Math.min(maxBytesRaw, 8_000_000)) : 2_000_000;

    let matcher = null;
    if (useRegex) {
      try {
        matcher = new RegExp(query, caseSensitive ? "g" : "gi");
      } catch {
        return jsonError(res, 400, "bad regex");
      }
    }

    const exts = new Set(
      extsRaw
        .map((x) => String(x || "").trim().toLowerCase())
        .filter(Boolean)
        .map((x) => (x.startsWith(".") ? x : `.${x}`))
    );

    const projDir = projectPath(dataDir, projectId);
    const tree = await listProjectTree(projDir);
    const results = [];
    let scanned = 0;
    let skipped = 0;
    const started = Date.now();
    const qLower = caseSensitive ? query : query.toLowerCase();

    for (const rel of tree) {
      if (exts.size) {
        const ext = path.extname(rel).toLowerCase();
        if (!exts.has(ext)) continue;
      }

      const abs = resolveProjectFilePath(dataDir, projectId, rel);
      let st;
      try {
        st = await fs.stat(abs);
      } catch {
        continue;
      }
      if (st.size > maxBytes) {
        skipped += 1;
        continue;
      }

      let text = "";
      try {
        text = await fs.readFile(abs, "utf8");
      } catch {
        continue;
      }
      if (text.includes("\0")) {
        skipped += 1;
        continue;
      }
      scanned += 1;

      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) continue;
        if (matcher) {
          matcher.lastIndex = 0;
          let m;
          while ((m = matcher.exec(line))) {
            results.push({
              file: rel,
              line: i + 1,
              column: (m.index || 0) + 1,
              preview: line.slice(0, 320),
            });
            if (results.length >= limit) break;
            if (m.index === matcher.lastIndex) matcher.lastIndex += 1;
          }
        } else {
          const idx = caseSensitive ? line.indexOf(query) : line.toLowerCase().indexOf(qLower);
          if (idx !== -1) {
            results.push({
              file: rel,
              line: i + 1,
              column: idx + 1,
              preview: line.slice(0, 320),
            });
          }
        }
        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }

    res.json({
      results,
      scanned,
      totalFiles: tree.length,
      skipped,
      limit,
      truncated: results.length >= limit,
      durationMs: Date.now() - started,
    });
  });

  app.post("/api/projects/:id/main", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const mainFile = (req.body || {}).mainFile;
    if (!mainFile) return jsonError(res, 400, "missing mainFile");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (p.owner !== req.user.username && !req.user.isAdmin) return jsonError(res, 403, "forbidden");

    p.mainFile = mainFile;
    p.updatedAt = new Date().toISOString();
    await saveProjects(dataDir, db);
    res.json({ ok: true });
  });

  app.post("/api/projects/:id/compiler", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const compiler = (req.body || {}).compiler;
    if (!compiler) return jsonError(res, 400, "missing compiler");
    if (!["pdflatex", "xelatex", "lualatex"].includes(compiler)) return jsonError(res, 400, "unsupported compiler");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (p.owner !== req.user.username && !req.user.isAdmin) return jsonError(res, 403, "forbidden");

    p.compiler = compiler;
    p.updatedAt = new Date().toISOString();
    await saveProjects(dataDir, db);
    res.json({ ok: true });
  });

  // Repair zip-imported symlinks that were stored as tiny placeholder files (common with `zip -y`).
  // This is a best-effort "make it compile" helper for intranet use.
  app.post("/api/projects/:id/repair-symlinks", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const { fixed, skipped } = await repairSymlinkPlaceholders(projDir);
    res.json({ ok: true, fixed, skipped });
  });

  app.post("/api/projects/:id/file", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const rel = (req.body || {}).path;
    const content = (req.body || {}).content;
    if (!rel) return jsonError(res, 400, "missing path");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const abs = resolveProjectFilePath(dataDir, projectId, rel);
    await ensureDir(path.dirname(abs));
    await fs.writeFile(abs, content || "", "utf8");
    res.json({ ok: true });
  });

  app.get("/api/projects/:id/file", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const rel = req.query && req.query.path ? String(req.query.path) : "";
    if (!rel) return jsonError(res, 400, "missing path");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const abs = resolveProjectFilePath(dataDir, projectId, rel);
    try {
      const st = await fs.stat(abs);
      if (st.isDirectory()) return jsonError(res, 400, "cannot open directory");
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(abs);
    } catch (e) {
      jsonError(res, 404, e && e.message ? e.message : "file not found");
    }
  });

  app.delete("/api/projects/:id/file", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const rel = (req.body || {}).path;
    const cleanRel = String(rel || "").trim();
    if (!cleanRel || cleanRel === "/" || cleanRel === ".") return jsonError(res, 400, "missing path");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const abs = resolveProjectFilePath(dataDir, projectId, cleanRel);
    const repairMainFile = async () => {
      try {
        const projDir = projectPath(dataDir, projectId);
        const currentMain = p.mainFile || "";
        const mainAbs = currentMain ? resolveProjectFilePath(dataDir, projectId, currentMain) : "";
        if (currentMain && mainAbs && (await fileExists(mainAbs))) return;

        const tree = await listProjectTree(projDir).catch(() => []);
        const texFiles = tree.filter((f) => f.toLowerCase().endsWith(".tex"));
        let nextMain = "";
        if (texFiles.includes("main.tex")) nextMain = "main.tex";
        else if (texFiles.length) nextMain = texFiles[0];
        if (!nextMain) {
          nextMain = "main.tex";
          const fallbackAbs = resolveProjectFilePath(dataDir, projectId, nextMain);
          await ensureDir(path.dirname(fallbackAbs));
          await fs.writeFile(fallbackAbs, DEFAULT_MAIN_TEMPLATE);
        }
        p.mainFile = nextMain;
        p.updatedAt = new Date().toISOString();
        await saveProjects(dataDir, db);
      } catch {
        // ignore main file repair errors
      }
    };
    try {
      const st = await fs.stat(abs);
      if (st.isDirectory()) {
        await fs.rm(abs, { recursive: true, force: true });
        await repairMainFile();
        return res.json({ ok: true });
      }
    } catch {
      return jsonError(res, 404, "file not found");
    }

    await fs.rm(abs);
    await repairMainFile();
    res.json({ ok: true });
  });

  app.post("/api/projects/:id/rename", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const oldPath = (req.body || {}).oldPath;
    const newPath = (req.body || {}).newPath;
    if (!oldPath || !newPath) return jsonError(res, 400, "missing oldPath/newPath");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const src = resolveProjectFilePath(dataDir, projectId, oldPath);
    const dst = resolveProjectFilePath(dataDir, projectId, newPath);
    await ensureDir(path.dirname(dst));
    try {
      await fs.rename(src, dst);
    } catch (e) {
      return jsonError(res, 400, e && e.message ? e.message : String(e));
    }

    const mainFile = p.mainFile || "";
    const remapped = remapPathPrefix(mainFile, oldPath, newPath);
    if (remapped !== mainFile) {
      p.mainFile = remapped;
      p.updatedAt = new Date().toISOString();
      await saveProjects(dataDir, db);
    }

    res.json({ ok: true });
  });

  app.post("/api/projects/:id/upload", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const bb = Busboy({ headers: req.headers, limits: { fileSize: 200 * 1024 * 1024 } });
    let rel = null;
    let bufs = [];
    let total = 0;

    bb.on("field", (fieldname, val) => {
      if (fieldname === "path") rel = val;
    });

    bb.on("file", (fieldname, file) => {
      if (fieldname !== "file") return file.resume();
      file.on("data", (d) => {
        total += d.length;
        bufs.push(d);
      });
    });

    bb.on("finish", async () => {
      try {
        if (!rel) return jsonError(res, 400, "missing path");
        const abs = resolveProjectFilePath(dataDir, projectId, rel);
        await ensureDir(path.dirname(abs));
        await fs.writeFile(abs, Buffer.concat(bufs));
        res.json({ ok: true, bytes: total });
      } catch (e) {
        jsonError(res, 500, e && e.message ? e.message : String(e));
      }
    });

    req.pipe(bb);
  });

  app.post("/api/projects/import", requireAuth(session), async (req, res) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 200 * 1024 * 1024 } });
    let name = null;
    let mainFile = "main.tex";
    let zipBufs = [];
    let zipBytes = 0;

    bb.on("field", (fieldname, val) => {
      if (fieldname === "name") name = val;
      if (fieldname === "mainFile" && val) mainFile = val;
    });

    bb.on("file", (fieldname, file) => {
      if (fieldname !== "zip") return file.resume();
      file.on("data", (d) => {
        zipBytes += d.length;
        zipBufs.push(d);
      });
    });

    bb.on("finish", async () => {
      try {
        const project = await createProject(dataDir, { owner: req.user.username, name, mainFile });
        const importWarnings = [];

        let rootPrefix = "";
        let writtenPaths = [];
        if (zipBytes > 0) {
          const zip = Buffer.concat(zipBufs);
          const directory = await unzipper.Open.buffer(zip);

          // Build a quick lookup so we can de-reference symlinks stored in zips (common on Linux).
          const byPath = new Map();
          const allPaths = [];
          for (const entry of directory.files) {
            const p = normalizeZipPath(entry.path);
            if (!p || p.endsWith("/")) continue;
            if (p.startsWith("__MACOSX/")) continue;
            if (p.includes("\\0")) continue;
            byPath.set(p, entry);
            allPaths.push(p);
          }

          rootPrefix = detectZipRootPrefix(allPaths);
          if (rootPrefix) importWarnings.push(`flattened root folder: ${rootPrefix}`);

          const derefCache = new Map(); // zipPath -> Buffer
          const derefEntry = async (zipPath, depth = 0) => {
            if (derefCache.has(zipPath)) return derefCache.get(zipPath);
            const entry = byPath.get(zipPath);
            if (!entry) return null;
            if (!isZipSymlink(entry)) {
              const buf = await entry.buffer();
              derefCache.set(zipPath, buf);
              return buf;
            }
            if (depth > 8) {
              importWarnings.push(`symlink loop too deep at: ${zipPath}`);
              const buf = await entry.buffer();
              derefCache.set(zipPath, buf);
              return buf;
            }

            // Symlink entries typically store the target path as the file contents.
            const targetRaw = (await entry.buffer()).toString("utf8").replace(/\0/g, "").trim();
            const baseDir = path.posix.dirname(zipPath);
            const resolved = path.posix.normalize(path.posix.join(baseDir, targetRaw));

            if (path.posix.isAbsolute(resolved) || resolved === ".." || resolved.startsWith("../")) {
              importWarnings.push(`unsupported symlink (escapes project): ${zipPath} -> ${targetRaw}`);
              const buf = await entry.buffer();
              derefCache.set(zipPath, buf);
              return buf;
            }

            const targetEntry = byPath.get(resolved);
            if (!targetEntry) {
              importWarnings.push(`dangling symlink: ${zipPath} -> ${targetRaw} (missing ${resolved} in zip)`);
              const buf = await entry.buffer();
              derefCache.set(zipPath, buf);
              return buf;
            }

            const buf = await derefEntry(resolved, depth + 1);
            derefCache.set(zipPath, buf);
            return buf;
          };

          writtenPaths = [];
          for (const [p, entry] of byPath.entries()) {
            // Skip writing the warning file if present in the zip; we may generate our own.
            if (p === ".collabtex-import-warnings.txt") continue;
            let writePath = p;
            if (rootPrefix && writePath.startsWith(rootPrefix)) {
              writePath = writePath.slice(rootPrefix.length);
            }
            if (!writePath) continue;
            const abs = resolveProjectFilePath(dataDir, project.id, writePath);
            await ensureDir(path.dirname(abs));
            const content = (await derefEntry(p)) ?? (await entry.buffer());
            await fs.writeFile(abs, content);
            writtenPaths.push(writePath);
          }

          if (importWarnings.length) {
            const warnPath = path.join(projectPath(dataDir, project.id), ".collabtex-import-warnings.txt");
            const text =
              "CollabTeX import warnings:\n" +
              importWarnings.map((w) => `- ${w}`).join("\n") +
              "\n";
            await fs.writeFile(warnPath, text, "utf8");
          }
        }

        // If we flattened a root folder, drop the auto-created default main inside that folder.
        const legacyMain = normalizeZipPath(mainFile || "main.tex");
        let desiredMain = legacyMain;
        if (rootPrefix && desiredMain.startsWith(rootPrefix)) {
          desiredMain = desiredMain.slice(rootPrefix.length);
        }
        if (rootPrefix && legacyMain !== desiredMain && legacyMain) {
          try {
            const legacyAbs = resolveProjectFilePath(dataDir, project.id, legacyMain);
            const txt = await fs.readFile(legacyAbs, "utf8");
            if (isDefaultMainTemplate(txt)) {
              await fs.rm(legacyAbs, { force: true });
            }
          } catch {
            // ignore cleanup failures
          }
        }

        // Repair main file if the requested path does not exist in the imported tree.
        const writtenSet = new Set();
        const projDir = projectPath(dataDir, project.id);
        try {
          const tree = await listProjectTree(projDir);
          for (const f of tree) writtenSet.add(f);
        } catch {
          for (const f of writtenPaths || []) writtenSet.add(f);
        }

        const texFiles = Array.from(writtenSet).filter((f) => f.toLowerCase().endsWith(".tex"));
        let finalMain = desiredMain;
        if (!writtenSet.has(finalMain) && texFiles.length) {
          let best = "";
          let bestScore = -1;
          for (const f of texFiles) {
            let content = "";
            try {
              const abs = resolveProjectFilePath(dataDir, project.id, f);
              const raw = await fs.readFile(abs, "utf8");
              content = raw.slice(0, 8000);
            } catch {
              // ignore read failures
            }
            const score = scoreMainCandidate(f, content);
            if (score > bestScore || (score === bestScore && f.length < best.length)) {
              best = f;
              bestScore = score;
            }
          }
          if (best) {
            finalMain = best;
            importWarnings.push(`main file auto-detected: ${finalMain}`);
          }
        }

        if (finalMain && project.mainFile !== finalMain) {
          const db = await loadProjects(dataDir);
          const p = db.projects.find((x) => x.id === project.id);
          if (p) {
            p.mainFile = finalMain;
            p.updatedAt = new Date().toISOString();
            await saveProjects(dataDir, db);
            project.mainFile = finalMain;
          }
        }

        res.json({ project, warnings: importWarnings });
      } catch (e) {
        jsonError(res, 500, e && e.message ? e.message : String(e));
      }
    });

    req.pipe(bb);
  });

  // Compile
  app.post("/api/projects/:id/compile", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const clean = !!(req.body && req.body.clean);
    const mode = (req.body && req.body.mode) || "full";
    const origin = (req.body && req.body.origin) || "manual";
    const requestedMain = req.body && req.body.mainFile ? String(req.body.mainFile) : "";
    if (!["full", "quick"].includes(mode)) return jsonError(res, 400, "unsupported compile mode");
    let mainFile = p.mainFile;
    const checkMainExists = async (rel) => {
      if (!rel) return false;
      try {
        const abs = resolveProjectFilePath(dataDir, projectId, rel);
        const st = await fs.stat(abs);
        return !st.isDirectory();
      } catch {
        return false;
      }
    };
    if (requestedMain && requestedMain.trim()) {
      const rel = requestedMain.trim();
      if (await checkMainExists(rel)) {
        mainFile = rel;
      }
    }
    const projDir = projectPath(dataDir, projectId);
    if (process.env.AUTO_REPAIR_SYMLINKS !== "0") {
      try {
        await repairSymlinkPlaceholders(projDir);
      } catch {
        // ignore repair errors
      }
    }

    if (!(await checkMainExists(mainFile))) {
      const tree = await listProjectTree(projDir).catch(() => []);
      const texFiles = tree.filter((f) => f.toLowerCase().endsWith(".tex"));
      let nextMain = "";
      if (texFiles.includes("main.tex")) nextMain = "main.tex";
      else if (texFiles.length) nextMain = texFiles[0];
      if (!nextMain) return jsonError(res, 404, "main file not found");
      mainFile = nextMain;
      p.mainFile = nextMain;
      p.updatedAt = new Date().toISOString();
      await saveProjects(dataDir, db);
    }

    // If the main file looks like a fragment (no preamble), auto-pick a better candidate.
    try {
      const mainAbs = resolveProjectFilePath(dataDir, projectId, mainFile);
      const head = await readHead(mainAbs);
      if (mainFile && !hasLatexPreamble(head)) {
        const pick = await pickBestMainFile(projDir, mainFile);
        if (pick && pick.selected && pick.selected !== mainFile) {
          const candAbs = resolveProjectFilePath(dataDir, projectId, pick.selected);
          const candHead = await readHead(candAbs);
          if (hasLatexPreamble(candHead)) {
            mainFile = pick.selected;
            p.mainFile = pick.selected;
            p.updatedAt = new Date().toISOString();
            await saveProjects(dataDir, db);
          }
        }
      }
    } catch {
      // ignore auto main selection errors
    }
    const job = await startCompile({
      dataDir,
      projectId,
      mainFile,
      compiler: p.compiler || "pdflatex",
      clean,
      mode,
      origin,
    });
    res.json({ jobId: job.id });
  });

  app.get("/api/admin/compile/overview", requireAuth(session), async (req, res) => {
    if (!req.user || !req.user.isAdmin) return jsonError(res, 403, "forbidden");
    res.json(getCompileOverview());
  });

  app.post("/api/projects/:id/synctex", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const body = req.body || {};
    const file = body.file;
    const line = Number(body.line || 0);
    const column = Number(body.column || 1);
    const target = body.target ? String(body.target) : "";
    if (!file || !Number.isFinite(line) || line <= 0) return jsonError(res, 400, "missing file/line");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const abs = resolveProjectFilePath(dataDir, projectId, file);
    try {
      await fs.stat(abs);
    } catch {
      return jsonError(res, 404, "file not found");
    }

    let mainFile = p.mainFile;
    if (target && target.trim()) {
      const rel = target.trim();
      try {
        const tAbs = resolveProjectFilePath(dataDir, projectId, rel);
        const st = await fs.stat(tAbs);
        if (st.isDirectory()) return jsonError(res, 400, "target is a directory");
        mainFile = rel;
      } catch {
        return jsonError(res, 404, "target file not found");
      }
    }

    const mainAbs = resolveProjectFilePath(dataDir, projectId, mainFile);
    const baseDir = path.dirname(mainAbs);
    const base = path.basename(mainFile, path.extname(mainFile));
    const pdf = path.join(projDir, "build", `${base}.pdf`);
    try {
      await fs.stat(pdf);
    } catch {
      return jsonError(res, 404, "pdf not found (compile first)");
    }

    const sourceRel = path.relative(projDir, abs).replaceAll("\\\\", "/");
    const sourceBaseRel = path.relative(baseDir, abs).replaceAll("\\\\", "/");
    const dockerRel = sourceRel.replaceAll("\\", "/");
    const dockerPath = process.env.COMPILE_DOCKER === "1" ? `/work/${dockerRel}` : "";
    const sourceCandidates = Array.from(
      new Set(
        [abs, sourceBaseRel, sourceRel, dockerPath]
          .map((v) => (v || "").trim())
          .filter((v) => v)
      )
    );

    const runView = async (ln, fileArg) => {
      const args = ["view", "-i", `${ln}:${Math.max(1, column)}:${fileArg}`, "-o", pdf];
      return await new Promise((resolve, reject) => {
        const child = spawn("synctex", args, { cwd: projDir, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => {
          stdout += d.toString("utf8");
        });
        child.stderr.on("data", (d) => {
          stderr += d.toString("utf8");
        });
        child.on("error", (e) => reject(e));
        child.on("close", (code) => resolve({ code, out: stdout, err: stderr }));
      });
    };

    const parseView = (output) => {
      const match = output.match(/Page:\s*([0-9]+)/i);
      if (!match) return null;
      const page = Number(match[1]);
      const xMatch = output.match(/x:\s*([0-9.]+)/i);
      const yMatch = output.match(/y:\s*([0-9.]+)/i);
      const hMatch = output.match(/h:\s*([0-9.]+)/i);
      const vMatch = output.match(/v:\s*([0-9.]+)/i);
      const x = xMatch ? Number(xMatch[1]) : null;
      const y = yMatch ? Number(yMatch[1]) : null;
      const h = hMatch ? Number(hMatch[1]) : null;
      const v = vMatch ? Number(vMatch[1]) : null;
      return { page, x, y, h, v };
    };

    try {
      let lastOutput = "";
      for (const fileArg of sourceCandidates) {
        let attemptLine = line;
        let result = null;
        let output = "";
        const first = await runView(attemptLine, fileArg);
        output = `${first.out}\n${first.err}`;
        result = parseView(output);

        if (!result) {
          const maxRange = Math.max(5, Number(process.env.SYNC_FALLBACK_RANGE || 25));
          for (let delta = 1; delta <= maxRange; delta += 1) {
            const up = line + delta;
            const down = line - delta;
            if (down > 0) {
              const r = await runView(down, fileArg);
              output = `${r.out}\n${r.err}`;
              result = parseView(output);
              if (result) {
                attemptLine = down;
                break;
              }
            }
            const r2 = await runView(up, fileArg);
            output = `${r2.out}\n${r2.err}`;
            result = parseView(output);
            if (result) {
              attemptLine = up;
              break;
            }
          }
        }

        if (result) {
          return res.json({ ...result, lineUsed: attemptLine });
        }
        if (output && output.trim()) lastOutput = output;
      }

      const msg = lastOutput.trim() || "No SyncTeX info for this line (preamble or not included)";
      return jsonError(res, 400, msg);
    } catch (e) {
      jsonError(res, 500, e && e.message ? e.message : String(e));
    }
  });

  // PDF -> source (synctex edit)
  app.post("/api/projects/:id/synctex/edit", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const body = req.body || {};
    const page = Number(body.page || 0);
    const x = Number(body.x);
    const y = Number(body.y);
    const pageHeight = Number(body.pageHeight);
    const target = body.target ? String(body.target) : "";
    if (!Number.isFinite(page) || page <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
      return jsonError(res, 400, "missing page/x/y");
    }

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    let mainFile = p.mainFile;
    if (target && target.trim()) {
      const rel = target.trim();
      try {
        const tAbs = resolveProjectFilePath(dataDir, projectId, rel);
        const st = await fs.stat(tAbs);
        if (st.isDirectory()) return jsonError(res, 400, "target is a directory");
        mainFile = rel;
      } catch {
        return jsonError(res, 404, "target file not found");
      }
    }
    const mainAbs = resolveProjectFilePath(dataDir, projectId, mainFile);
    const baseDir = path.dirname(mainAbs);
    const base = path.basename(mainFile, path.extname(mainFile));
    const pdf = path.join(projDir, "build", `${base}.pdf`);
    try {
      await fs.stat(pdf);
    } catch {
      return jsonError(res, 404, "pdf not found (compile first)");
    }

    const runEdit = async (xx, yy) => {
      const args = ["edit", "-o", `${page}:${xx}:${yy}:${pdf}`];
      return await new Promise((resolve, reject) => {
        const child = spawn("synctex", args, { cwd: projDir, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => {
          stdout += d.toString("utf8");
        });
        child.stderr.on("data", (d) => {
          stderr += d.toString("utf8");
        });
        child.on("error", (e) => reject(e));
        child.on("close", (code) => resolve({ code, out: stdout, err: stderr }));
      });
    };

    const parseOutput = (output) => {
      const text = String(output || "");
      let m = text.match(/Input:(\d+):(\d+):(.+)/);
      if (m) {
        const line = Number(m[1]) || 1;
        const column = Number(m[2]) || 1;
        const fileRaw = (m[3] || "").trim();
        let abs = "";
        if (path.isAbsolute(fileRaw)) {
          if (process.env.COMPILE_DOCKER === "1" && fileRaw.startsWith("/work/")) {
            abs = path.resolve(projDir, path.relative("/work", fileRaw));
          } else {
            abs = fileRaw;
          }
        } else {
          const baseAbs = path.resolve(baseDir, fileRaw);
          abs = baseAbs;
          if (!(abs === projDir || abs.startsWith(projDir + path.sep))) {
            abs = path.resolve(projDir, fileRaw);
          }
        }
        if (!(abs === projDir || abs.startsWith(projDir + path.sep))) return null;
        const rel = path.relative(projDir, abs).replaceAll("\\\\", "/");
        return { file: rel, line, column };
      }

      const inputLine = text.split(/\r?\n/).find((l) => l.startsWith("Input:"));
      if (!inputLine) return null;
      const fileRaw = inputLine.replace(/^Input:/, "").trim();
      const lineMatch = text.match(/Line:\s*([0-9]+)/);
      const colMatch = text.match(/Column:\s*([-0-9]+)/);
      const line = lineMatch ? Number(lineMatch[1]) : 1;
      const column = colMatch ? Math.max(1, Number(colMatch[1]) || 1) : 1;
      let abs = "";
      if (path.isAbsolute(fileRaw)) {
        if (process.env.COMPILE_DOCKER === "1" && fileRaw.startsWith("/work/")) {
          abs = path.resolve(projDir, path.relative("/work", fileRaw));
        } else {
          abs = fileRaw;
        }
      } else {
        const baseAbs = path.resolve(baseDir, fileRaw);
        abs = baseAbs;
        if (!(abs === projDir || abs.startsWith(projDir + path.sep))) {
          abs = path.resolve(projDir, fileRaw);
        }
      }
      if (!(abs === projDir || abs.startsWith(projDir + path.sep))) return null;
      const rel = path.relative(projDir, abs).replaceAll("\\\\", "/");
      return { file: rel, line, column };
    };

    try {
      const first = await runEdit(x, y);
      const parsed = parseOutput(`${first.out}\n${first.err}`);
      if (parsed) return res.json(parsed);
      if (Number.isFinite(pageHeight) && pageHeight > 0) {
        const flipped = await runEdit(x, Math.max(0, pageHeight - y));
        const parsedFlip = parseOutput(`${flipped.out}\n${flipped.err}`);
        if (parsedFlip) return res.json(parsedFlip);
      }
      return jsonError(res, 404, "synctex edit not found");
    } catch (e) {
      return jsonError(res, 500, e && e.message ? e.message : String(e));
    }
  });

  app.get("/api/jobs/:id", requireAuth(session), async (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return jsonError(res, 404, "job not found");
    res.json({ job: publicJob(job) });
  });

  app.get("/api/jobs/:id/stream", requireAuth(session), async (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return jsonError(res, 404, "job not found");

    // Ensure the user can access this job's project.
    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === job.projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");

    // Initial state + full log snapshot.
    res.write(`event: init\\ndata: ${JSON.stringify(publicJob(job))}\\n\\n`);

    const unsub = subscribeJob(job.id, (evt) => {
      if (evt.type === "append") {
        res.write(`event: append\\ndata: ${JSON.stringify({ chunk: evt.chunk })}\\n\\n`);
      } else if (evt.type === "status") {
        res.write(`event: status\\ndata: ${JSON.stringify(evt.job)}\\n\\n`);
      } else if (evt.type === "done") {
        res.write(`event: done\\ndata: ${JSON.stringify(evt.job)}\\n\\n`);
      }
    });

    req.on("close", () => {
      unsub();
      try {
        res.end();
      } catch {
        // ignore
      }
    });
  });

  // Upload a locally compiled PDF (optional fast path).
  app.post("/api/projects/:id/artifacts/pdf", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const target = req.query && req.query.file ? String(req.query.file) : "";
    let mainFile = p.mainFile;
    if (target && target.trim()) {
      const rel = target.trim();
      try {
        const tAbs = resolveProjectFilePath(dataDir, projectId, rel);
        const st = await fs.stat(tAbs);
        if (st.isDirectory()) return jsonError(res, 400, "target is a directory");
        mainFile = rel;
      } catch {
        return jsonError(res, 404, "target file not found");
      }
    }
    const base = path.basename(mainFile, path.extname(mainFile));
    const outDir = path.join(projDir, "build");
    const pdfPath = path.join(outDir, `${base}.pdf`);
    const logPath = path.join(outDir, `${base}.log`);
    const synctexPath = path.join(outDir, `${base}.synctex.gz`);

    const bb = Busboy({ headers: req.headers, limits: { fileSize: 200 * 1024 * 1024 } });
    let pdfBufs = [];
    let pdfBytes = 0;
    let logBufs = [];
    let logBytes = 0;
    let synctexBufs = [];
    let synctexBytes = 0;

    bb.on("file", (fieldname, file) => {
      if (fieldname === "pdf" || fieldname === "file") {
        file.on("data", (d) => {
          pdfBytes += d.length;
          pdfBufs.push(d);
        });
        return;
      }
      if (fieldname === "log") {
        file.on("data", (d) => {
          logBytes += d.length;
          logBufs.push(d);
        });
        return;
      }
      if (fieldname === "synctex") {
        file.on("data", (d) => {
          synctexBytes += d.length;
          synctexBufs.push(d);
        });
        return;
      }
      file.resume();
    });

    bb.on("finish", async () => {
      try {
        if (!pdfBytes) return jsonError(res, 400, "missing pdf");
        await ensureDir(outDir);
        await fs.writeFile(pdfPath, Buffer.concat(pdfBufs));
        if (logBytes) await fs.writeFile(logPath, Buffer.concat(logBufs));
        if (synctexBytes) await fs.writeFile(synctexPath, Buffer.concat(synctexBufs));
        res.json({ ok: true });
      } catch (e) {
        jsonError(res, 500, e && e.message ? e.message : String(e));
      }
    });

    req.pipe(bb);
  });

  app.get("/api/projects/:id/artifacts/pdf", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const target = req.query && req.query.file ? String(req.query.file) : "";
    let mainFile = p.mainFile;
    if (target && target.trim()) {
      const rel = target.trim();
      try {
        const tAbs = resolveProjectFilePath(dataDir, projectId, rel);
        const st = await fs.stat(tAbs);
        if (st.isDirectory()) return jsonError(res, 400, "target is a directory");
        mainFile = rel;
      } catch {
        return jsonError(res, 404, "target file not found");
      }
    }
    const base = path.basename(mainFile, path.extname(mainFile));
    const pdf = path.join(projDir, "build", `${base}.pdf`);

    try {
      await fs.stat(pdf);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(pdf);
    } catch {
      jsonError(res, 404, "pdf not found (compile first)");
    }
  });

  app.get("/api/projects/:id/artifacts/status", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const target = req.query && req.query.file ? String(req.query.file) : "";
    let mainFile = p.mainFile;
    if (target && target.trim()) {
      const rel = target.trim();
      try {
        const tAbs = resolveProjectFilePath(dataDir, projectId, rel);
        const st = await fs.stat(tAbs);
        if (st.isDirectory()) return jsonError(res, 400, "target is a directory");
        mainFile = rel;
      } catch {
        return jsonError(res, 404, "target file not found");
      }
    }
    const base = path.basename(mainFile, path.extname(mainFile));
    const pdf = path.join(projDir, "build", `${base}.pdf`);
    const log = path.join(projDir, "build", `${base}.log`);

    const statOrNull = async (fp) => {
      try {
        const st = await fs.stat(fp);
        return { exists: true, size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return { exists: false };
      }
    };

    res.json({
      base,
      mainFile: p.mainFile,
      targetFile: mainFile,
      pdf: await statOrNull(pdf),
      log: await statOrNull(log),
    });
  });

  app.get("/api/projects/:id/artifacts/log", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const target = req.query && req.query.file ? String(req.query.file) : "";
    let mainFile = p.mainFile;
    if (target && target.trim()) {
      const rel = target.trim();
      try {
        const tAbs = resolveProjectFilePath(dataDir, projectId, rel);
        const st = await fs.stat(tAbs);
        if (st.isDirectory()) return jsonError(res, 400, "target is a directory");
        mainFile = rel;
      } catch {
        return jsonError(res, 404, "target file not found");
      }
    }
    const base = path.basename(mainFile, path.extname(mainFile));
    const log = path.join(projDir, "build", `${base}.log`);

    try {
      const txt = await fs.readFile(log, "utf8");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(txt);
    } catch {
      jsonError(res, 404, "log not found (compile first)");
    }
  });

  // History (per file)
  app.get("/api/projects/:id/history", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const file = req.query && req.query.file ? String(req.query.file) : "";
    const limit = req.query && req.query.limit ? Number(req.query.limit) : 50;
    if (!file) return jsonError(res, 400, "missing file");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    try {
      const entries = await listHistory({ dataDir, projectId, filePath: file, limit });
      res.setHeader("Cache-Control", "no-store");
      res.json({ entries });
    } catch (e) {
      jsonError(res, 500, e && e.message ? e.message : String(e));
    }
  });

  app.get("/api/projects/:id/history/item", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const file = req.query && req.query.file ? String(req.query.file) : "";
    const id = req.query && req.query.id ? String(req.query.id) : "";
    if (!file || !id) return jsonError(res, 400, "missing file/id");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    try {
      const text = await readHistoryItem({ dataDir, projectId, filePath: file, id });
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(text);
    } catch (e) {
      jsonError(res, 404, e && e.message ? e.message : String(e));
    }
  });

  app.post("/api/projects/:id/history/snapshot", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const file = (req.body || {}).file;
    const content = (req.body || {}).content;
    if (!file) return jsonError(res, 400, "missing file");

    const db = await loadProjects(dataDir);
    const p = db.projects.find((x) => x.id === projectId);
    if (!p) return jsonError(res, 404, "project not found");
    if (!canAccessProject(p, req.user.username)) return jsonError(res, 403, "forbidden");

    try {
      // Ensure path is valid but do not overwrite the file here.
      const abs = resolveProjectFilePath(dataDir, projectId, file);
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else {
        // Fallback for huge files: read from disk to avoid large uploads.
        text = await fs.readFile(abs, "utf8");
      }
      const entry = await recordHistory({
        dataDir,
        projectId,
        filePath: String(file),
        user: req.user.username,
        content: text,
      });
      res.json({ ok: true, entry: entry || null });
    } catch (e) {
      jsonError(res, 500, e && e.message ? e.message : String(e));
    }
  });

  // Frontend
  const publicDir = path.resolve(new URL("../public", import.meta.url).pathname);
  const staticNoStore = (res, filePath) => {
    if (/\.(html|js|css|map|mjs)$/i.test(filePath)) setNoStoreHeaders(res);
  };
  app.use(express.static(publicDir, {
    index: false,
    etag: false,
    lastModified: false,
    setHeaders: staticNoStore,
  }));
  app.get("*", async (_req, res) => {
    setNoStoreHeaders(res);
    res.sendFile(path.join(publicDir, "index.html"));
  });

  // Collab server
  const collab = createCollabServer({ dataDir, session, host: WS_HOST });
  await collab.listen(WS_PORT);

  app.listen(WEB_PORT, WEB_HOST, () => {
    const webHostLabel = WEB_HOST === "0.0.0.0" ? "127.0.0.1" : WEB_HOST;
    const wsHostLabel = WS_HOST === "0.0.0.0" ? "127.0.0.1" : WS_HOST;
    console.log(`CollabTeX web: http://${webHostLabel}:${WEB_PORT}`);
    console.log(`CollabTeX ws:  ws://${wsHostLabel}:${WS_PORT}`);
    console.log(
      `Default users: admin, user01..user09 (INIT_PASSWORD=${process.env.INIT_PASSWORD || "ChangeMe!2026"})`
    );
    console.log(`Data dir: ${dataDir}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
