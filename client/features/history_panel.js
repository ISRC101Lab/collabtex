export function renderHistoryPanel(deps) {
  const {
    h,
    app,
    t,
    btn,
    loadHistory,
    viewHistoryItem,
    compareHistoryItem,
    restoreHistoryItem,
    formatBytes,
  } = deps;
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
