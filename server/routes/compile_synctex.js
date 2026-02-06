import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

export function registerCompileSynctexRoutes(deps) {
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
    startCompile,
    getCompileOverview,
    repairSymlinkPlaceholders,
    readHead,
    hasLatexPreamble,
    pickBestMainFile,
  } = deps;
  const synctexTimeoutMs = Math.max(350, Number(process.env.SYNCTEX_TIMEOUT_MS || 1200));
  const runSynctex = (args, cwd) =>
    new Promise((resolve, reject) => {
      const child = spawn("synctex", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore kill errors
        }
      }, synctexTimeoutMs);
      child.stdout.on("data", (d) => {
        stdout += d.toString("utf8");
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString("utf8");
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({
            code: 124,
            out: stdout,
            err: `${stderr}\n[synctex timeout ${synctexTimeoutMs}ms]`,
          });
          return;
        }
        resolve({ code, out: stdout, err: stderr });
      });
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
    const fast = !!body.fast;
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
    const maxRange = fast ? 0 : Math.max(2, Math.min(30, Number(process.env.SYNC_FALLBACK_RANGE || 8)));
    const fileCandidates = fast ? sourceCandidates.slice(0, 2) : sourceCandidates;

    const runView = async (ln, fileArg) => {
      const args = ["view", "-i", `${ln}:${Math.max(1, column)}:${fileArg}`, "-o", pdf];
      return await runSynctex(args, projDir);
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
      for (const fileArg of fileCandidates) {
        let attemptLine = line;
        let result = null;
        let output = "";
        const first = await runView(attemptLine, fileArg);
        output = `${first.out}\n${first.err}`;
        result = parseView(output);

        if (!result && maxRange > 0) {
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
      return await runSynctex(args, projDir);
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


}
