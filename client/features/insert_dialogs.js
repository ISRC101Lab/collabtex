export function showChartBuilderDialog({
  isProjectView,
  h,
  t,
  btn,
  showModal,
  closeModal,
  insertSnippet,
  parseTable,
  generatePgfplots,
}) {
  if (!isProjectView) return;

  const typeSelect = h("select", { class: "input" }, [
    h("option", { value: "line", html: t("折线图") }),
    h("option", { value: "bar", html: t("柱状图") }),
    h("option", { value: "scatter", html: t("散点图") }),
  ]);
  const styleSelect = h("select", { class: "input" }, [
    h("option", { value: "default", html: t("默认") }),
    h("option", { value: "vivid", html: t("鲜明") }),
    h("option", { value: "mono", html: t("灰度") }),
  ]);
  const headerToggle = h("label", { class: "toggle" }, [
    h("input", { type: "checkbox" }),
    h("span", { html: t("首行标题") }),
  ]);
  const smoothInput = h("input", { type: "checkbox" });
  const smoothToggle = h("label", { class: "toggle" }, [
    smoothInput,
    h("span", { html: t("平滑曲线") }),
  ]);
  const stackedInput = h("input", { type: "checkbox" });
  const stackedToggle = h("label", { class: "toggle" }, [
    stackedInput,
    h("span", { html: t("堆叠柱") }),
  ]);
  const dataInput = h("textarea", {
    class: "textarea",
    placeholder: "x,SeriesA,SeriesB\n1,2,3\n2,4,5\n3,6,7",
  });
  const xlabelInput = h("input", { class: "input", placeholder: t("X 轴") });
  const ylabelInput = h("input", { class: "input", placeholder: t("Y 轴") });
  const titleInput = h("input", { class: "input", placeholder: t("图标题") });
  const captionInput = h("input", { class: "input", placeholder: t("图注") });
  const labelInput = h("input", { class: "input", placeholder: "fig:chart" });
  const output = h("textarea", { class: "textarea", placeholder: t("输出将显示在这里...") });
  output.readOnly = true;

  const generate = () => {
    const table = parseTable(dataInput.value);
    const code = generatePgfplots({
      type: typeSelect.value,
      table,
      header: !!headerToggle.querySelector("input").checked,
      theme: styleSelect.value,
      smooth: !!smoothInput.checked,
      stacked: !!stackedInput.checked,
      xlabel: xlabelInput.value.trim(),
      ylabel: ylabelInput.value.trim(),
      title: titleInput.value.trim(),
      caption: captionInput.value.trim(),
      label: labelInput.value.trim(),
    });
    output.value = code;
  };

  const insertBtn = btn(t("插入"), {
    kind: "primary",
    onClick: () => {
      if (!output.value) generate();
      if (!output.value) return;
      insertSnippet(`\n${output.value}\n`);
      closeModal();
    },
  });
  const copyBtn = btn(t("复制代码"), {
    kind: "tiny",
    onClick: async () => {
      if (!output.value) generate();
      if (!output.value) return;
      try {
        await navigator.clipboard.writeText(output.value);
      } catch {
        // ignore
      }
    },
  });

  const updateToggles = () => {
    smoothInput.disabled = typeSelect.value !== "line";
    stackedInput.disabled = typeSelect.value !== "bar";
  };
  typeSelect.addEventListener("change", updateToggles);
  updateToggles();

  const body = h("div", { class: "chart-body" }, [
    h("div", { class: "label", html: t("图表类型") }),
    typeSelect,
    h("div", { class: "label", html: t("图表风格") }),
    styleSelect,
    h("div", { class: "chart-toggles" }, [headerToggle, smoothToggle, stackedToggle]),
    h("div", { class: "label", html: t("数据") }),
    dataInput,
    h("div", { class: "chart-grid" }, [xlabelInput, ylabelInput, titleInput, captionInput, labelInput]),
    h("div", { class: "hint", html: t("需要在导言区引入 pgfplots") }),
    h("div", { class: "chart-actions" }, [
      btn(t("生成"), { kind: "primary", onClick: generate }),
      copyBtn,
    ]),
    output,
  ]);

  showModal({ title: t("图表生成"), bodyEl: body, actions: [insertBtn] });
}

export function showImageInsertDialog({
  isProjectView,
  files,
  h,
  t,
  btn,
  showModal,
  closeModal,
  insertSnippet,
  buildFigureSnippet,
}) {
  if (!isProjectView) return;

  const filterInput = h("input", { class: "input", placeholder: t("筛选文件...") });
  const widthInput = h("input", { class: "input", value: "0.8\\linewidth" });
  const captionInput = h("input", { class: "input", placeholder: t("图注") });
  const labelInput = h("input", { class: "input", placeholder: "fig:label" });
  const fileList = h("div", { class: "file-list" });
  const hint = h("div", { class: "hint", html: files.length ? "" : t("暂无图片文件") });
  let selected = files[0] || "";

  const renderList = () => {
    fileList.innerHTML = "";
    const query = filterInput.value.trim().toLowerCase();
    const items = query ? files.filter((file) => file.toLowerCase().includes(query)) : files;
    if (!items.length) {
      fileList.appendChild(h("div", { class: "hint", html: t("(无匹配文件)") }));
      return;
    }
    for (const filePath of items.slice(0, 160)) {
      const row = h("button", {
        class: `file-item${filePath === selected ? " active" : ""}`.trim(),
        title: filePath,
        onclick: () => {
          selected = filePath;
          renderList();
        },
      });
      row.textContent = filePath;
      fileList.appendChild(row);
    }
  };

  filterInput.addEventListener("input", renderList);
  renderList();

  const body = h("div", { class: "insert-image" }, [
    h("div", { class: "label", html: t("选择图片") }),
    filterInput,
    fileList,
    hint,
    h("div", { class: "label", html: t("插入设置") }),
    h("div", { class: "chart-grid" }, [widthInput, captionInput, labelInput]),
  ]);

  const insertBtn = btn(t("插入"), {
    kind: "primary",
    onClick: () => {
      if (!selected) return;
      const snippet = buildFigureSnippet({
        filePath: selected,
        width: widthInput.value,
        caption: captionInput.value,
        label: labelInput.value,
      });
      insertSnippet(`\n${snippet}\n`);
      closeModal();
    },
  });

  showModal({ title: t("插入图片"), bodyEl: body, actions: [insertBtn] });
}
