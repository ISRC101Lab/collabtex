import path from "node:path";
import fs from "node:fs/promises";
import archiver from "archiver";

export function registerProjectsCoreRoutes(deps) {
  const {
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
    setUsersDb,
    normalizeTags,
    TEMPLATE_CATALOG,
    applyTemplate,
    sanitizeZipName,
    ensureDir,
    remapPathPrefix,
  } = deps;

  app.get("/api/projects", requireAuth(session), async (req, res) => {
    const db = await loadProjects(dataDir);
    const projects = db.projects.filter((project) => canAccessProject(project, req.user.username));
    res.json({ projects });
  });

  app.get("/api/templates", requireAuth(session), async (_req, res) => {
    const templates = TEMPLATE_CATALOG.map((item) => ({ id: item.id, name: item.name, mainFile: item.mainFile }));
    res.json({ templates });
  });

  app.post("/api/projects", requireAuth(session), async (req, res) => {
    const body = req.body || {};
    const name = body.name;
    const templateId = body.template || "blank";
    const tpl = TEMPLATE_CATALOG.find((item) => item.id === templateId) || TEMPLATE_CATALOG[0];
    const mainFile = (tpl && tpl.mainFile) || body.mainFile || "main.tex";
    const project = await createProject(dataDir, { owner: req.user.username, name, mainFile });
    if (templateId && templateId !== "blank") {
      const projDir = projectPath(dataDir, project.id);
      await applyTemplate(templateId, projDir);
    }
    res.json({ project });
  });

  app.post("/api/projects/:id/share", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const username = (req.body || {}).username;
    if (!username) return jsonError(res, 400, "missing username");

    const latestUsers = await loadUsers(dataDir);
    setUsersDb(latestUsers);
    if (!findUser(latestUsers, username)) return jsonError(res, 404, "user not found");

    const db = await loadProjects(dataDir);
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) return jsonError(res, 404, "project not found");
    if (project.owner !== req.user.username && !req.user.isAdmin) return jsonError(res, 403, "forbidden");

    project.collaborators = Array.from(new Set([...(project.collaborators || []), username]));
    project.updatedAt = new Date().toISOString();
    await saveProjects(dataDir, db);
    res.json({ ok: true });
  });

  app.post("/api/projects/:id/meta", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const body = req.body || {};
    const db = await loadProjects(dataDir);
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) return jsonError(res, 404, "project not found");
    if (project.owner !== req.user.username && !req.user.isAdmin) return jsonError(res, 403, "forbidden");

    if (typeof body.name === "string" && body.name.trim()) {
      project.name = body.name.trim();
    }
    if (typeof body.category === "string") {
      project.category = body.category.trim();
    }
    if (typeof body.tags !== "undefined") {
      project.tags = normalizeTags(body.tags);
    }
    project.updatedAt = new Date().toISOString();
    await saveProjects(dataDir, db);
    res.json({ ok: true, project });
  });

  app.delete("/api/projects/:id", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const idx = db.projects.findIndex((item) => item.id === projectId);
    if (idx === -1) return jsonError(res, 404, "project not found");
    const project = db.projects[idx];
    if (project.owner !== req.user.username && !req.user.isAdmin) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const trashRoot = path.join(dataDir, "projects-trash");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const trashPath = path.join(trashRoot, `${projectId}-${stamp}`);

    db.projects.splice(idx, 1);
    await saveProjects(dataDir, db);
    res.json({ ok: true });

    const cleanupTask = async () => {
      try {
        await ensureDir(trashRoot);
        await fs.rename(projDir, trashPath);
      } catch {
        try {
          await fs.rm(projDir, { recursive: true, force: true });
        } catch (e) {
          console.error("[projects] async delete cleanup failed", {
            projectId,
            error: e && e.message ? e.message : String(e),
          });
        }
      }
    };
    cleanupTask().catch((e) => {
      console.error("[projects] async delete task failed", {
        projectId,
        error: e && e.message ? e.message : String(e),
      });
    });
  });

  app.get("/api/projects/:id/tree", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) return jsonError(res, 404, "project not found");
    if (!canAccessProject(project, req.user.username)) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const forceClean = String(req.query && req.query.cleanup ? req.query.cleanup : "") === "1";
    await cleanupProject(projDir, project.mainFile, { force: forceClean });
    const tree = await listProjectTree(projDir);
    res.json({ tree, mainFile: project.mainFile, compiler: project.compiler || "pdflatex" });
  });

  app.get("/api/projects/:id/export.zip", requireAuth(session), async (req, res) => {
    const projectId = req.params.id;
    const db = await loadProjects(dataDir);
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) return jsonError(res, 404, "project not found");
    if (!canAccessProject(project, req.user.username)) return jsonError(res, 403, "forbidden");

    const projDir = projectPath(dataDir, projectId);
    const files = await listProjectTree(projDir);
    const zipName = `${sanitizeZipName(project.name || `project-${projectId.slice(0, 8)}`)}.zip`;

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
}
