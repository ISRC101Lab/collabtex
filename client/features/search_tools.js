export function showQuickOutlineDialog({
  app,
  h,
  t,
  showModal,
  closeModal,
  openFileAt,
}) {
  if (app.view !== "project") return;
  if (!app.current.openFile) return alert(t("请先打开文件。"));
  const outline = Array.isArray(app.current.outline) ? app.current.outline.slice() : [];
  if (!outline.length) return alert(t("(未找到章节)"));

  const query = h("input", { class: "input", placeholder: t("大纲跳转") });
  query.autocomplete = "off";
  const list = h("div", { class: "quick-list" });
  const hint = h("div", { class: "quick-hint", html: t("回车打开，Esc 关闭") });

  let results = [];
  let selected = 0;

  const appendHighlighted = (el, text, q) => {
    if (!q) {
      el.textContent = text;
      return;
    }
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx === -1) {
      el.textContent = text;
      return;
    }
    el.appendChild(document.createTextNode(text.slice(0, idx)));
    const mark = h("span", { class: "quick-mark" });
    mark.textContent = text.slice(idx, idx + q.length);
    el.appendChild(mark);
    el.appendChild(document.createTextNode(text.slice(idx + q.length)));
  };

  const renderResults = () => {
    const q = query.value.trim().toLowerCase();
    const scored = outline
      .map((item, idx) => {
        const hay = `${item.title} ${item.kind}`.toLowerCase();
        const pos = q ? hay.indexOf(q) : 0;
        if (q && pos === -1) return null;
        return { item, score: q ? pos : idx };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40);

    results = scored.map((x) => x.item);
    if (selected >= results.length) selected = results.length - 1;
    if (selected < 0) selected = 0;

    list.innerHTML = "";
    if (!results.length) {
      list.appendChild(h("div", { class: "hint", html: t("(无结果)") }));
      return;
    }

    results.forEach((item, idx) => {
      const row = h("div", { class: `quick-item ${idx === selected ? "active" : ""}`.trim() });
      const meta = h("div", { class: "quick-meta" });
      const name = h("div", { class: "quick-name" });
      appendHighlighted(name, item.title || "(untitled)", query.value.trim());
      meta.appendChild(name);
      meta.appendChild(h("div", { class: "quick-path", html: `${item.kind} · ${t("行")} ${item.line}` }));
      row.appendChild(meta);
      row.addEventListener("click", async () => {
        closeModal();
        await openFileAt(app.current.openFile, item.line);
      });
      list.appendChild(row);
    });
  };

  const moveSelection = (delta) => {
    if (!results.length) return;
    selected = Math.max(0, Math.min(results.length - 1, selected + delta));
    const items = list.querySelectorAll(".quick-item");
    items.forEach((el, idx) => el.classList.toggle("active", idx === selected));
    const active = items[selected];
    if (active) active.scrollIntoView({ block: "nearest" });
  };

  query.addEventListener("input", () => {
    selected = 0;
    renderResults();
  });
  query.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      moveSelection(1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      moveSelection(-1);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const item = results[selected];
      if (item) {
        closeModal();
        openFileAt(app.current.openFile, item.line).catch(console.error);
      }
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeModal();
    }
  });

  const body = h("div", { class: "quick-body" }, [query, list, hint]);
  showModal({ title: t("大纲跳转"), bodyEl: body, actions: [] });
  renderResults();
  setTimeout(() => query.focus(), 0);
}

export function showQuickOpenDialog({
  app,
  h,
  t,
  isFolderPlaceholder,
  showModal,
  closeModal,
  openFile,
}) {
  if (app.view !== "project") return;
  const allFiles = Array.isArray(app.current.tree)
    ? app.current.tree.filter((path) => !isFolderPlaceholder(path))
    : [];
  const recents = Array.isArray(app.ui.openFiles) ? app.ui.openFiles : [];

  const query = h("input", { class: "input", placeholder: t("输入过滤文件...") });
  query.autocomplete = "off";
  const list = h("div", { class: "quick-list" });
  const hint = h("div", { class: "quick-hint", html: t("回车打开，Esc 关闭") });

  let results = [];
  let selected = 0;

  const scorePath = (path, q) => {
    if (!q) return 0;
    const lowerPath = path.toLowerCase();
    const lowerQuery = q.toLowerCase();
    const idx = lowerPath.indexOf(lowerQuery);
    if (idx !== -1) return idx;
    let pathIndex = 0;
    let queryIndex = 0;
    let score = 0;
    while (pathIndex < lowerPath.length && queryIndex < lowerQuery.length) {
      if (lowerPath[pathIndex] === lowerQuery[queryIndex]) {
        score += pathIndex;
        queryIndex += 1;
      }
      pathIndex += 1;
    }
    if (queryIndex !== lowerQuery.length) return Number.POSITIVE_INFINITY;
    return 1000 + score;
  };

  const appendHighlighted = (el, text, q) => {
    if (!q) {
      el.textContent = text;
      return;
    }
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx === -1) {
      el.textContent = text;
      return;
    }
    el.appendChild(document.createTextNode(text.slice(0, idx)));
    const mark = h("span", { class: "quick-mark" });
    mark.textContent = text.slice(idx, idx + q.length);
    el.appendChild(mark);
    el.appendChild(document.createTextNode(text.slice(idx + q.length)));
  };

  const renderResults = () => {
    const q = query.value.trim();
    const scored = allFiles
      .map((path) => {
        const score = scorePath(path, q);
        const boost = recents.includes(path) ? -50 : 0;
        return { path, score: score + boost };
      })
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => a.score - b.score)
      .slice(0, 30);

    results = scored.map((item) => item.path);
    if (selected >= results.length) selected = results.length - 1;
    if (selected < 0) selected = 0;

    list.innerHTML = "";
    if (results.length === 0) {
      list.appendChild(h("div", { class: "hint", html: t("(无结果)") }));
      return;
    }

    results.forEach((filePath, idx) => {
      const base = filePath.split("/").pop() || filePath;
      const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
      const row = h("div", { class: `quick-item ${idx === selected ? "active" : ""}`.trim() });
      const meta = h("div", { class: "quick-meta" });
      const name = h("div", { class: "quick-name" });
      appendHighlighted(name, base, q);
      meta.appendChild(name);
      if (dir) meta.appendChild(h("div", { class: "quick-path", html: dir }));
      row.appendChild(meta);
      if (recents.includes(filePath)) row.appendChild(h("div", { class: "quick-tag", html: t("已打开") }));
      row.addEventListener("click", async () => {
        closeModal();
        await openFile(filePath);
      });
      list.appendChild(row);
    });
  };

  const moveSelection = (delta) => {
    if (!results.length) return;
    selected = Math.max(0, Math.min(results.length - 1, selected + delta));
    const items = list.querySelectorAll(".quick-item");
    items.forEach((el, idx) => el.classList.toggle("active", idx === selected));
    const active = items[selected];
    if (active) active.scrollIntoView({ block: "nearest" });
  };

  query.addEventListener("input", () => {
    selected = 0;
    renderResults();
  });
  query.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      moveSelection(1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      moveSelection(-1);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const filePath = results[selected];
      if (filePath) {
        closeModal();
        openFile(filePath).catch(console.error);
      }
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeModal();
    }
  });

  const body = h("div", { class: "quick-body" }, [query, list, hint]);
  showModal({ title: t("快速打开"), bodyEl: body, actions: [] });
  renderResults();
  setTimeout(() => query.focus(), 0);
}

export function showProjectSearchDialog({
  app,
  h,
  t,
  escapeRegExp,
  api,
  btn,
  closeModal,
  showModal,
  openFileAt,
}) {
  if (app.view !== "project") return;
  const projectId = app.current.project && app.current.project.id;
  if (!projectId) return;

  const query = h("input", { class: "input", placeholder: t("搜索关键词...") });
  query.autocomplete = "off";

  const regexToggle = h("label", { class: "toggle" }, [
    h("input", { type: "checkbox" }),
    h("span", { html: t("正则") }),
  ]);
  const regexInput = regexToggle.querySelector("input");
  const caseToggle = h("label", { class: "toggle" }, [
    h("input", { type: "checkbox" }),
    h("span", { html: t("大小写敏感") }),
  ]);
  const caseInput = caseToggle.querySelector("input");

  const scopeSelect = h(
    "select",
    { class: "input search-scope", value: "tex" },
    [
      h("option", { value: "tex", html: t("仅 TeX") }),
      h("option", { value: "texbib", html: t("TeX + 参考文献") }),
      h("option", { value: "texbibstyle", html: t("TeX + Bib + 样式") }),
      h("option", { value: "all", html: t("全部文件") }),
    ]
  );

  const meta = h("div", { class: "search-meta hint" });
  const results = h("div", { class: "search-results" });

  const scopeToExts = (scope) => {
    if (scope === "tex") return [".tex"];
    if (scope === "texbib") return [".tex", ".bib"];
    if (scope === "texbibstyle") return [".tex", ".bib", ".sty", ".cls", ".bst", ".bbx", ".cbx", ".dbx"];
    return [];
  };

  const appendHighlighted = (el, text, q, useRegex, caseSensitive) => {
    if (!q) {
      el.textContent = text;
      return;
    }
    let re = null;
    try {
      const flags = caseSensitive ? "g" : "gi";
      re = new RegExp(useRegex ? q : escapeRegExp(q), flags);
    } catch {
      el.textContent = text;
      return;
    }
    let last = 0;
    let match;
    while ((match = re.exec(text))) {
      if (match.index > last) el.appendChild(document.createTextNode(text.slice(last, match.index)));
      const mark = h("span", { class: "search-mark" });
      mark.textContent = match[0] || "";
      el.appendChild(mark);
      last = match.index + (match[0] || "").length;
      if (match.index === re.lastIndex) re.lastIndex += 1;
      if (last >= text.length) break;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  };

  let token = 0;
  const runSearch = async () => {
    const q = query.value.trim();
    if (!q) {
      meta.textContent = t("搜索关键词...");
      results.innerHTML = "";
      return;
    }
    const myToken = ++token;
    meta.textContent = t("正在搜索...");
    results.innerHTML = "";
    try {
      const payload = {
        query: q,
        regex: regexInput && regexInput.checked,
        caseSensitive: caseInput && caseInput.checked,
        exts: scopeToExts(scopeSelect.value),
        limit: 300,
      };
      const res = await api(`/api/projects/${projectId}/search`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (myToken !== token) return;
      const list = Array.isArray(res && res.results) ? res.results : [];
      if (!list.length) {
        results.appendChild(h("div", { class: "hint", html: t("未找到结果") }));
      } else {
        for (const item of list) {
          const row = h("div", { class: "search-row" });
          const left = h("div", { class: "search-main" });
          const title = h("div", { class: "search-title" });
          title.textContent = `${item.file}:${item.line}`;
          const snippet = h("div", { class: "search-snippet" });
          appendHighlighted(snippet, item.preview || "", q, payload.regex, payload.caseSensitive);
          left.appendChild(title);
          left.appendChild(snippet);
          row.appendChild(left);
          row.appendChild(
            btn(t("打开"), {
              kind: "tiny",
              onClick: async () => {
                closeModal();
                await openFileAt(item.file, item.line);
              },
            })
          );
          results.appendChild(row);
        }
      }
      const msg = t("搜索完成：{n} 条结果 / 扫描 {m} 个文件", {
        n: list.length,
        m: res && Number.isFinite(res.scanned) ? res.scanned : 0,
      });
      meta.textContent = res && res.truncated ? `${msg} · ${t("搜索被截断")}` : msg;
    } catch (e) {
      if (myToken !== token) return;
      meta.textContent = e && e.message ? e.message : String(e);
    }
  };

  query.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      runSearch();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      closeModal();
    }
  });

  const controls = h("div", { class: "search-controls" }, [
    query,
    btn(t("搜索"), { kind: "primary", onClick: runSearch }),
  ]);
  const options = h("div", { class: "search-options" }, [
    h("div", { class: "label", html: t("范围") }),
    scopeSelect,
    regexToggle,
    caseToggle,
  ]);

  const body = h("div", { class: "search-body" }, [controls, options, meta, results]);
  showModal({ title: t("项目搜索"), bodyEl: body, actions: [] });
  setTimeout(() => query.focus(), 0);
}
