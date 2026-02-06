import path from "node:path";
import fs from "node:fs/promises";
import Busboy from "busboy";

export function registerProjectFileOpsRoutes(deps) {
  const {
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
  } = deps;

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
}
