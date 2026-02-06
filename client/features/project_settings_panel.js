export function buildProjectSettingsPanelView(project, deps, { onDelete } = {}) {
  const {
    input,
    app,
    h,
    t,
    btn,
    api,
    loadProjects,
    clearDropdowns,
    mount,
    render,
  } = deps;

  if (!project) return null;
  const nameInput = input({ value: project.name || "" });
  const isEditing = app.ui.projectRenameId === project.id;

  const body = h("div", { class: "dropdown-panel project-actions-panel" }, []);
  if (isEditing) {
    body.appendChild(h("div", { class: "label", html: t("名称") }));
    body.appendChild(nameInput);
  }

  const saveBtn = btn(t("保存"), {
    kind: "primary menu-inline",
    onClick: async (ev) => {
      ev.stopPropagation();
      const payload = {
        name: nameInput.value.trim() || project.name,
      };
      await api(`/api/projects/${project.id}/meta`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      project.name = payload.name;
      await loadProjects();
      if (app.current.project && app.current.project.id === project.id) {
        app.current.project = app.projects.find((p) => p.id === project.id) || project;
      }
      clearDropdowns();
      mount(render());
    },
  });

  const renameBtn = btn(t("重命名"), {
    kind: "menu-item",
    onClick: (ev) => {
      ev.stopPropagation();
      app.ui.projectRenameId = project.id;
      app.ui.projectDeleteArmed = "";
      mount(render());
    },
  });

  const cancelBtn = btn(t("取消"), {
    kind: "menu-inline",
    onClick: (ev) => {
      ev.stopPropagation();
      app.ui.projectRenameId = "";
      mount(render());
    },
  });

  const isArmed = app.ui.projectDeleteArmed === project.id;
  const delBtn = btn(isArmed ? t("确认删除") : t("删除项目"), {
    kind: isArmed ? "menu-item danger" : "menu-item",
    onClick: async (ev) => {
      ev.stopPropagation();
      if (!isArmed) {
        app.ui.projectDeleteArmed = project.id;
        mount(render());
        return;
      }

      const previousProjects = Array.isArray(app.projects) ? app.projects.slice() : null;
      clearDropdowns();
      if (onDelete) {
        await onDelete(project);
      } else {
        const list = Array.isArray(app.projects) ? app.projects : [];
        app.projects = list.filter((item) => item && item.id !== project.id);
        mount(render());
      }

      try {
        await api(`/api/projects/${project.id}`, { method: "DELETE" });
      } catch (e) {
        if (Array.isArray(previousProjects)) app.projects = previousProjects;
        try {
          await loadProjects();
        } catch {
          // ignore secondary load failures
        }
        app.ui.importError = e && e.message ? e.message : String(e);
        mount(render());
      }
    },
  });

  if (isEditing) {
    body.appendChild(h("div", { class: "menu-inline" }, [saveBtn, cancelBtn]));
  } else {
    body.appendChild(renameBtn);
  }
  body.appendChild(delBtn);
  return body;
}
