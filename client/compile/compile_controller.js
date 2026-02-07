export async function compileProjectController({ clean = false, mode = "full", origin = "manual" } = {}, deps) {
  const {
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
  } = deps;
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
  app.compile.status = "running";
  updateProblems([]);

  const projectId = app.current.project.id;
  await flushActiveFileToDisk();
  const logEl = document.getElementById("compileLog");
  const btnEl = document.getElementById("compileBtn");
  const statusEl = document.getElementById("compileStatus");
  const bottomLog = document.getElementById("bottomLog");

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

  const MAX_LOG_CHARS = 2_000_000;
  let pendingLogChunk = "";
  let logFlushTimer = null;
  let pendingStageChunk = "";
  let stageFlushTimer = null;

  const trimLogText = (txt) => {
    const text = String(txt || "");
    if (text.length <= MAX_LOG_CHARS) return text;
    return text.slice(-MAX_LOG_CHARS);
  };

  const flushStage = () => {
    stageFlushTimer = null;
    const chunk = pendingStageChunk;
    pendingStageChunk = "";
    if (!chunk) return;
    updateCompileStageFromLog(chunk);
  };

  const scheduleStageFlush = () => {
    if (stageFlushTimer) return;
    stageFlushTimer = setTimeout(flushStage, 80);
  };

  const flushLog = () => {
    logFlushTimer = null;
    const chunk = pendingLogChunk;
    pendingLogChunk = "";
    if (!chunk) return;
    if (logEl) {
      logEl.textContent = trimLogText(`${logEl.textContent || ""}${chunk}`);
      logEl.scrollTop = logEl.scrollHeight;
    }
    if (bottomLog && app.ui.bottomMode === "log") {
      bottomLog.textContent = trimLogText(`${bottomLog.textContent || ""}${chunk}`);
      bottomLog.scrollTop = bottomLog.scrollHeight;
    }
  };

  const scheduleLogFlush = () => {
    if (logFlushTimer) return;
    logFlushTimer = setTimeout(flushLog, 40);
  };

  const appendLog = (s) => {
    const chunk = String(s || "");
    if (!chunk) return;
    pendingLogChunk += chunk;
    pendingStageChunk += chunk;
    scheduleLogFlush();
    scheduleStageFlush();
  };

  const flushPendingUi = () => {
    if (logFlushTimer) {
      clearTimeout(logFlushTimer);
      logFlushTimer = null;
    }
    if (stageFlushTimer) {
      clearTimeout(stageFlushTimer);
      stageFlushTimer = null;
    }
    if (pendingLogChunk) flushLog();
    if (pendingStageChunk) flushStage();
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
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(t("编译超时(轮询)"));
  };

  if (app.ui.selectRightTab) app.ui.selectRightTab("logs");
  setBtnRunning(true);
  if (logEl) logEl.textContent = "";
  if (bottomLog && app.ui.bottomMode === "log") bottomLog.textContent = "";
  pendingLogChunk = "";
  pendingStageChunk = "";
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
    flushPendingUi();
    app.compile.inFlight = false;
    setBtnRunning(false);
    if (app.compile.pending) {
      compileProjectController({
        clean: app.compile.pendingClean,
        mode: app.compile.pendingMode,
        origin: app.compile.pendingOrigin || "manual",
      }).catch(console.error);
    }
  }
}
