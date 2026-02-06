export async function openFileSession(filePath, deps) {
  const {
    app,
    document,
    window,
    localStorage,
    mount,
    render,
    t,
    h,
    fileBaseName,
    flashEditorLine,
    isFolderPlaceholder,
    isAssetFile,
    setLayoutMode,
    trackOpenFile,
    cleanupEditor,
    scheduleCompile,
    scheduleOutline,
    scheduleStatus,
    scheduleHistorySnapshot,
    schedulePdfSync,
    updateOutlineFromText,
    updateDocCaches,
    updateEditorStatus,
    loadHistory,
    readTextForWork,
    hashText,
    api,
    wsUrl,
    pickColor,
    Y,
    HocuspocusProvider,
    HocuspocusProviderWebsocket,
    StreamLanguage,
    stex,
    EditorView,
    EditorState,
    basicSetup,
    autocompletion,
    imageCompletionSource,
    latexCompletionSource,
    foldService,
    latexFoldService,
    flashLineField,
    yCollab,
    syntaxHighlighting,
    WARM_HIGHLIGHT,
    setTimeout,
    clearTimeout,
    requestAnimationFrame,
    cancelAnimationFrame,
  } = deps;
  if (isFolderPlaceholder(filePath)) return;
  const projectId = app.current.project && app.current.project.id;
  const openTicket = (Number(app.ui.openTicket || 0) + 1);
  app.ui.openTicket = openTicket;
  const isStaleOpen = () => Number(app.ui.openTicket || 0) !== openTicket;
  app.ui.openingFile = filePath;
  const clearOpeningFile = () => {
    if (app.ui.openingFile === filePath) app.ui.openingFile = "";
  };
  if (projectId && isAssetFile(filePath)) {
    let url = `/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`;
    const token = localStorage.getItem("ct_session_token") || "";
    if (token) url += `&token=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
    clearOpeningFile();
    return;
  }
  if (isStaleOpen()) {
    clearOpeningFile();
    return;
  }
  if (filePath === app.current.openFile && app.editor.view) {
    if (app.ui.refreshFileTabs) app.ui.refreshFileTabs();
    if (app.ui.refreshFileTree) app.ui.refreshFileTree();
    clearOpeningFile();
    return;
  }
  app.current.openFile = filePath;
  if (app.ui.layoutMode === "pdf") setLayoutMode("balanced");
  trackOpenFile(filePath);
  cleanupEditor();
  app.ui.autoCompileDirty = false;
  app.ui.autoCompileDirtyAt = 0;
  app.ui.lastEditAt = 0;
  app.ui.autoCompileReady = false;
  if (app.ui.autoCompileArmTimer) clearTimeout(app.ui.autoCompileArmTimer);
  app.ui.autoCompileArmTimer = setTimeout(() => {
    app.ui.autoCompileReady = true;
    app.ui.autoCompileArmTimer = null;
    if (app.ui.autoCompileDirty) scheduleCompile();
  }, 1500);
  let host = document.getElementById("editorHost");
  if (!host) {
    mount(render());
    host = document.getElementById("editorHost");
  } else {
    if (app.ui.refreshFileTabs) app.ui.refreshFileTabs();
    if (app.ui.refreshFileTree) app.ui.refreshFileTree();
    const titleEl = document.getElementById("editorTitle");
    if (titleEl) {
      titleEl.textContent = filePath ? fileBaseName(filePath) : t("编辑器");
      titleEl.title = filePath || "";
    }
    const statusEl = document.getElementById("editorStatus");
      if (statusEl) statusEl.textContent = "";
  }
  if (isStaleOpen()) {
    clearOpeningFile();
    return;
  }
  if (!host) {
    clearOpeningFile();
    return;
  }

  const docName = `${projectId}:${encodeURIComponent(filePath)}`;

  const ydoc = new Y.Doc();
  let provider = null;
  let providerStatus = "disconnected";
  let prefillTimer = null;
  let prefilled = false;
  let syncedOnce = false;
  let collabEnabled = false;
  let collabConnectedOnce = false;

  const resetCollabBackoff = () => {
    app.ui.collabFailStreak = 0;
    app.ui.collabBackoffUntil = 0;
  };

  const bumpCollabBackoff = () => {
    const streak = Math.min(8, Number(app.ui.collabFailStreak || 0) + 1);
    app.ui.collabFailStreak = streak;
    const cooldownMs = Math.min(10 * 60_000, 12_000 * streak * streak);
    app.ui.collabBackoffUntil = Date.now() + cooldownMs;
  };

  const degradeToLocal = () => {
    if (!collabEnabled) return;
    collabEnabled = false;
    providerStatus = "local";
    bumpCollabBackoff();
    try {
      if (provider && typeof provider.disconnect === "function") provider.disconnect();
    } catch {
      // ignore disconnect errors
    }
    try {
      if (provider && typeof provider.destroy === "function") provider.destroy();
    } catch {
      // ignore destroy errors
    }
    provider = null;
    if (Number(app.ui.collabFailStreak || 0) >= 2) {
      try {
        localStorage.removeItem("ct_ws_url");
        app.ui.wsUrlOverride = "";
      } catch {
        // ignore localStorage errors
      }
    }
    if (app.editor) app.editor.syncStatus = "local";
  };

  const canTryCollabNow = Date.now() >= Number(app.ui.collabBackoffUntil || 0);

  if (canTryCollabNow) {
    try {
      const websocketProvider = new HocuspocusProviderWebsocket({
        url: wsUrl(),
        connect: false,
        delay: 220,
        initialDelay: 0,
        factor: 1,
        minDelay: 180,
        maxDelay: 650,
        maxAttempts: 1,
        timeout: 1_400,
        messageReconnectTimeout: 12_000,
        jitter: false,
        quiet: true,
      });

      provider = new HocuspocusProvider({
        websocketProvider,
        name: docName,
        document: ydoc,
        connect: false,
        preserveConnection: false,
        quiet: true,
      });
      providerStatus = "connecting";
      if (!provider || !provider.awareness || typeof provider.awareness.setLocalStateField !== "function") {
        provider = null;
        providerStatus = "local";
        bumpCollabBackoff();
      } else {
        collabEnabled = true;
        const c = pickColor((app.me && app.me.username) || "user");
        provider.awareness.setLocalStateField("user", {
          name: (app.me && app.me.username) || "user",
          color: c.color,
          colorLight: c.light,
        });
      }
    } catch (err) {
      provider = null;
      providerStatus = "local";
      bumpCollabBackoff();
      console.error("openFileSession: collaboration provider unavailable, using local editor mode", err);
    }
  } else {
    providerStatus = "local";
  }

  const ytext = ydoc.getText("content");
  const undoManager = new Y.UndoManager(ytext);
  const latexMode = StreamLanguage.define(stex);

  const isUserEdit = (u) =>
    u.transactions.some((tr) => {
      if (!tr.isUserEvent) return false;
      return (
        tr.isUserEvent("input") ||
        tr.isUserEvent("delete") ||
        tr.isUserEvent("paste") ||
        tr.isUserEvent("move") ||
        tr.isUserEvent("undo") ||
        tr.isUserEvent("redo")
      );
    });

  const autoCompileListener = EditorView.updateListener.of((u) => {
    if (!u.docChanged || !app.ui.autoCompile) return;
    if (!isUserEdit(u)) return;
    const now = Date.now();
    app.ui.lastEditAt = now;
    if (!app.ui.autoCompileDirtyAt) app.ui.autoCompileDirtyAt = now;
    app.ui.autoCompileDirty = true;
    if (!app.ui.autoCompileReady) return;
    scheduleCompile();
  });

  const outlineListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) scheduleOutline(u.state.doc);
  });

  const statusListener = EditorView.updateListener.of((u) => {
    if (u.docChanged || u.selectionSet) scheduleStatus(u.view);
  });

  const historyListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) scheduleHistorySnapshot(u.view);
  });

  const cacheListener = EditorView.updateListener.of((u) => {
    if (!u.docChanged) return;
    if (app.current.openFile) {
      updateDocCaches(app.current.openFile, u.state.doc.toString());
    }
  });

  const syncListener = EditorView.updateListener.of((u) => {
    if (app.ui.autoSyncPdf && u.selectionSet) schedulePdfSync();
  });

  let typewriterRaf = null;
  const typewriterListener = EditorView.updateListener.of((u) => {
    if (!app.ui.typewriterMode) return;
    if (!u.selectionSet) return;
    if (typewriterRaf) cancelAnimationFrame(typewriterRaf);
    typewriterRaf = requestAnimationFrame(() => {
      typewriterRaf = null;
      if (app.editor.view !== u.view) return;
      try {
        u.view.dispatch({
          effects: EditorView.scrollIntoView(u.state.selection.main.head, { y: "center" }),
        });
      } catch {
        // ignore scroll failures
      }
    });
  });

  const buildExtensions = (useCollab) => [
      basicSetup,
      latexMode,
      autocompletion({ override: [imageCompletionSource, latexCompletionSource] }),
      foldService.of(latexFoldService),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true" }),
      EditorView.theme(
        {
          "&": { height: "100%" },
          ".cm-scroller": {
            fontFamily: "var(--font-mono)",
            fontSize: "var(--editor-font-size)",
          },
          ".cm-content": { padding: "var(--editor-pad-y) var(--editor-pad-x)" },
          ".cm-line": { lineHeight: "var(--editor-line-height)" },
          ".cm-gutters": {
            backgroundColor: "var(--panel-strong)",
            color: "var(--muted)",
            borderRight: "1px solid var(--border)",
          },
          ".cm-activeLine": { backgroundColor: "rgba(206, 186, 255, 0.12)" },
          ".cm-selectionBackground": { backgroundColor: "rgba(176, 227, 198, 0.2)" },
          ".cm-cursor": { borderLeftColor: "#e5f3ff" },
          ".cm-matchingBracket": {
            backgroundColor: "rgba(172, 236, 204, 0.18)",
            outline: "1px solid rgba(176, 227, 198, 0.42)",
          },
        },
        { dark: false }
      ),
      flashLineField,
      ...(useCollab ? [yCollab(ytext, provider.awareness, { undoManager })] : []),
      syntaxHighlighting(WARM_HIGHLIGHT),
      autoCompileListener,
      outlineListener,
      statusListener,
      historyListener,
      cacheListener,
      syncListener,
      typewriterListener,
    ];

  let state;
  try {
    state = EditorState.create({
      doc: ytext.toString(),
      extensions: buildExtensions(collabEnabled),
    });
  } catch (err) {
    console.error("openFileSession: state create failed, fallback to local editor", err);
    collabEnabled = false;
    providerStatus = "disconnected";
    if (provider) {
      try { provider.destroy(); } catch {}
      provider = null;
    }
    state = EditorState.create({
      doc: "",
      extensions: buildExtensions(false),
    });
  }

  const view = new EditorView({ state, parent: host });
  if (isStaleOpen()) {
    try { view.destroy(); } catch {}
    if (provider) {
      try { provider.destroy(); } catch {}
    }
    try { ydoc.destroy(); } catch {}
    clearOpeningFile();
    return;
  }
  updateOutlineFromText(view.state.doc.toString());
  updateDocCaches(filePath, view.state.doc.toString());
  updateEditorStatus(view);

  const ensureVisibleContent = async () => {
    if (!projectId || !filePath) return;
    if (isStaleOpen()) return;
    if (!app.editor.view || app.editor.view !== view) return;
    if (view.state.doc.length > 0) return;
    try {
      const text = await api(`/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`);
      if (isStaleOpen()) return;
      if (!app.editor.view || app.editor.view !== view) return;
      if (typeof text !== "string" || !text.length || view.state.doc.length > 0) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      updateOutlineFromText(text);
      updateDocCaches(filePath, text);
      updateEditorStatus(view);
    } catch {
      // ignore fallback load errors
    }
  };
  setTimeout(() => { ensureVisibleContent().catch(() => {}); }, 320);

  const onlineEl = document.getElementById("onlineUsers");
  const updateOnline = () => {
    if (!onlineEl) return;
    if (!provider || !collabEnabled) {
      onlineEl.textContent = t("(离线)");
      return;
    }
    const states = Array.from(provider.awareness.getStates().values());
    const users = new Map();
    for (const s of states) {
      if (!s || !s.user || !s.user.name) continue;
      const name = s.user.name;
      if (users.has(name)) continue;
      let line = null;
      let pos = null;
      if (s.cursor && s.cursor.head && ydoc) {
        try {
          const head = Y.createAbsolutePositionFromRelativePosition(s.cursor.head, ydoc);
          if (head && head.type === ytext) {
            pos = head.index;
            if (view && view.state && Number.isFinite(pos)) {
              line = view.state.doc.lineAt(pos).number;
            }
          }
        } catch {
          // ignore cursor conversion errors
        }
      }
      users.set(name, { name, color: s.user.color, light: s.user.colorLight, line, pos });
    }
    onlineEl.innerHTML = "";
    if (users.size === 0) {
      onlineEl.textContent = t("(无人)");
      return;
    }
    const list = h("span", { class: "presence-list" });
    for (const u of users.values()) {
      const chip = h("span", { class: "presence-chip" });
      chip.style.borderColor = u.color || "#0d727a";
      chip.style.background = u.light || "rgba(13, 114, 122, 0.12)";
      const dot = h("span", { class: "presence-dot" });
      dot.style.background = u.color || "#0d727a";
      chip.appendChild(dot);
      chip.appendChild(h("span", { class: "presence-name", html: u.name }));
      if (u.line) chip.appendChild(h("span", { class: "presence-line", html: `${t("行")}${u.line}` }));
      if (u.pos !== null && u.pos !== undefined) {
        chip.classList.add("clickable");
        chip.title = t("点击跳转到协作者光标");
        chip.addEventListener("click", () => {
          if (!view || !Number.isFinite(u.pos)) return;
          const ln = view.state.doc.lineAt(u.pos).number;
          view.dispatch({ selection: { anchor: u.pos }, scrollIntoView: true });
          view.focus();
          flashEditorLine(view, ln);
        });
      }
      list.appendChild(chip);
    }
    onlineEl.appendChild(list);
  };
  const syncStatus = (ev) => {
    providerStatus = ev && ev.status ? ev.status : "disconnected";
    app.editor.syncStatus = providerStatus;
    updateEditorStatus(view);
    if (providerStatus === "connected" && prefillTimer) {
      clearTimeout(prefillTimer);
      prefillTimer = null;
    }
    if (providerStatus === "connected") {
      collabConnectedOnce = true;
      resetCollabBackoff();
      if (app.ui.autoCompileArmTimer) {
        clearTimeout(app.ui.autoCompileArmTimer);
        app.ui.autoCompileArmTimer = null;
      }
      app.ui.autoCompileReady = true;
      if (app.ui.autoCompileDirty) scheduleCompile();
      return;
    }

    if (providerStatus === "disconnected" && collabEnabled && !collabConnectedOnce) {
      degradeToLocal();
      app.editor.syncStatus = "local";
      updateEditorStatus(view);
      updateOnline();
    }
  };

  const onSynced = (ev) => {
    if (ev && ev.state === true) {
      syncedOnce = true;
      if (prefillTimer) {
        clearTimeout(prefillTimer);
        prefillTimer = null;
      }
      prefillTimer = setTimeout(() => { maybePrefill().catch(() => {}); }, 80);
    }
  };

  if (provider && provider.awareness && typeof provider.on === "function" && typeof provider.awareness.on === "function") {
    provider.on("status", syncStatus);
    provider.on("synced", onSynced);
    provider.awareness.on("change", updateOnline);
  }
  updateOnline();
  if (provider && collabEnabled && typeof provider.connect === "function") {
    provider.connect().catch(() => {
      if (isStaleOpen()) return;
      degradeToLocal();
      app.editor.syncStatus = "local";
      updateEditorStatus(view);
      updateOnline();
    });
  }

  async function maybePrefill() {
    if (!projectId || !filePath) return;
    if (isStaleOpen()) return;
    if (prefilled) return;
    if (ytext.length > 0) return;
    if (providerStatus === "connected" && !syncedOnce) {
      prefillTimer = setTimeout(() => { maybePrefill().catch(() => {}); }, 140);
      return;
    }
    try {
      const text = await api(`/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`);
      if (isStaleOpen()) return;
      if (typeof text === "string" && ytext.length === 0) {
        ytext.insert(0, text || "");
        prefilled = true;
      }
    } catch {
      // ignore prefill errors
    }
  }
  const prefillDelay = collabEnabled ? 140 : 0;
  prefillTimer = setTimeout(() => { maybePrefill().catch(() => {}); }, prefillDelay);

  if (isStaleOpen()) {
    try {
      if (provider) {
        provider.awareness.off("change", updateOnline);
        provider.off("status", syncStatus);
        provider.off("synced", onSynced);
      }
      if (prefillTimer) clearTimeout(prefillTimer);
    } catch {
      // ignore cleanup race
    }
    try { view.destroy(); } catch {}
    if (provider) {
      try { provider.destroy(); } catch {}
    }
    try { ydoc.destroy(); } catch {}
    clearOpeningFile();
    return;
  }

  app.editor = {
    provider,
    ydoc,
    view,
    syncStatus: collabEnabled ? "connecting" : (providerStatus === "local" ? "local" : "disconnected"),
    cleanup: () => {
      if (provider) {
        if (provider.awareness && typeof provider.awareness.off === "function") {
          provider.awareness.off("change", updateOnline);
        }
        if (typeof provider.off === "function") {
          provider.off("status", syncStatus);
          provider.off("synced", onSynced);
        }
      }
      if (prefillTimer) clearTimeout(prefillTimer);
    },
  };
  clearOpeningFile();
  updateEditorStatus(view);
  const warmHistory = async () => {
    await loadHistory(filePath);
    if (!app.ui.historyEntries.length) {
      const size = view.state.doc.length || 0;
      const isLarge = size > 2_000_000;
      if (!isLarge) {
        const text = readTextForWork(view.state.doc).text;
        const hash = hashText(text);
        app.ui.historyHashByFile[filePath] = hash;
        try {
          await api(`/api/projects/${projectId}/history/snapshot`, {
            method: "POST",
            body: JSON.stringify({ file: filePath, content: text }),
          });
        } catch {
          // ignore baseline snapshot errors
        }
      } else {
        app.ui.historyLastSnapAt[filePath] = Date.now();
        try {
          await api(`/api/projects/${projectId}/history/snapshot`, {
            method: "POST",
            body: JSON.stringify({ file: filePath }),
          });
        } catch {
          // ignore baseline snapshot errors
        }
      }
      await loadHistory(filePath, { force: true });
    }
  };
  setTimeout(() => {
    warmHistory().catch(console.error);
  }, 120);
}
