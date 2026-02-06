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
import { registerAuthSystemRoutes } from "./routes/auth_system.js";
import { registerProjectsCoreRoutes } from "./routes/projects_core.js";
import { registerProjectFileOpsRoutes } from "./routes/project_file_ops.js";
import { registerCompileSynctexRoutes } from "./routes/compile_synctex.js";
import { registerJobsArtifactsHistoryRoutes } from "./routes/jobs_artifacts_history.js";

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

  registerAuthSystemRoutes({
    app,
    dataDir,
    session,
    jsonError,
    loadUsers,
    authenticate,
    signSession,
    setSessionCookie,
    clearSessionCookie,
    getSessionFromReq,
    getTokenFromReq,
    setUsersDb: (nextUsersDb) => {
      usersDb = nextUsersDb;
    },
  });

  registerProjectsCoreRoutes({
    app,
    session,
    requireAuth,
    dataDir,
    jsonError,
    loadProjects,
    saveProjects,
    createProject,
    canAccessProject,
    projectPath,
    listProjectTree,
    cleanupProject,
    resolveProjectFilePath,
    loadUsers,
    findUser,
    setUsersDb: (nextUsersDb) => {
      usersDb = nextUsersDb;
    },
    normalizeTags,
    TEMPLATE_CATALOG,
    applyTemplate,
    sanitizeZipName,
    ensureDir,
    remapPathPrefix,
  });

  registerProjectFileOpsRoutes({
    app,
    session,
    requireAuth,
    dataDir,
    jsonError,
    loadProjects,
    saveProjects,
    canAccessProject,
    projectPath,
    listProjectTree,
    resolveProjectFilePath,
    ensureDir,
    remapPathPrefix,
    fileExists,
    DEFAULT_MAIN_TEMPLATE,
    repairSymlinkPlaceholders,
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

  registerCompileSynctexRoutes({
    app,
    session,
    requireAuth,
    dataDir,
    jsonError,
    loadProjects,
    saveProjects,
    canAccessProject,
    projectPath,
    listProjectTree,
    resolveProjectFilePath,
    startCompile,
    getCompileOverview,
    repairSymlinkPlaceholders,
    readHead,
    hasLatexPreamble,
    pickBestMainFile,
  });

  registerJobsArtifactsHistoryRoutes({
    app,
    session,
    requireAuth,
    dataDir,
    jsonError,
    loadProjects,
    canAccessProject,
    projectPath,
    resolveProjectFilePath,
    ensureDir,
    getJob,
    subscribeJob,
    publicJob,
    listHistory,
    readHistoryItem,
    recordHistory,
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
