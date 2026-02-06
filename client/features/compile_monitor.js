export function buildCompileMonitorBody(deps) {
  const {
    app,
    t,
    h,
    formatMb,
    formatDuration,
    compileStatusLabel,
    sectionTitle,
  } = deps;

  const jobRuntime = (job) => {
    const now = Date.now();
    if (job.status === "running" && job.startedAt) {
      return formatDuration(now - Date.parse(job.startedAt));
    }
    if (job.status === "queued" && job.requestedAt) {
      return formatDuration(now - Date.parse(job.requestedAt));
    }
    if (Number.isFinite(job.durationMs)) return formatDuration(job.durationMs);
    return "-";
  };

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
      metric(
        t("负载"),
        sys.loadavg && sys.loadavg.length ? sys.loadavg.slice(0, 3).map((n) => n.toFixed(2)).join(" ") : "-",
        t("运行时长") + ` ${formatDuration((sys.uptimeSec || 0) * 1000)}`
      ),
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
