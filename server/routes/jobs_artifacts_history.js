import path from "node:path";
import fs from "node:fs/promises";
import Busboy from "busboy";

export function registerJobsArtifactsHistoryRoutes(deps) {
  const {
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
  } = deps;

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
}
