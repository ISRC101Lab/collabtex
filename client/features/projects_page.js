import { safeStorage as localStorage } from "../utils/storage.js";

export function renderProjectsPage(deps) {
  const {
    input,
    app,
    t,
    mount,
    render,
    api,
    loadProjects,
    clearDropdowns,
    openProjectById,
    h,
    projectMatchesScope,
    projectMatchesFilter,
    dropdownMenu,
    buildProjectSettingsPanel,
    toggleDropdown,
    iconSvg,
    PROJECT_THUMB_URL,
    formatProjectAge,
    pickColor,
    cleanupEditor,
    enterGuestMode,
    loadMe,
    btn,
  } = deps;
  const importZip = input({ type: "file", id: "projectImportInput" });
  importZip.accept = ".zip";
  importZip.style.display = "none";
  importZip.onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (app.ui.guestMode) {
      app.ui.importError = t("请先切换用户");
      mount(render());
      ev.target.value = "";
      return;
    }
    const baseName = file.name.replace(/\.[^.]+$/, "").trim();
    const fd = new FormData();
    if (baseName) fd.append("name", baseName);
    fd.append("mainFile", "main.tex");
    fd.append("zip", file);
    app.ui.importError = "";
    try {
      const res = await api("/api/projects/import", { method: "POST", body: fd });
      await loadProjects();
      clearDropdowns();
      const created = res && res.project ? res.project : null;
      if (created && created.id) {
        await openProject(created);
      } else {
        mount(render());
      }
    } catch (e) {
      app.ui.importError = e && e.message ? e.message : String(e);
      mount(render());
    } finally {
      importZip.value = "";
    }
  };

  if (app.ui.projectCategory !== "all") {
    app.ui.projectCategory = "all";
    localStorage.setItem("ct_project_category", "all");
  }
  if (!["all", "mine", "shared"].includes(app.ui.projectScope)) {
    app.ui.projectScope = "mine";
    localStorage.setItem("ct_project_scope", "mine");
  }
  if (!["list", "grid"].includes(app.ui.projectView)) {
    app.ui.projectView = "list";
    localStorage.setItem("ct_project_view", "list");
  }

  const scopeLabel = (scope) => {
    if (scope === "all") return t("所有项目");
    if (scope === "shared") return t("与你共享");
    return t("你的项目");
  };

  const openProject = async (p) => {
    await openProjectById(p && p.id ? p.id : "", { resetTab: true, seedProject: p });
  };

  const createProject = async () => {
    if (app.ui.guestMode) {
      app.ui.importError = t("请先切换用户");
      mount(render());
      return;
    }
    try {
      const res = await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          mainFile: "main.tex",
          template: "blank",
        }),
      });
      clearDropdowns();
      const created = res && res.project ? res.project : null;
      if (created && created.id) {
        const hasProject = Array.isArray(app.projects) && app.projects.some((p) => p && p.id === created.id);
        if (!hasProject) app.projects = [created, ...(Array.isArray(app.projects) ? app.projects : [])];
        await openProject(created);
      } else {
        await loadProjects();
        mount(render());
      }
    } catch (e) {
      app.ui.importError = e && e.message ? e.message : String(e);
      mount(render());
    }
  };

  const list = h("div", { class: "project-rows", id: "projectList" });

  const drawList = () => {
    const frag = document.createDocumentFragment();
    list.classList.toggle("grid", app.ui.projectView === "grid");
    const filtered = app.projects.filter((p) =>
      projectMatchesScope(p, app.ui.projectScope, app.me) &&
      projectMatchesFilter(p, app.ui.projectFilter, app.ui.projectCategory)
    );
    if (!filtered.length) {
      const emptyLabel = app.ui.guestMode ? t("临时用户暂无项目") : t("(无匹配文件)");
      frag.appendChild(h("div", { class: "hint", html: emptyLabel }));
      list.replaceChildren(frag);
      return;
    }
    const sorted = filtered.slice().sort((a, b) => {
      const ta = Date.parse(a.updatedAt || a.createdAt || 0);
      const tb = Date.parse(b.updatedAt || b.createdAt || 0);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
    for (const p of sorted) {
      const menuId = `project:${p.id}`;
      const actionsMenu = dropdownMenu(menuId, buildProjectSettingsPanel(p, {
        onDelete: (deletedProject) => {
          const deletedId = deletedProject && deletedProject.id ? deletedProject.id : p.id;
          const list = Array.isArray(app.projects) ? app.projects : [];
          app.projects = list.filter((item) => item && item.id !== deletedId);
          drawList();
        },
      }));
      const actionsBtn = h("button", {
        class: "project-item-more",
        onclick: (ev) => toggleDropdown(menuId, ev),
      });
      actionsBtn.appendChild(iconSvg("more", { size: 14 }));
      const actionsWrap = h("div", {
        class: "dropdown dropdown-right",
        "data-dropdown-id": menuId,
        onclick: (ev) => ev.stopPropagation(),
      }, [
        actionsBtn,
        actionsMenu,
      ]);

      const row = h("div", {
        class: "project-item",
        role: "button",
        tabindex: "0",
        onclick: () => openProject(p),
        onkeydown: (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            openProject(p);
          }
        },
        title: p.name || p.id,
      }, [
        h("div", { class: "project-item-icon" }, [
          h("img", { class: "project-item-thumb", src: PROJECT_THUMB_URL, alt: "PDF" }),
        ]),
        h("div", { class: "project-item-main" }, [
          h("div", { class: "project-item-name", html: p.name || p.id }),
        h("div", {
          class: "project-item-sub",
          html: app.me && p.owner === app.me.username ? "" : (p.owner || ""),
        }),
        ]),
        h("div", { class: "project-item-actions" }, [
          h("div", { class: "project-item-time", html: formatProjectAge(p, t) }),
          actionsWrap,
        ]),
      ]);
      frag.appendChild(row);
    }
    list.replaceChildren(frag);
  };
  drawList();
  app.ui.refreshProjectList = drawList;

  const scopeButtons = {};
  const setProjectScope = (scope) => {
    app.ui.projectScope = scope;
    localStorage.setItem("ct_project_scope", scope);
    for (const [k, b] of Object.entries(scopeButtons)) b.classList.toggle("active", k === scope);
    titleEl.textContent = scopeLabel(scope);
    drawList();
  };
  const setProjectView = (view) => {
    const next = view === "grid" ? "grid" : "list";
    app.ui.projectView = next;
    localStorage.setItem("ct_project_view", next);
    syncProjectViewToggle();
    drawList();
  };

  const projectFilterInput = h("input", {
    class: "projects-search-input",
    placeholder: t("搜索项目..."),
    value: app.ui.projectFilter,
    oninput: (ev) => {
      app.ui.projectFilter = ev.target.value || "";
      localStorage.setItem("ct_project_filter", app.ui.projectFilter);
      drawList();
    },
  });

  const listBtn = h("button", {
    class: `view-toggle ${app.ui.projectView === "list" ? "active" : ""}`.trim(),
    title: t("列表视图"),
    onclick: () => setProjectView("list"),
  });
  listBtn.appendChild(iconSvg("list", { size: 14 }));
  const gridBtn = h("button", {
    class: `view-toggle ${app.ui.projectView === "grid" ? "active" : ""}`.trim(),
    title: t("网格视图"),
    onclick: () => setProjectView("grid"),
  });
  gridBtn.appendChild(iconSvg("grid", { size: 14 }));

  const syncProjectViewToggle = () => {
    const isList = app.ui.projectView === "list";
    const isGrid = app.ui.projectView === "grid";
    listBtn.classList.toggle("active", isList);
    gridBtn.classList.toggle("active", isGrid);
    listBtn.setAttribute("aria-pressed", isList ? "true" : "false");
    gridBtn.setAttribute("aria-pressed", isGrid ? "true" : "false");
  };
  syncProjectViewToggle();

  const titleEl = h("div", { class: "projects-title", html: scopeLabel(app.ui.projectScope) });

  const navItem = (scope, label) => {
    const b = h("button", {
      class: `projects-nav-item ${app.ui.projectScope === scope ? "active" : ""}`.trim(),
      onclick: () => setProjectScope(scope),
      html: label,
    });
    scopeButtons[scope] = b;
    return b;
  };

  const user = app.me || { username: "User", isAdmin: false };
  const color = pickColor(user.username || "U");
  const userCard = h("button", {
    class: "user-card dropdown-trigger",
    onclick: (ev) => toggleDropdown("user", ev),
  }, [
    h("div", { class: "user-avatar", html: (user.username || "U").charAt(0).toUpperCase() }),
    h("div", { class: "user-meta" }, [
      h("div", { class: "user-name", html: user.username || "User" }),
    ]),
    h("div", { class: "user-caret", html: "▾" }),
  ]);
  userCard.style.setProperty("--user-accent", color.color);

  const doLogout = async () => {
    try { await api("/api/logout", { method: "POST" }); } catch {}
    localStorage.removeItem("ct_session_token");
    cleanupEditor();
    app.current.openFile = null;
    app.ui.openFiles = [];
    app.ui.fileFilter = "";
    enterGuestMode();
    await loadProjects();
    mount(render());
  };

  const doSwitchUser = async (username, password) => {
    const clean = String(username || "").trim();
    const pass = String(password || "").trim();
    if (!clean || !pass) {
      app.ui.switchError = t("请输入用户名和密码");
      mount(render());
      return;
    }
    app.ui.switchError = "";
    try {
      const loginRes = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: clean, password: pass }),
      });
      if (loginRes && loginRes.token) localStorage.setItem("ct_session_token", loginRes.token);
      localStorage.setItem("ct_last_user", clean);
      await loadMe();
      await loadProjects();
      clearDropdowns();
      app.view = "projects";
      mount(render());
    } catch (e) {
      app.ui.switchError = e && e.message ? e.message : String(e);
      mount(render());
    }
  };

  const switchUserInput = input({ placeholder: t("用户名") });
  const switchPassInput = input({ placeholder: t("密码"), type: "password" });
  switchUserInput.autocomplete = "username";
  switchUserInput.name = "switch_username";
  switchPassInput.autocomplete = "current-password";
  switchPassInput.name = "switch_password";
  const switchBtn = btn(t("切换"), { kind: "primary" });
  switchBtn.setAttribute("type", "submit");
  const userMenu = dropdownMenu("user", h("div", { class: "user-menu" }, [
    h("div", { class: "user-menu-title", html: t("切换用户") }),
    h("form", {
      class: "user-menu-row",
      onsubmit: (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        doSwitchUser(switchUserInput.value, switchPassInput.value);
      },
    }, [
      switchUserInput,
      switchPassInput,
      switchBtn,
    ]),
    app.ui.switchError ? h("div", { class: "hint error", html: app.ui.switchError }) : null,
  ]));
  const sidebarBrand = h("div", { class: "sidebar-brand" }, [
    h("div", { class: "sidebar-brand-mark", html: "C" }),
    h("div", { class: "sidebar-brand-text" }, [
      h("div", { class: "sidebar-brand-name", html: "CollabTeX" }),
      h("div", { class: "sidebar-brand-sub", html: "Studio" }),
    ]),
  ]);

  const sidebar = h("aside", { class: "projects-sidebar" }, [
    h("div", { class: "dropdown dropdown-left", "data-dropdown-id": "user" }, [userCard, userMenu]),
    h("div", { class: "projects-nav" }, [
      navItem("all", t("所有项目")),
      navItem("mine", t("你的项目")),
      navItem("shared", t("与你共享")),
    ]),
    h("div", { class: "sidebar-spacer" }),
    sidebarBrand,
  ]);

  const canEditProjects = !app.ui.guestMode;
  const actions = h("div", { class: "projects-actions" }, [
    h("div", { class: "view-toggle-group" }, [listBtn, gridBtn]),
    importZip,
    btn(t("导入"), { kind: "pill", disabled: !canEditProjects, onClick: () => importZip.click() }),
    btn(`+ ${t("新建")}`, {
      kind: "pill primary",
      disabled: !canEditProjects,
      onClick: (ev) => { ev.stopPropagation(); createProject(); },
    }),
  ]);

  const importErrorEl = app.ui.importError
    ? h("div", { class: "hint error project-import-error", html: app.ui.importError })
    : null;

  const main = h("div", { class: "projects-main" }, [
    h("div", { class: "projects-topbar" }, [
      titleEl,
      h("div", { class: "projects-search" }, [projectFilterInput]),
      actions,
    ]),
    h("div", { class: "projects-content" }, [importErrorEl, list]),
  ]);

  return h("div", { class: "page projects-page" }, [
    h("div", { class: "projects-shell" }, [sidebar, main]),
  ]);
}
