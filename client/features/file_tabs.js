export function renderFileTabsView(deps) {
  const {
    h,
    app,
    t,
    openFile,
    closeTab,
  } = deps;

  const container = h("div", { class: "file-tabs" });

  const draw = () => {
    container.innerHTML = "";
    const list = Array.isArray(app.ui.openFiles) ? app.ui.openFiles : [];
    if (list.length === 0) {
      container.appendChild(h("div", { class: "hint", html: t("打开文件开始编辑。") }));
      return;
    }
    for (const fp of list) {
      const active = fp === app.current.openFile;
      const name = fp.split("/").pop() || fp;
      const tab = h("div", { class: `file-tab ${active ? "active" : ""}`.trim() });
      const tabBtn = h("button", {
        class: "file-tab-btn",
        title: fp,
        onclick: () => {
          if (fp === app.current.openFile) return;
          openFile(fp).catch(console.error);
        },
      });
      tabBtn.textContent = name;
      const closeBtn = h("button", {
        class: "file-tab-close",
        title: t("关闭"),
        onclick: (ev) => {
          ev.stopPropagation();
          closeTab(fp);
        },
      });
      closeBtn.textContent = "x";
      tab.appendChild(tabBtn);
      tab.appendChild(closeBtn);
      container.appendChild(tab);
    }
  };

  draw();
  app.ui.refreshFileTabs = draw;
  return container;
}
