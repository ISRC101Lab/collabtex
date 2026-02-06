import { safeStorage as localStorage } from "../utils/storage.js";

export function renderFileTreePanel(deps) {
  const {
    app,
    h,
    t,
    isFocusFile,
    isAssetFile,
    STYLE_EXTS,
    buildTree,
    sortedChildren,
    isFolderPlaceholder,
    toggleDropdown,
    iconSvg,
    dropdownMenu,
    btn,
    api,
    FOLDER_PLACEHOLDER,
    loadProject,
    cleanupEditor,
    clearDropdowns,
    mount,
    render,
    remapPathList,
    remapPathSet,
    remapPathPrefix,
    filterPathList,
    filterPathSet,
    setOpenFiles,
    setPinnedFiles,
    lastOpenFileKey,
    openFile,
    isPathUnderPrefix,
    toggleFileSelection,
    setEditorError,
  } = deps;
  const container = h("div", { class: "filetree", id: "fileTree" });

  const draw = () => {
    const frag = document.createDocumentFragment();
    const filter = app.ui.fileFilter.trim().toLowerCase();
    const baseList = app.current.tree || [];
    const viewList = app.ui.fileView === "all" ? baseList : baseList.filter((p) => isFocusFile(p));
    const list = filter ? viewList.filter((p) => p.toLowerCase().includes(filter)) : viewList;
    if (list.length === 0) {
      const emptyWrap = h("div", { class: "filetree-empty" });
      const filtered = !!filter;
      const inFocusView = app.ui.fileView !== "all";
      let emptyText = t("(无匹配文件)");
      if (filtered) emptyText = t("无匹配文件，请清空筛选。");
      else if (inFocusView && viewList.length === 0) emptyText = t("暂无文稿文件");
      emptyWrap.appendChild(h("div", { class: "hint", html: emptyText }));

      if (filtered) {
        emptyWrap.appendChild(btn(t("清空筛选"), {
          kind: "tiny",
          onClick: (ev) => {
            ev.stopPropagation();
            app.ui.fileFilter = "";
            const inputEl = document.getElementById("leftSearchInput");
            if (inputEl) inputEl.value = "";
            draw();
          },
        }));
      }

      if (inFocusView) {
        emptyWrap.appendChild(btn(t("查看全部文件"), {
          kind: "tiny",
          onClick: (ev) => {
            ev.stopPropagation();
            app.ui.fileView = "all";
            draw();
          },
        }));
      }

      frag.appendChild(emptyWrap);
      container.replaceChildren(frag);
      return;
    }
    const getExt = (p) => {
      const lower = String(p || "").toLowerCase();
      const idx = lower.lastIndexOf(".");
      return idx === -1 ? "" : lower.slice(idx);
    };
    const groupDefs = [
      { key: "tex", label: t("TeX 文稿"), order: 1, match: (p) => getExt(p) === ".tex" },
      { key: "fig", label: t("图片/图表"), order: 2, match: (p) => isAssetFile(p) },
      { key: "bib", label: t("参考文献"), order: 3, match: (p) => getExt(p) === ".bib" },
      { key: "style", label: t("样式文件"), order: 4, match: (p) => STYLE_EXTS.has(getExt(p)) },
      { key: "other", label: t("其他"), order: 5, match: (_p) => true },
    ];

    const buildGroupedTree = (paths) => {
      const buckets = new Map();
      for (const def of groupDefs) buckets.set(def.key, []);
      for (const p of paths) {
        const def = groupDefs.find((d) => d.match(p)) || groupDefs[groupDefs.length - 1];
        buckets.get(def.key).push(p);
      }
      const root = { type: "dir", name: "", path: "", children: new Map() };
      for (const def of groupDefs) {
        const items = buckets.get(def.key) || [];
        if (!items.length) continue;
        const groupTree = buildTree(items);
        const node = {
          type: "dir",
          name: def.label,
          path: `@group/${def.key}`,
          group: true,
          order: def.order,
          children: groupTree.children,
        };
        root.children.set(def.key, node);
      }
      return root;
    };

    const tree = app.ui.fileView === "all" ? buildTree(list) : buildGroupedTree(list);
    const countCache = new Map();
    const countFiles = (node) => {
      if (!node) return 0;
      if (node.type === "file") return isFolderPlaceholder(node.path || node.name) ? 0 : 1;
      if (countCache.has(node)) return countCache.get(node);
      let total = 0;
      for (const child of node.children.values()) total += countFiles(child);
      countCache.set(node, total);
      return total;
    };

    const renderNode = (node, prefix, depth) => {
      for (const child of sortedChildren(node)) {
        const full = child.path || (prefix ? `${prefix}/${child.name}` : child.name);
        const rowStyle = `--indent:${Math.max(0, depth)}`;

        if (child.type === "dir") {
          const isGroup = !!child.group;
          const open =
            filter ? true : app.ui.openFolders.has(full) || (isGroup && !app.ui.groupTreeInit && !app.ui.openFolders.has(full));
          const toggleDir = () => {
            if (app.ui.openFolders.has(full)) app.ui.openFolders.delete(full);
            else app.ui.openFolders.add(full);
            draw();
          };
          const fileCount = countFiles(child);
          const countEl = fileCount > 0 ? h("span", { class: "tree-count", html: String(fileCount) }) : null;
          const actions = !isGroup
            ? (() => {
                const menuId = `tree:${encodeURIComponent(full)}`;
                const menuBtn = h("button", {
                  class: "tree-menu-btn",
                  title: t("操作"),
                  onclick: (ev) => toggleDropdown(menuId, ev),
                });
                menuBtn.appendChild(iconSvg("more", { size: 12 }));
                const menu = dropdownMenu(
                  menuId,
                  h("div", { class: "dropdown-panel tree-action-panel" }, [
                    btn(t("新文件夹"), {
                      kind: "menu-item",
                      onClick: async (ev) => {
                        ev.stopPropagation();
                        const rel = prompt(t("文件夹路径"), full ? `${full}/assets` : "assets");
                        const clean = String(rel || "").trim().replace(/\/+$/, "");
                        if (!clean) return;
                        await api(`/api/projects/${app.current.project.id}/file`, {
                          method: "POST",
                          body: JSON.stringify({ path: `${clean}/${FOLDER_PLACEHOLDER}`, content: "" }),
                        });
                        await loadProject(app.current.project.id);
                        cleanupEditor();
                        clearDropdowns();
                        mount(render());
                      },
                    }),
                    btn(t("重命名"), {
                      kind: "menu-item",
                      onClick: async (ev) => {
                        ev.stopPropagation();
                        const np = prompt(t("重命名为"), full);
                        if (!np || np === full) return;
                        const projectId = app.current.project && app.current.project.id;
                        const nextOpenFiles = remapPathList(app.ui.openFiles, full, np);
                        const nextSelected = remapPathSet(app.ui.selectedFiles, full, np);
                        const nextPinned = remapPathList(app.ui.pinnedFiles, full, np);
                        const nextOpenFile = app.current.openFile ? remapPathPrefix(app.current.openFile, full, np) : null;
                        await api(`/api/projects/${app.current.project.id}/rename`, {
                          method: "POST",
                          body: JSON.stringify({ oldPath: full, newPath: np }),
                        });
                        if (projectId) {
                          setOpenFiles(nextOpenFiles);
                          setPinnedFiles(nextPinned);
                          if (nextOpenFile) localStorage.setItem(lastOpenFileKey(projectId), nextOpenFile);
                        }
                        await loadProject(app.current.project.id);
                        app.ui.selectedFiles = nextSelected;
                        const filtered = nextOpenFiles.filter((p) => app.current.tree.includes(p));
                        if (filtered.length) setOpenFiles(filtered);
                        clearDropdowns();
                        if (nextOpenFile && app.current.tree.includes(nextOpenFile)) {
                          await openFile(nextOpenFile);
                          return;
                        }
                        cleanupEditor();
                        mount(render());
                      },
                    }),
                    btn(t("删除"), {
                      kind: "menu-item danger",
                      onClick: async (ev) => {
                        ev.stopPropagation();
                        if (!confirm(t("确认删除 {name} ?", { name: full }))) return;
                        const projectId = app.current.project && app.current.project.id;
                        const nextOpenFiles = filterPathList(app.ui.openFiles, full);
                        const nextSelected = filterPathSet(app.ui.selectedFiles, full);
                        const nextPinned = filterPathList(app.ui.pinnedFiles, full);
                        const wasOpen = app.current.openFile && isPathUnderPrefix(app.current.openFile, full);
                        await api(`/api/projects/${app.current.project.id}/file`, {
                          method: "DELETE",
                          body: JSON.stringify({ path: full }),
                        });
                        if (projectId) {
                          setOpenFiles(nextOpenFiles);
                          setPinnedFiles(nextPinned);
                          const last = localStorage.getItem(lastOpenFileKey(projectId)) || "";
                          if (last && isPathUnderPrefix(last, full)) localStorage.removeItem(lastOpenFileKey(projectId));
                        }
                        await loadProject(app.current.project.id);
                        app.ui.selectedFiles = nextSelected;
                        if (nextOpenFiles.length) {
                          const filtered = nextOpenFiles.filter((p) => app.current.tree.includes(p));
                          if (filtered.length) setOpenFiles(filtered);
                        }
                        clearDropdowns();
                        if (wasOpen) {
                          app.current.openFile = null;
                          cleanupEditor();
                          mount(render());
                          return;
                        }
                        cleanupEditor();
                        mount(render());
                      },
                    }),
                  ])
                );
                return h(
                  "div",
                  { class: "dropdown dropdown-right tree-action-wrap", "data-dropdown-id": menuId },
                  [menuBtn, menu]
                );
              })()
            : null;
          const metaChildren = [];
          if (countEl) metaChildren.push(countEl);
          if (actions) metaChildren.push(actions);
          const meta = metaChildren.length ? h("div", { class: "tree-meta" }, metaChildren) : null;
          const row = h(
            "div",
            { class: `tree-row dir ${isGroup ? "group" : ""}`.trim(), style: rowStyle, onclick: toggleDir, title: full },
            [
            h("button", {
              class: `tree-toggle ${open ? "open" : ""}`.trim(),
              title: open ? t("收起") : t("展开"),
              html: "",
              onclick: (ev) => {
                ev.stopPropagation();
                toggleDir();
              },
            }),
            h("div", { class: "tree-text" }, [
              h("button", {
                class: "tree-filebtn tree-dirname",
                html: child.name,
                title: full,
                onclick: (ev) => {
                  ev.stopPropagation();
                  toggleDir();
                },
              }),
            ]),
            meta,
          ]);
          frag.appendChild(row);
          if (open) renderNode(child, full, depth + 1);
          continue;
        }

          if (isFolderPlaceholder(full)) continue;
          const active = full === app.current.openFile;
          const multi = !!app.ui.fileMultiSelect;
          const selected = multi && app.ui.selectedFiles && app.ui.selectedFiles.has(full);
          const pinned = Array.isArray(app.ui.pinnedFiles) && app.ui.pinnedFiles.includes(full);
          const ext = child.name.includes(".") ? child.name.split(".").pop() : "";
          const extLower = String(ext || "").toLowerCase();
          const extLabel = ext ? ext.slice(0, 4).toUpperCase() : "FILE";
          const nameBtn = h("button", {
            class: "tree-filebtn",
            html: child.name,
            title: full,
            onclick: async (ev) => {
              ev.stopPropagation();
              try {
                await openFile(full);
              } catch (err) {
                const message = err && err.message ? err.message : String(err);
                if (setEditorError) setEditorError(message);
              }
            },
          });
          const badgeEls = [];
          if (full === app.current.mainFile) {
            badgeEls.push(h("span", { class: "tree-badge", html: t("主") }));
          }
          if (pinned) {
            badgeEls.push(h("span", { class: "tree-pin-ind", html: "PIN", title: t("置顶") }));
          }
          const nameRow = h("div", { class: "tree-name-row" }, [nameBtn, ...badgeEls]);
          const textChildren = [nameRow];
          const slashIdx = full.lastIndexOf("/");
          if (slashIdx > 0) {
            const sub = full.slice(0, slashIdx);
            if (sub) textChildren.push(h("div", { class: "tree-subpath", html: sub, title: sub }));
          }

          const menuId = `tree:${encodeURIComponent(full)}`;
          const menuBtn = h("button", {
            class: "tree-menu-btn",
            title: t("操作"),
            onclick: (ev) => toggleDropdown(menuId, ev),
          });
          menuBtn.appendChild(iconSvg("more", { size: 12 }));
          const fileMenu = dropdownMenu(
            menuId,
            h("div", { class: "dropdown-panel tree-action-panel" }, [
              btn(pinned ? t("取消置顶") : t("置顶"), {
                kind: "menu-item",
                onClick: async (ev) => {
                  ev.stopPropagation();
                  togglePinnedFile(full);
                  clearDropdowns();
                },
              }),
              btn(t("重命名"), {
                kind: "menu-item",
                onClick: async (ev) => {
                  ev.stopPropagation();
                  const np = prompt(t("重命名为"), full);
                  if (!np || np === full) return;
                  const wasOpen = app.current.openFile === full;
                  const nextPinned = remapPathList(app.ui.pinnedFiles, full, np);
                  await api(`/api/projects/${app.current.project.id}/rename`, {
                    method: "POST",
                    body: JSON.stringify({ oldPath: full, newPath: np }),
                  });
                  await loadProject(app.current.project.id);
                  if (wasOpen) app.current.openFile = np;
                  setOpenFiles(app.ui.openFiles.map((p) => (p === full ? np : p)));
                  setPinnedFiles(nextPinned);
                  clearDropdowns();
                  if (wasOpen) {
                    await openFile(np);
                    return;
                  }
                  cleanupEditor();
                  mount(render());
                },
              }),
              btn(t("删除"), {
                kind: "menu-item danger",
                onClick: async (ev) => {
                  ev.stopPropagation();
                  if (!confirm(t("确认删除 {name} ?", { name: full }))) return;
                  await api(`/api/projects/${app.current.project.id}/file`, {
                    method: "DELETE",
                    body: JSON.stringify({ path: full }),
                  });
                  if (app.current.openFile === full) {
                    app.current.openFile = null;
                    cleanupEditor();
                  }
                  setOpenFiles(app.ui.openFiles.filter((p) => p !== full));
                  setPinnedFiles(app.ui.pinnedFiles.filter((p) => p !== full));
                  await loadProject(app.current.project.id);
                  clearDropdowns();
                  cleanupEditor();
                  mount(render());
                },
              }),
            ])
          );
          const actionWrap = h(
            "div",
            { class: "dropdown dropdown-right tree-action-wrap", "data-dropdown-id": menuId },
            [menuBtn, fileMenu]
          );
          const row = h(
            "div",
            {
              class: `tree-row file ${active ? "active" : ""} ${multi ? "multi" : ""} ${selected ? "selected" : ""} ${
                pinned ? "pinned" : ""
              }`.trim(),
              style: rowStyle,
              onclick: (ev) => {
                if (multi) {
                  if (
                    ev.target.closest(".tree-filebtn") ||
                    ev.target.closest(".tree-actions") ||
                    ev.target.closest(".tree-check")
                  ) {
                    return;
                  }
                  toggleFileSelection(full);
                  return;
                }
                openFile(full).catch((err) => {
                  const message = err && err.message ? err.message : String(err);
                  if (setEditorError) setEditorError(message);
                });
              },
          },
          [
            ...(multi
              ? [
                  h("input", {
                    class: "tree-check",
                    type: "checkbox",
                    checked: selected,
                    onclick: (ev) => {
                      ev.stopPropagation();
                      toggleFileSelection(full);
                    },
                  }),
                ]
              : []),
            h("span", { class: "tree-icon", "data-ext": extLabel, "data-kind": extLower }),
            h("div", { class: "tree-text" }, textChildren),
            actionWrap,
          ]
        );
        frag.appendChild(row);
      }
    };

    renderNode(tree, "", 0);
    container.replaceChildren(frag);
    if (app.ui.fileView !== "all" && !app.ui.groupTreeInit) {
      app.ui.groupTreeInit = true;
    }
  };

  let drawScheduled = false;
  const scheduleDraw = () => {
    if (drawScheduled) return;
    drawScheduled = true;
    const run = () => {
      drawScheduled = false;
      draw();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 0);
  };

  draw();
  app.ui.refreshFileTree = scheduleDraw;
  return container;
}
