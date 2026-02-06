export function renderRecentFilesPanel(deps) {
  const {
    app,
    h,
    t,
    fileBaseName,
    openFile,
  } = deps;

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

export function renderPinnedFilesPanel(deps) {
  const {
    app,
    h,
    t,
    btn,
    fileBaseName,
    openFile,
    togglePinnedFile,
  } = deps;

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
    const next = renderPinnedFilesPanel(deps);
    if (!next) {
      wrap.remove();
      return;
    }
    wrap.replaceWith(next);
  };
  return wrap;
}
