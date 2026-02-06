import { safeStorage as localStorage } from "../utils/storage.js";

export function renderLoginPage(deps) {
  const {
    input,
    t,
    h,
    applyLayoutClass,
    updateTopbarButtons,
    updateToolbarCollapsed,
    updateBottomConsoleVisibility,
    updateRightPaneFloat,
    topbar,
    btn,
    api,
    loadMe,
    loadProjects,
    app,
    mount,
    render,
  } = deps;
  const user = input({ placeholder: t("用户名 (admin / user01..user09)") });
  const pass = input({ placeholder: t("密码"), type: "password" });
  const err = h("div", { class: "hint error" });

  setTimeout(() => {
    applyLayoutClass();
    updateTopbarButtons();
    updateToolbarCollapsed();
    updateBottomConsoleVisibility();
    updateRightPaneFloat();
  }, 0);

  return h("div", { class: "page" }, [
    topbar(t("内网协作 LaTeX"), []),
    h("div", { class: "center" }, [
      h("div", { class: "card auth" }, [
        h("div", { class: "h1", html: t("登录") }),
        h("div", { class: "hint", html: t("不开放注册，账号由服务器本地创建。") }),
        h("div", { class: "form" }, [
          h("div", { class: "label", html: t("用户名") }),
          user,
          h("div", { class: "label", html: t("密码") }),
          pass,
          btn(t("登录"), {
            kind: "primary",
            onClick: async () => {
              err.textContent = "";
              try {
                const loginRes = await api("/api/login", {
                  method: "POST",
                  body: JSON.stringify({ username: user.value.trim(), password: pass.value }),
                });
                if (loginRes && loginRes.token) localStorage.setItem("ct_session_token", loginRes.token);
                localStorage.setItem("ct_last_user", user.value.trim() || "admin");
                await loadMe();
                await loadProjects();
                app.view = "projects";
                mount(render());
              } catch (e) {
                err.textContent = e && e.message ? e.message : String(e);
              }
            },
          }),
          err,
        ]),
      ]),
    ]),
  ]);
}
