import { safeStorage as localStorage } from "../utils/storage.js";

export function renderProjectPage(deps) {
  const {
    api,
    app,
    FOLDER_PLACEHOLDER,
    appendBottomTerminal,
    applySplitVars,
    btn,
    buildDiagnosticSummary,
    cleanupEditor,
    clearBottomTerminal,
    clearDropdowns,
    closeModal,
    compileProject,
    computeLayoutClass,
    dropdownMenu,
    enterGuestMode,
    fileBaseName,
    formatPdfPageInfo,
    getPdfTargetFile,
    h,
    handlePdfScroll,
    iconSvg,
    input,
    isFolderPlaceholder,
    loadProject,
    loadProjects,
    mount,
    openFile,
    openFileAt,
    pdfScrollRef,
    pdfUrl,
    pickDefaultOpenFile,
    placePdfMarker,
    pulsePdfMarker,
    render,
    renderFileTree,
    renderLoading,
    renderPdfPages,
    renderPinnedFiles,
    schedulePdfSync,
    setBottomConsole,
    setBottomMode,
    setEditorFontSize,
    setEditorLineHeight,
    setEditorPaddingX,
    setEditorPaddingY,
    setLayoutMode,
    setPdfTargetFile,
    setPdfView,
    setTheme,
    setTreeDensity,
    setWsUrlOverride,
    showModal,
    startBottomDrag,
    startDrag,
    stopMonitorPolling,
    t,
    toggleDropdown,
    toggleLeftPane,
    updateBottomConsoleMode,
    zoomStep,
  } = deps;
  const p = app.current.project;
  if (!p || !p.id) return renderLoading();
  const me = app.me || { username: "", isAdmin: false };
  applySplitVars();
  const isOwnerOrAdmin = me.isAdmin || p.owner === me.username;

  const goProjects = async () => {
    cleanupEditor();
    stopMonitorPolling();
    app.ui.selectRightTab = null;
    app.current.project = null;
    app.current.openFile = null;
    app.ui.openFiles = [];
    app.ui.fileFilter = "";
    app.view = "projects";
    app.ui.dropdownOpen = "";
    app.ui.projectRenameId = "";
    app.ui.projectDeleteArmed = "";
    if (location.hash !== "#projects") location.hash = "#projects";
    try {
      await loadProjects();
    } catch (e) {
      console.error(e);
    }
    mount(render());
  };

  const doLogout = async () => {
    try { await api("/api/logout", { method: "POST" }); } catch {}
    localStorage.removeItem("ct_session_token");
    cleanupEditor();
    stopMonitorPolling();
    app.ui.selectRightTab = null;
    app.ui.openFiles = [];
    app.ui.fileFilter = "";
    enterGuestMode();
    await loadProjects();
    mount(render());
  };

  const exportProjectZip = () => {
    if (!app.current.project) return;
    const token = localStorage.getItem("ct_session_token") || "";
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    const baseName = String(app.current.project.name || `project-${app.current.project.id.slice(0, 8)}`)
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_");
    const name = baseName || "collabtex-project";
    const url = `/api/projects/${app.current.project.id}/export.zip${qs}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };


  const uploadFile = async (file, targetPath) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("path", targetPath);
    fd.append("file", file);
    await api(`/api/projects/${p.id}/upload`, { method: "POST", body: fd });
  };

  const uploadInput = h("input", {
    id: "uploadInput",
    type: "file",
    style: "display:none",
    onchange: async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const target = prompt(t("上传到路径"), file.name);
      if (!target) return;
      await uploadFile(file, target);
      ev.target.value = "";
      await loadProject(p.id);
      cleanupEditor();
      mount(render());
    },
  });

  const uploadDirInput = h("input", {
    id: "uploadDirInput",
    type: "file",
    style: "display:none",
    multiple: "",
    webkitdirectory: "",
    directory: "",
    onchange: async (ev) => {
      const files = Array.from(ev.target.files || []);
      if (!files.length) return;
      const baseTarget = prompt(t("上传到文件夹 (可选)"), "");
      if (baseTarget === null) {
        ev.target.value = "";
        return;
      }
      const base = String(baseTarget || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
      for (const file of files) {
        const rel = String(file.webkitRelativePath || file.name || "").replace(/^\/+/, "");
        if (!rel) continue;
        const target = base ? `${base}/${rel}` : rel;
        await uploadFile(file, target);
      }
      ev.target.value = "";
      await loadProject(p.id);
      cleanupEditor();
      mount(render());
    },
  });

  let filterTimer = null;
  const filterInput = h("input", {
    id: "leftSearchInput",
    class: "left-search-input",
    placeholder: t("筛选文件..."),
    value: app.ui.fileFilter,
    oninput: (ev) => {
      app.ui.fileFilter = ev.target.value;
      if (filterTimer) clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        filterTimer = null;
        if (app.ui.refreshFileTree) app.ui.refreshFileTree();
      }, 120);
    },
  });
  const onDrop = async (ev) => {
    ev.preventDefault();
    ev.currentTarget.classList.remove("drop-ready");
    const files = Array.from(ev.dataTransfer && ev.dataTransfer.files ? ev.dataTransfer.files : []);
    if (files.length === 0) return;

    if (files.length === 1) {
      const target = prompt(t("上传到路径"), files[0].name);
      if (!target) return;
      await uploadFile(files[0], target);
    } else {
      const base = prompt(t("上传到文件夹 (可选)"), "");
      if (base === null) return;
      const prefix = base.trim().replace(/\/+$/, "");
      for (const file of files) {
        const target = prefix ? `${prefix}/${file.name}` : file.name;
        await uploadFile(file, target);
      }
    }

    await loadProject(p.id);
    cleanupEditor();
    mount(render());
  };

  if (app.ui.leftRailMode !== "files") app.ui.leftRailMode = "files";
  if (app.ui.leftPaneTab !== "files") app.ui.leftPaneTab = "files";

  const texFiles = Array.isArray(app.current.tree) ? app.current.tree.filter((f) => f.endsWith(".tex")) : [];
  const mainSelect = h("select", { class: "input", id: "mainSelect" }, []);
  for (const f of texFiles) {
    const opt = h("option", { value: f, selected: f === app.current.mainFile ? "" : null, html: f });
    mainSelect.appendChild(opt);
  }
  mainSelect.disabled = !isOwnerOrAdmin;

  const compilerSelect = h("select", { class: "input", id: "compilerSelect" }, [
    h("option", { value: "pdflatex", selected: app.current.compiler === "pdflatex" ? "" : null, html: "pdfLaTeX" }),
    h("option", { value: "xelatex", selected: app.current.compiler === "xelatex" ? "" : null, html: "XeLaTeX" }),
    h("option", { value: "lualatex", selected: app.current.compiler === "lualatex" ? "" : null, html: "LuaLaTeX" }),
  ]);
  compilerSelect.disabled = !isOwnerOrAdmin;

  const targetFiles = texFiles.slice();
  if (app.ui.pdfTargetFile && !targetFiles.includes(app.ui.pdfTargetFile)) targetFiles.unshift(app.ui.pdfTargetFile);
  if (!targetFiles.length && app.current.mainFile) targetFiles.push(app.current.mainFile);
  const pdfTargetSelect = h("select", {
    class: "input pdf-target",
    id: "pdfTargetSelect",
    onchange: (ev) => setPdfTargetFile(ev.target.value),
  });
  for (const f of targetFiles) {
    const opt = h("option", { value: f, selected: f === getPdfTargetFile(p.id) ? "" : null, html: f });
    pdfTargetSelect.appendChild(opt);
  }

  const pdfZoomSelect = h(
    "select",
    {
      class: "input pdf-zoom",
      id: "pdfZoomSelect",
      onchange: (ev) => setPdfView({ projectId: p.id, zoom: ev.target.value }),
    },
    [
      h("option", { value: "page-width", html: t("适合宽度"), selected: app.ui.pdfZoom === "page-width" ? "" : null }),
      h("option", { value: "page-fit", html: t("适合页面"), selected: app.ui.pdfZoom === "page-fit" ? "" : null }),
      h("option", { value: "100", html: "100%", selected: app.ui.pdfZoom === "100" ? "" : null }),
      h("option", { value: "125", html: "125%", selected: app.ui.pdfZoom === "125" ? "" : null }),
      h("option", { value: "150", html: "150%", selected: app.ui.pdfZoom === "150" ? "" : null }),
      h("option", { value: "200", html: "200%", selected: app.ui.pdfZoom === "200" ? "" : null }),
    ]
  );

  const hasPdf = !!(app.current.artifacts && app.current.artifacts.pdf && app.current.artifacts.pdf.exists);
  const openPdfMenuBtn = btn(t("打开 PDF"), {
    kind: "menu-item",
    disabled: !hasPdf,
    onClick: (ev) => {
      ev.stopPropagation();
      window.open(pdfUrl(p.id, Date.now(), app.ui.pdfPage, app.ui.pdfZoom, getPdfTargetFile(p.id)), "_blank");
      clearDropdowns();
    },
  });

  const refreshPdfMenuBtn = btn(t("刷新预览"), {
    kind: "menu-item",
    onClick: (ev) => {
      ev.stopPropagation();
      setPdfView({ projectId: p.id, refresh: true });
      clearDropdowns();
    },
  });

  const applyMainBtn = btn(t("设置"), {
    kind: "tiny",
    disabled: !isOwnerOrAdmin,
    onClick: async (ev) => {
      ev.stopPropagation();
      if (!mainSelect.value) return;
      await api(`/api/projects/${p.id}/main`, {
        method: "POST",
        body: JSON.stringify({ mainFile: mainSelect.value }),
      });
      await loadProject(p.id);
      cleanupEditor();
      mount(render());
    },
  });

  const applyCompilerBtn = btn(t("设置"), {
    kind: "tiny",
    disabled: !isOwnerOrAdmin,
    onClick: async (ev) => {
      ev.stopPropagation();
      await api(`/api/projects/${p.id}/compiler`, {
        method: "POST",
        body: JSON.stringify({ compiler: compilerSelect.value }),
      });
      await loadProject(p.id);
      cleanupEditor();
      mount(render());
    },
  });

  const autoCompileToggle = h("label", { class: "toggle" }, [
    h("input", {
      type: "checkbox",
      checked: app.ui.autoCompile,
      onchange: (ev) => {
        app.ui.autoCompile = ev.target.checked;
        localStorage.setItem("ct_autoCompile", app.ui.autoCompile ? "1" : "0");
      },
    }),
    h("span", { html: t("自动编译") }),
  ]);

  const autoSyncToggle = h("label", { class: "toggle" }, [
    h("input", {
      type: "checkbox",
      checked: app.ui.autoSyncPdf,
      onchange: (ev) => {
        app.ui.autoSyncPdf = ev.target.checked;
        localStorage.setItem("ct_autoSyncPdf", app.ui.autoSyncPdf ? "1" : "0");
        if (app.ui.autoSyncPdf) schedulePdfSync();
      },
    }),
    h("span", { html: t("自动同步 PDF") }),
  ]);

  const openCompileLogs = () => {
    const nowTab = app.ui.rightTab || "pdf";
    const toLogs = nowTab !== "logs";
    if (toLogs) {
      if (app.ui.layoutMode === "editor") setLayoutMode("balanced");
      if (app.ui.selectRightTab) app.ui.selectRightTab("logs");
      else app.ui.rightTab = "logs";
      setBottomMode("log");
      return;
    }
    if (app.ui.selectRightTab) app.ui.selectRightTab("pdf");
    else app.ui.rightTab = "pdf";
  };


  const settingsMenu = dropdownMenu("panel-settings", h("div", { class: "dropdown-panel settings-panel" }, [
    h("div", { class: "label", html: t("预览文件") }),
    pdfTargetSelect,
    h("div", { class: "label", html: t("缩放") }),
    pdfZoomSelect,
    h("div", { class: "menu-sep" }),
    h("div", { class: "label", html: t("主文件") }),
    h("div", { class: "row" }, [mainSelect, applyMainBtn]),
    h("div", { class: "label", html: t("编译器") }),
    h("div", { class: "row" }, [compilerSelect, applyCompilerBtn]),
    h("div", { class: "settings-toggles" }, [autoCompileToggle, autoSyncToggle]),
    h("div", { class: "menu-sep" }),
    openPdfMenuBtn,
    refreshPdfMenuBtn,
  ]));

  const settingsBtn = h("button", {
    class: "left-icon-btn left-settings-btn dropdown-trigger",
    title: t("设置"),
    onclick: (ev) => {
      toggleDropdown("panel-settings", ev);
    },
  });
  settingsBtn.appendChild(iconSvg("settings", { size: 14 }));
  const settingsWrap = h(
    "div",
    { class: "dropdown dropdown-left", "data-dropdown-id": "panel-settings" },
    [settingsBtn, settingsMenu]
  );

  const recentFilesEl = null;
  const pinnedFilesEl = renderPinnedFiles();

  const brandBtn = h("button", {
    class: "project-title-btn brand-title-btn",
    title: t("返回项目列表"),
    onclick: () => goProjects(),
    html: p.name || "CollabTeX",
  });
  const leftTitleWrap = h("div", { class: "left-title-wrap" }, [brandBtn]);
  const shareInput = input({ placeholder: t("分享给 (如 user01)") });
  const shareMenu = dropdownMenu("share", h("div", { class: "dropdown-panel share-panel" }, [
    h("div", { class: "label", html: t("分享给") }),
    shareInput,
    btn(t("分享"), {
      kind: "primary",
      onClick: async (ev) => {
        ev.stopPropagation();
        const username = shareInput.value.trim();
        if (!username) return;
        await api(`/api/projects/${p.id}/share`, {
          method: "POST",
          body: JSON.stringify({ username }),
        });
        shareInput.value = "";
        clearDropdowns();
      },
    }),
  ]));
  const shareBtn = h("button", { class: "share-btn dropdown-trigger", onclick: (ev) => toggleDropdown("share", ev), html: t("分享") });
  const shareWrap = h("div", { class: "dropdown dropdown-right", "data-dropdown-id": "share" }, [shareBtn, shareMenu]);

  const createFileByPrompt = async (defaultPath = "main.tex") => {
    const rel = prompt(t("新文件路径"), defaultPath);
    if (!rel) return;
    await api(`/api/projects/${p.id}/file`, {
      method: "POST",
      body: JSON.stringify({ path: rel, content: "" }),
    });
    await loadProject(p.id);
    cleanupEditor();
    mount(render());
  };

  const createFolderByPrompt = async (defaultPath = "assets") => {
    const rel = prompt(t("文件夹路径"), defaultPath);
    const clean = String(rel || "").trim().replace(/\/+$/, "");
    if (!clean) return;
    const placeholder = FOLDER_PLACEHOLDER || ".ct-folder";
    await api(`/api/projects/${p.id}/file`, {
      method: "POST",
      body: JSON.stringify({ path: `${clean}/${placeholder}`, content: "" }),
    });
    await loadProject(p.id);
    cleanupEditor();
    mount(render());
  };

  const searchBtn = h("button", {
    class: `left-icon-btn ${app.ui.leftSearchOpen ? "active" : ""}`.trim(),
    title: t("搜索"),
    onclick: () => {
      app.ui.leftSearchOpen = !app.ui.leftSearchOpen;
      if (!app.ui.leftSearchOpen) app.ui.fileFilter = "";
      mount(render());
      if (app.ui.leftSearchOpen) {
        setTimeout(() => {
          const el = document.getElementById("leftSearchInput");
          if (el) el.focus();
        }, 0);
      }
    },
  });
  searchBtn.appendChild(iconSvg("search", { size: 14 }));

  const addMenu = dropdownMenu(
    "left-add-actions",
    h("div", { class: "dropdown-panel left-add-panel" }, [
      btn(t("添加文件"), {
        kind: "menu-item",
        onClick: async (ev) => {
          ev.stopPropagation();
          await createFileByPrompt("main.tex");
          clearDropdowns();
        },
      }),
      btn(t("添加文件夹"), {
        kind: "menu-item",
        onClick: async (ev) => {
          ev.stopPropagation();
          await createFolderByPrompt("assets");
          clearDropdowns();
        },
      }),
      btn(t("上传文件"), {
        kind: "menu-item",
        onClick: (ev) => {
          ev.stopPropagation();
          clearDropdowns();
          uploadInput.click();
        },
      }),
      btn(t("上传目录"), {
        kind: "menu-item",
        onClick: (ev) => {
          ev.stopPropagation();
          clearDropdowns();
          uploadDirInput.click();
        },
      }),
      btn(t("导出项目"), {
        kind: "menu-item",
        onClick: (ev) => {
          ev.stopPropagation();
          clearDropdowns();
          exportProjectZip();
        },
      }),
      h("div", { class: "left-add-note", html: t("正在连接 Zotero...") }),
    ])
  );
  const addBtn = h("button", {
    class: "left-icon-btn dropdown-trigger",
    title: t("添加"),
    onclick: (ev) => toggleDropdown("left-add-actions", ev),
  });
  addBtn.appendChild(iconSvg("plus", { size: 15 }));
  const addWrap = h("div", { class: "dropdown dropdown-right", "data-dropdown-id": "left-add-actions" }, [addBtn, addMenu]);

  const toolsRow = app.ui.leftSearchOpen
    ? h("div", { class: "left-search-row" }, [filterInput])
    : null;
  const filesTabBtn = h("button", {
    class: `left-tab ${app.ui.fileView === "all" ? "active" : ""}`.trim(),
    html: t("文件"),
    onclick: () => setFileView("all"),
  });
  const focusTabBtn = h("button", {
    class: `left-tab ${app.ui.fileView === "focus" ? "active" : ""}`.trim(),
    html: "Chats",
    onclick: () => setFileView("focus"),
  });
  const tabsRow = h("div", { class: "left-tabs left-tabs-rich" }, [
    h("div", { class: "left-tabs-main" }, [filesTabBtn, focusTabBtn]),
    h("div", { class: "left-tabs-actions" }, [searchBtn, addWrap]),
  ]);
  const headerActions = h("div", { class: "left-header-actions" }, [shareWrap, settingsWrap]);
  const headerChildren = [
    h("div", { class: "left-header-top" }, [leftTitleWrap, headerActions]),
    tabsRow,
    ...(toolsRow ? [toolsRow] : []),
  ];

  const leftHeader = h("div", { class: "left-pane-header" }, headerChildren);

  const leftBody = h("div", { class: "left-pane-body" }, []);
  leftBody.appendChild(renderFileTree());

  const left = h(
    "div",
    {
      class: "pane left",
      ondragover: (ev) => {
        ev.preventDefault();
        ev.currentTarget.classList.add("drop-ready");
      },
      ondragleave: (ev) => {
        ev.currentTarget.classList.remove("drop-ready");
      },
      ondrop: onDrop,
    },
    [leftHeader, uploadInput, uploadDirInput, leftBody]
  );

  const editorToolbar = h("div", { class: "editor-toolbar minimal", id: "editorToolbar" }, []);

  const bottomLog = h("pre", { class: "bottom-log", id: "bottomLog" });
  bottomLog.textContent = app.ui.bottomMode === "log" ? app.current.lastLog || "" : app.ui.bottomTerminalLog || "";
  const termBtn = btn(t("终端"), { kind: "tiny", onClick: () => setBottomMode("terminal"), id: "bottomModeTerm" });
  const logBtn = btn(t("日志"), { kind: "tiny", onClick: () => setBottomMode("log"), id: "bottomModeLog" });
  if (app.ui.bottomMode === "terminal") termBtn.classList.add("active");
  if (app.ui.bottomMode === "log") logBtn.classList.add("active");
  const clearBtn = btn(t("清空"), {
    kind: "tiny",
    onClick: () => {
      if (app.ui.bottomMode === "terminal") clearBottomTerminal();
      else {
        app.current.lastLog = "";
        const logEl = document.getElementById("compileLog");
        if (logEl) logEl.textContent = "";
        updateBottomConsoleMode();
      }
    },
  });
  const bottomHeader = h("div", { class: "bottom-header" }, [
    h("div", { class: "bottom-title", html: t("控制台") }),
    h("div", { class: "bottom-actions" }, [termBtn, logBtn, clearBtn, btn(t("关闭"), { kind: "tiny", onClick: () => setBottomConsole(false) })]),
  ]);
  const bottomInput = h("input", {
    class: "input bottom-input",
    placeholder: t("输入命令，回车执行"),
  });
  bottomInput.autocomplete = "off";
  const runBottomCommand = async (raw) => {
    const cmd = String(raw || "").trim();
    if (!cmd) return;
    appendBottomTerminal(`> ${cmd}`);
    app.ui.bottomHistory = app.ui.bottomHistory || [];
    app.ui.bottomHistory.push(cmd);
    if (app.ui.bottomHistory.length > 50) app.ui.bottomHistory = app.ui.bottomHistory.slice(-50);
    app.ui.bottomHistoryIndex = app.ui.bottomHistory.length;
    const parts = cmd.split(/\s+/);
    const head = parts.shift().toLowerCase();
    const rest = parts.join(" ");
    if (head === "help") {
      appendBottomTerminal(
        "commands: help, compile, quick, clean, open <file>, reveal, mode <terminal|log>, clear, ls"
      );
      return;
    }
    if (head === "mode") {
      if (parts[0] === "log") setBottomMode("log");
      else setBottomMode("terminal");
      return;
    }
    if (head === "clear") {
      clearBottomTerminal();
      return;
    }
    if (head === "ls") {
      const files = (app.current.tree || []).filter((p) => !isFolderPlaceholder(p));
      const slice = files.slice(0, 40);
      appendBottomTerminal(slice.join("\n"));
      if (files.length > slice.length) appendBottomTerminal(`... +${files.length - slice.length}`);
      return;
    }
    if (head === "open") {
      if (!rest) {
        appendBottomTerminal("usage: open <file>");
        return;
      }
      openFile(rest).catch((e) => appendBottomTerminal(e && e.message ? e.message : String(e)));
      return;
    }
    if (head === "reveal") {
      revealActiveFile();
      return;
    }
    if (head === "compile" || head === "build") {
      compileProject({ mode: "full", origin: "manual" }).catch((e) =>
        appendBottomTerminal(e && e.message ? e.message : String(e))
      );
      return;
    }
    if (head === "quick") {
      compileProject({ mode: "quick", origin: "manual" }).catch((e) =>
        appendBottomTerminal(e && e.message ? e.message : String(e))
      );
      return;
    }
    if (head === "clean") {
      compileProject({ mode: "full", clean: true, origin: "manual" }).catch((e) =>
        appendBottomTerminal(e && e.message ? e.message : String(e))
      );
      return;
    }
    appendBottomTerminal(`unknown command: ${head}`);
  };
  bottomInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      const v = bottomInput.value;
      bottomInput.value = "";
      runBottomCommand(v);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      const idx = app.ui.bottomHistoryIndex ?? app.ui.bottomHistory.length;
      const next = Math.max(0, idx - 1);
      app.ui.bottomHistoryIndex = next;
      bottomInput.value = app.ui.bottomHistory[next] || "";
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      const idx = app.ui.bottomHistoryIndex ?? app.ui.bottomHistory.length;
      const next = Math.min(app.ui.bottomHistory.length, idx + 1);
      app.ui.bottomHistoryIndex = next;
      bottomInput.value = app.ui.bottomHistory[next] || "";
    }
  });
  const runBtn = btn(t("执行"), {
    kind: "tiny",
    onClick: () => {
      const v = bottomInput.value;
      bottomInput.value = "";
      runBottomCommand(v);
    },
  });
  const bottomInputRow = h("div", { class: "bottom-input-row" }, [
    h("span", { class: "bottom-prompt", html: "&gt;" }),
    bottomInput,
    runBtn,
  ]);
  const bottomConsole = h(
    "div",
    { class: "bottom-console", id: "bottomConsole", style: app.ui.bottomConsole ? "" : "display:none" },
    [bottomHeader, bottomInputRow, bottomLog]
  );
  const bottomGutter = h("div", {
    class: "bottom-gutter",
    id: "bottomGutter",
    style: app.ui.bottomConsole ? "" : "display:none",
    onmousedown: (ev) => startBottomDrag(ev),
  });
  const bottomCollapsed = h(
    "div",
    {
      class: "bottom-collapsed",
      id: "bottomCollapsed",
      style: app.ui.bottomConsole ? "display:none" : "",
      onclick: () => setBottomConsole(true),
    },
    [
      h("div", { class: "bottom-collapsed-title", html: t("控制台") }),
      h("div", { class: "bottom-collapsed-hint", html: t("点击展开控制台") }),
    ]
  );

  const toolsBtn = h(
    "button",
    {
      class: "editor-tools-btn",
      title: t("编译日志"),
      onclick: (ev) => {
        ev.stopPropagation();
        openCompileLogs();
      },
    },
    [
      iconSvg("list", { size: 13 }),
      h("span", { class: "editor-tools-label", html: t("工具") }),
    ]
  );

  const editorHeader = h("div", { class: "pane-header editor-pane-header" }, [
    h("div", { class: "editor-header-left" }, [
      h("div", {
        class: "pane-title editor-file-pill",
        id: "editorTitle",
        title: app.current.openFile || "",
        html: app.current.openFile ? fileBaseName(app.current.openFile) : t("编辑器"),
      }),
    ]),
    h("div", { class: "editor-header-right" }, [
      toolsBtn,
    ]),
  ]);

  const editor = h("div", { class: "pane editor-pane" }, [
    editorHeader,
    editorToolbar,
    h("div", { class: "editor", id: "editorHost" }),
    h("div", { class: "editor-status", id: "editorStatus" }, [
      h("span", { class: "hint", html: t("打开文件开始编辑。") }),
    ]),
  ]);

  const themeSelect = h(
    "select",
    {
      class: "input",
      onchange: (ev) => {
        setTheme(ev.target.value);
      },
    },
    [
      h("option", { value: "default", html: t("默认"), selected: app.ui.theme === "default" ? "" : null }),
      h("option", { value: "vscode-dark", html: t("VSCode 深色"), selected: app.ui.theme === "vscode-dark" ? "" : null }),
      h("option", { value: "vscode-light", html: t("VSCode 浅色"), selected: app.ui.theme === "vscode-light" ? "" : null }),
    ]
  );

  const fontSizeInput = input({ type: "number", value: String(app.ui.editorFontSize) });
  fontSizeInput.classList.add("compact");
  fontSizeInput.setAttribute("min", "11");
  fontSizeInput.setAttribute("max", "22");
  fontSizeInput.setAttribute("step", "0.5");
  fontSizeInput.onchange = (ev) => setEditorFontSize(ev.target.value);

  const lineHeightInput = input({ type: "number", value: String(app.ui.editorLineHeight) });
  lineHeightInput.classList.add("compact");
  lineHeightInput.setAttribute("min", "1.2");
  lineHeightInput.setAttribute("max", "2.4");
  lineHeightInput.setAttribute("step", "0.05");
  lineHeightInput.onchange = (ev) => setEditorLineHeight(ev.target.value);

  const padYInput = input({ type: "number", value: String(app.ui.editorPadY) });
  padYInput.classList.add("compact");
  padYInput.setAttribute("min", "8");
  padYInput.setAttribute("max", "32");
  padYInput.setAttribute("step", "1");
  padYInput.onchange = (ev) => setEditorPaddingY(ev.target.value);

  const padXInput = input({ type: "number", value: String(app.ui.editorPadX) });
  padXInput.classList.add("compact");
  padXInput.setAttribute("min", "8");
  padXInput.setAttribute("max", "32");
  padXInput.setAttribute("step", "1");
  padXInput.onchange = (ev) => setEditorPaddingX(ev.target.value);

  const treeDensitySelect = h(
    "select",
    {
      class: "input",
      onchange: (ev) => setTreeDensity(ev.target.value),
    },
    [
      h("option", { value: "comfortable", html: t("舒适"), selected: app.ui.treeDensity !== "compact" ? "" : null }),
      h("option", { value: "compact", html: t("紧凑"), selected: app.ui.treeDensity === "compact" ? "" : null }),
    ]
  );
  treeDensitySelect.classList.add("compact");

  const compileBtn = btn("", { kind: "", onClick: () => compileProject({ mode: "full" }), id: "compileBtn" });
  compileBtn.title = t("编译 (Ctrl/Cmd+S)");
  compileBtn.classList.add("compile-btn");
  const compileIcon = iconSvg("compile", { size: 14, className: "compile-icon" });
  const compileLabel = h("span", { class: "compile-label", html: t("编译") });
  compileBtn.appendChild(compileIcon);
  compileBtn.appendChild(compileLabel);

  const wsInput = h("input", {
    class: "input",
    placeholder: t("WebSocket 地址 (可选)"),
    value: app.ui.wsUrlOverride || "",
    oninput: (ev) => setWsUrlOverride(ev.target.value),
  });
  const wsClearBtn = btn(t("清除"), {
    kind: "tiny",
    onClick: () => {
      wsInput.value = "";
      setWsUrlOverride("");
    },
  });
  const wsPortGuess = (() => {
    const u = new URL(location.href);
    const param = u.searchParams.get("wsPort");
    if (param) return param;
    if (app.ui.wsUrlOverride) {
      try {
        const parsed = new URL(app.ui.wsUrlOverride);
        if (parsed.port) return parsed.port;
      } catch {
        // ignore parse errors
      }
    }
    const basePort = Number(location.port);
    if (Number.isFinite(basePort) && basePort > 0) return String(basePort + 1);
    return "";
  })();
  const wsPortInput = h("input", {
    class: "input",
    placeholder: t("WS 端口"),
    value: wsPortGuess,
    oninput: (ev) => {
      const v = ev.target.value.replace(/[^\d]/g, "");
      if (v !== ev.target.value) ev.target.value = v;
    },
  });
  const wsPortApplyBtn = btn(t("应用"), {
    kind: "tiny",
    onClick: () => {
      const port = wsPortInput.value.trim();
      if (!port) return;
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const url = `${scheme}://${location.hostname}:${port}`;
      setWsUrlOverride(url);
      wsInput.value = url;
    },
  });

  const pdfHint = h("div", {
    class: "hint",
    id: "pdfHint",
    html: hasPdf ? "" : t("暂无 PDF，请点击编译生成。"),
    style: hasPdf ? "display:none" : null,
  });

  const pdfPages = h("div", { class: "pdf-pages", id: "pdfPages" });
  const pdfMarker = h("div", { class: "pdf-marker", id: "pdfMarker" });
  const pdfViewer = h("div", { class: "pdf-viewer", id: "pdfViewer" }, [pdfPages, pdfMarker, pdfHint]);
  pdfViewer.ondblclick = async (ev) => {
    if (!app.current.project) return;
    const target = ev.target;
    let canvas = target && target.closest ? target.closest("canvas.pdf-canvas") : null;
    if (!canvas && target && target.closest) {
      const wrap = target.closest(".pdf-page-wrap");
      if (wrap) canvas = wrap.querySelector("canvas.pdf-canvas");
    }
    if (!canvas) return;
    const page = Number(canvas.getAttribute("data-page") || canvas.dataset.page || app.ui.pdfPage || 1);
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xCss = ev.clientX - rect.left;
    const yCss = ev.clientY - rect.top;
    if (xCss < 0 || yCss < 0 || xCss > rect.width || yCss > rect.height) return;
    const scale = app.ui.pdfScale || 1;
    const x = xCss / scale;
    const y = yCss / scale;
    const pageHeight = app.ui.pdfPageHeights ? app.ui.pdfPageHeights[page] : null;
    app.ui.pdfPage = page;
    const pageInput = document.getElementById("pdfPageInput");
    if (pageInput) pageInput.value = String(page).padStart(2, "0");
    app.ui.pdfMarker = { page, x, y };
    app.ui.pdfMarkerFocus = false;
    app.ui.pdfMarkerPulse = true;
    placePdfMarker();
    pulsePdfMarker();
    try {
      const res = await api(`/api/projects/${p.id}/synctex/edit`, {
        method: "POST",
        body: JSON.stringify({
          page,
          x,
          y,
          pageHeight,
          target: getPdfTargetFile(p.id),
        }),
      });
      if (res && res.file && res.line) {
        await openFileAt(res.file, res.line, { skipPdfSync: true });
      }
    } catch {
      // ignore failed click mapping
    }
  };
  pdfViewer.addEventListener(
    "wheel",
    (ev) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      if (ev.deltaY < 0) zoomStep(1);
      else zoomStep(-1);
    },
    { passive: false }
  );
  pdfViewer.addEventListener("scroll", () => {
    if (pdfScrollRef.current) cancelAnimationFrame(pdfScrollRef.current);
    pdfScrollRef.current = requestAnimationFrame(() => {
      pdfScrollRef.current = null;
      handlePdfScroll();
    });
  });
  if (hasPdf) {
    const shouldRefresh = !app.ui.pdfDoc;
    if (shouldRefresh) app.ui.pdfTs = Date.now();
    setTimeout(() => {
      renderPdfPages({ projectId: p.id, refresh: shouldRefresh }).catch(() => {});
    }, 0);
  }
  const pageInput = h("input", {
    class: "input pdf-page pdf-page-current",
    id: "pdfPageInput",
    value: String(app.ui.pdfPage || 1).padStart(2, "0"),
    onchange: (ev) => setPdfView({ projectId: p.id, page: ev.target.value }),
    oninput: (ev) => {
      const digits = String(ev.target.value || "").replace(/\D+/g, "").slice(0, 4);
      if (digits !== ev.target.value) ev.target.value = digits;
    },
    onfocus: (ev) => {
      ev.currentTarget.select();
    },
    onblur: (ev) => {
      if (!String(ev.target.value || "").trim()) {
        ev.target.value = String(app.ui.pdfPage || 1).padStart(2, "0");
      }
    },
  });
  pageInput.setAttribute("inputmode", "numeric");
  pageInput.setAttribute("min", "1");

  const pageInfo = h("div", {
    class: "pdf-page-info",
    id: "pdfPageInfo",
    html: formatPdfPageInfo(app.ui.pdfPage || 1, app.ui.pdfPageCount || 1),
  });

  const hasPdfNow = () => !!(app.current.artifacts && app.current.artifacts.pdf && app.current.artifacts.pdf.exists);

  const openPdfInNewWindow = () => {
    if (!hasPdfNow()) return;
    window.open(pdfUrl(p.id, Date.now(), app.ui.pdfPage, app.ui.pdfZoom, getPdfTargetFile(p.id)), "_blank");
  };

  const pdfOpenBtn = h("button", {
    class: "pdf-tool-btn",
    id: "openPdfBtn",
    title: t("打开 PDF"),
    disabled: !hasPdf ? "" : null,
    onclick: (ev) => {
      ev.stopPropagation();
      openPdfInNewWindow();
    },
  });
  pdfOpenBtn.appendChild(iconSvg("download", { size: 14 }));

  const togglePdfFullscreen = async () => {
    const target = document.getElementById("tab_pdf") || document.getElementById("rightPane");
    if (!target) return;
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (target.requestFullscreen) {
        await target.requestFullscreen();
      }
    } catch {
      // ignore fullscreen failures
    }
  };

  const pdfMoreItem = ({ id = null, label, shortcut = "", disabled = false, onClick }) => {
    const cls = `pdf-more-item ${disabled ? "disabled" : ""}`.trim();
    return h("button", {
      class: cls,
      id,
      type: "button",
      "aria-disabled": disabled ? "true" : "false",
      onclick: (ev) => {
        ev.stopPropagation();
        if (ev.currentTarget.getAttribute("aria-disabled") === "true") return;
        if (typeof onClick === "function") onClick();
        clearDropdowns();
      },
    }, [
      h("span", { class: "pdf-more-item-label", html: label }),
      shortcut ? h("span", { class: "pdf-more-item-shortcut", html: shortcut }) : null,
    ]);
  };

  const pdfMoreMenu = dropdownMenu("pdf-toolbar-more", h("div", { class: "pdf-more-menu" }, [
    pdfMoreItem({
      label: t("全屏"),
      shortcut: "F11",
      onClick: () => {
        togglePdfFullscreen().catch(() => {});
      },
    }),
    pdfMoreItem({
      id: "pdfMoreOpenNewWindow",
      label: t("在新窗口中打开"),
      disabled: !hasPdf,
      onClick: () => openPdfInNewWindow(),
    }),
    pdfMoreItem({
      label: t("刷新预览"),
      onClick: () => setPdfView({ projectId: p.id, refresh: true }),
    }),
  ]));

  const syncPdfToolbarState = () => {
    const pdfExists = hasPdfNow();
    pdfOpenBtn.disabled = pdfExists ? null : "";
    const openInNew = document.getElementById("pdfMoreOpenNewWindow");
    if (openInNew) {
      openInNew.classList.toggle("disabled", !pdfExists);
      openInNew.setAttribute("aria-disabled", pdfExists ? "false" : "true");
    }
  };

  const pdfMoreBtn = h("button", {
    class: "pdf-tool-btn dropdown-trigger pdf-more-btn",
    title: t("更多"),
    onclick: (ev) => {
      syncPdfToolbarState();
      toggleDropdown("pdf-toolbar-more", ev);
    },
  });
  pdfMoreBtn.appendChild(iconSvg("more", { size: 14 }));

  const pdfMoreWrap = h(
    "div",
    { class: "dropdown dropdown-right pdf-more-wrap", "data-dropdown-id": "pdf-toolbar-more" },
    [pdfMoreBtn, pdfMoreMenu]
  );

  const pageCluster = h("div", { class: "pdf-page-cluster" }, [pageInput, pageInfo]);
  syncPdfToolbarState();

  const pdfToolbar = h("div", { class: "pdf-toolbar" }, [
    h("div", { class: "pdf-toolbar-left" }, [compileBtn]),
    h("div", { class: "pdf-toolbar-center" }, [pageCluster]),
    h("div", { class: "pdf-toolbar-right" }, [pdfZoomSelect, pdfOpenBtn, pdfMoreWrap]),
  ]);

  const logDiv = h("div", { class: "log", id: "compileLog" });
  logDiv.textContent = app.current.lastLog || "";

  const logHeader = h("div", { class: "log-header" }, [
    h("div", { class: "log-group" }, [
      h("div", { class: "log-title", html: t("编译") }),
    ]),
  ]);

  const summaryText = buildDiagnosticSummary();
  const summaryTextEl = h("pre", { class: "summary-text", id: "compileSummaryText" });
  summaryTextEl.textContent = summaryText || "";
  const summaryBox = h(
    "div",
    { class: "log-summary", id: "compileSummaryBox", style: summaryText ? "" : "display:none" },
    [h("div", { class: "summary-title", html: t("诊断摘要") }), summaryTextEl]
  );

  const pdfPane = h("div", { class: "pdf-pane" }, [pdfToolbar, pdfViewer]);
  const tabPages = {
    pdf: h("div", { class: "tab-page pdf-page", id: "tab_pdf" }, [pdfPane]),
    logs: h("div", { class: "tab-page log-page", id: "tab_logs" }, [logHeader, summaryBox, logDiv]),
  };

  const selectTab = (nextKey = app.ui.rightTab || "pdf") => {
    let key = String(nextKey || "pdf");
    if (!tabPages[key]) key = key === "problems" ? "logs" : "pdf";
    app.ui.rightTab = key;
    localStorage.setItem("ct_rightTab", key);
    for (const [k, el] of Object.entries(tabPages)) el.style.display = k === key ? "" : "none";
    stopMonitorPolling();
  };
  app.ui.selectRightTab = selectTab;
  selectTab(app.ui.rightTab || "pdf");

  const right = h("div", { class: "pane right-pane", id: "rightPane" }, [
    h("div", { class: "tab-body" }, Object.values(tabPages)),
  ]);

  const queueOpenFile = (target, attempt = 0) => {
    if (!target) return;
    const delay = attempt === 0 ? 0 : Math.min(600, 120 + attempt * 90);
    setTimeout(() => {
      if (!app.current.project || app.current.project.id !== p.id) return;
      openFile(target)
        .then(() => {
          if (app.ui.pendingOpenFile === target) app.ui.pendingOpenFile = null;
        })
        .catch((err) => {
          console.error(err);
          if (attempt >= 6) {
            const statusEl = document.getElementById("editorStatus");
            if (statusEl) statusEl.textContent = t("文件打开失败，请重试。");
            return;
          }
          queueOpenFile(target, attempt + 1);
        });
    }, delay);
  };

  const preferredInitialFile =
    app.ui.pendingOpenFile ||
    (app.current.mainFile && app.current.tree.includes(app.current.mainFile)
      ? app.current.mainFile
      : pickDefaultOpenFile(app.current.tree, app.current.mainFile)) ||
    app.current.mainFile ||
    (Array.isArray(app.current.tree) && app.current.tree.length ? app.current.tree[0] : "");

  const targetToOpen =
    app.ui.pendingOpenFile ||
    app.ui.openingFile ||
    (!app.current.openFile ? preferredInitialFile : null) ||
    (app.current.openFile && !app.editor.view ? app.current.openFile : null);

  const hasEditorHost = !!document.getElementById("editorHost");

  if (targetToOpen) {
    if (app.ui.pendingOpenFile === targetToOpen) app.ui.pendingOpenFile = null;
    if (hasEditorHost) {
      queueOpenFile(targetToOpen, 0);
    } else {
      setTimeout(() => {
        if (!app.current.project || app.current.project.id !== p.id) return;
        if (document.getElementById("editorHost")) queueOpenFile(targetToOpen, 1);
      }, 0);
    }
  }

  if (hasEditorHost && app.current.openFile && !app.editor.view) {
    setTimeout(() => {
      if (!app.current.project || app.current.project.id !== p.id) return;
      if (!app.editor.view && app.current.openFile) queueOpenFile(app.current.openFile, 1);
    }, 180);
  }

  const layout = h("div", { class: computeLayoutClass(), id: "layoutRoot" }, [
    left,
    h("div", { class: "gutter gutter-left", onmousedown: (ev) => startDrag("left", ev) }),
    editor,
    h("div", { class: "gutter gutter-right", onmousedown: (ev) => startDrag("right", ev) }),
    right,
  ]);

  const shell = h("div", { class: "studio-shell" }, [
    h("div", { class: "studio-main" }, [layout]),
  ]);

  const sidebarRestoreBtn = h("button", {
    id: "sidebarRestoreBtn",
    class: `sidebar-fan-toggle ${app.ui.leftCollapsed ? "is-collapsed" : "is-expanded"}`.trim(),
    title: app.ui.leftCollapsed ? t("显示文件树") : t("隐藏文件树"),
    onclick: () => toggleLeftPane(),
  }, [
    iconSvg("back", { size: 15, className: "sidebar-fan-icon" }),
  ]);

  return h("div", { class: "page studio-page" }, [shell, sidebarRestoreBtn]);
}
