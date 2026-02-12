import { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useCollabStore } from '@/stores/collabStore';
import { compile, uploadFiles, getDownloadUrl } from '@/api/client';
import { extractLabels, extractBibKeys } from '@/lib/tex-labels';
import FileTree from '@/components/filetree/FileTree';
import TabBar from '@/components/editor/TabBar';
import ChangeBanner from '@/components/editor/ChangeBanner';
import UndoBar from '@/components/editor/UndoBar';
import CodeEditor, { type CodeEditorHandle } from '@/components/editor/CodeEditor';
import EditorToolbar from '@/components/editor/EditorToolbar';
import PdfPreview from '@/components/pdf/PdfPreview';
import AiChatPanel from '@/components/ai/AiChatPanel';
import ResizeHandle from '@/components/layout/ResizeHandle';
import SearchPanel from '@/components/editor/SearchPanel';
import CollabManager from '@/components/collab/CollabManager';
import './EditorPage.css';

function getLanguage(path: string): string | undefined {
  if (path.endsWith('.tex') || path.endsWith('.sty') || path.endsWith('.cls')) {
    return 'tex';
  }
  return undefined;
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const selectProject = useProjectStore((s) => s.selectProject);
  const fetchTree = useEditorStore((s) => s.fetchTree);
  const fileTree = useEditorStore((s) => s.fileTree);
  const openFile = useEditorStore((s) => s.openFile);
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFile = useEditorStore((s) => s.activeFile);
  const saveFile = useEditorStore((s) => s.saveFile);
  const createFile = useEditorStore((s) => s.createFile);
  const createFolder = useEditorStore((s) => s.createFolder);
  const deleteFileAction = useEditorStore((s) => s.deleteFile);
  const renameFileAction = useEditorStore((s) => s.renameFile);
  const markDirty = useEditorStore((s) => s.markDirty);
  const user = useAuthStore((s) => s.user);
  const username = user?.username;
  const isAdmin = !!user?.isAdmin;
  const currentProject = useProjectStore((s) => s.currentProject);
  const isOwner = !!(username && currentProject && currentProject.owner === username);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const pdfPanelOpen = useUiStore((s) => s.pdfPanelOpen);
  const aiDockExpanded = useUiStore((s) => s.aiDockExpanded);
  const aiDockVisible = useUiStore((s) => s.aiDockVisible);
  const setAiDockExpanded = useUiStore((s) => s.setAiDockExpanded);
  const setAiDockVisible = useUiStore((s) => s.setAiDockVisible);
  const setCompileStatus = useUiStore((s) => s.setCompileStatus);
  const compiler = useUiStore((s) => s.compiler);
  const addToast = useUiStore((s) => s.addToast);
  const editorFontSize = useUiStore((s) => s.editorFontSize);
  const setEditorFontSize = useUiStore((s) => s.setEditorFontSize);
  const collabManagerOpen = useUiStore((s) => s.collabManagerOpen);
  const toggleCollabManager = useUiStore((s) => s.toggleCollabManager);
  const panelWidths = useUiStore((s) => s.panelWidths);
  const setPanelWidth = useUiStore((s) => s.setPanelWidth);
  const onlineUsers = useCollabStore((s) => s.onlineUsers);

  const contentRef = useRef<string>('');
  const editorRef = useRef<CodeEditorHandle>(null);
  const [searchOpen, setSearchOpen] = useState(false);


  const handleJumpToLine = useCallback((line: number) => {
    editorRef.current?.jumpToLine(line);
  }, []);

  const handleSearchJump = useCallback((file: string, line: number) => {
    if (!id) return;
    openFile(id, file);
    setTimeout(() => editorRef.current?.jumpToLine(line), 100);
  }, [id, openFile]);

  // Resize handlers for draggable panels
  const handleSidebarResize = useCallback(
    (dx: number) => {
      setPanelWidth('sidebar', Math.max(160, Math.min(480, panelWidths.sidebar + dx)));
    },
    [panelWidths.sidebar, setPanelWidth],
  );

  const handlePdfResize = useCallback(
    (dx: number) => {
      setPanelWidth('pdf', Math.max(240, Math.min(900, panelWidths.pdf - dx)));
    },
    [panelWidths.pdf, setPanelWidth],
  );


  const editorStackRef = useRef<HTMLDivElement>(null);
  const editorStackWrapRef = useRef<HTMLDivElement>(null);
  const [aiDockHeight, setAiDockHeight] = useState(0);

  const ensureAiDockHeight = useCallback(() => {
    const el = editorStackWrapRef.current;
    if (!el) return;
    const height = el.clientHeight;
    if (height <= 0) return;
    const target = Math.round(height * 0.35);
    const clamped = Math.max(56, Math.min(height, target));
    setAiDockHeight(clamped);
  }, []);

  useEffect(() => {
    if (aiDockExpanded) {
      ensureAiDockHeight();
    }
  }, [aiDockExpanded, ensureAiDockHeight]);

  const handleAiDockResize = useCallback(
    (dy: number) => {
      const el = editorStackWrapRef.current;
      if (!el) return;
      const height = el.clientHeight;
      if (height <= 0) return;
      const next = Math.max(56, Math.min(height, aiDockHeight - dy));
      setAiDockHeight(next);
    },
    [aiDockHeight],
  );

  // Local state for compile results
  const [pdfExists, setPdfExists] = useState(false);
  const [compileLog, setCompileLog] = useState('');
  const [pdfKey, setPdfKey] = useState(0);

  // Initialize project and file tree on mount
  useEffect(() => {
    if (!id) return;
    selectProject(id);
    fetchTree(id);
  }, [id, selectProject, fetchTree]);

  // Handle file selection from tree
  const handleFileSelect = useCallback(
    (path: string) => {
      if (!id) return;
      openFile(id, path);
    },
    [id, openFile],
  );

  // Handle file CRUD
  const handleCreateFile = useCallback(
    (path: string) => {
      if (!id) return;
      createFile(id, path).then(
        () => addToast(`Created ${path}`, 'success'),
        () => addToast('Create failed', 'error'),
      );
    },
    [id, createFile, addToast],
  );

  const handleCreateFolder = useCallback(
    (path: string) => {
      if (!id) return;
      createFolder(id, path).then(
        () => addToast(`Created folder ${path}`, 'success'),
        () => addToast('Create folder failed', 'error'),
      );
    },
    [id, createFolder, addToast],
  );

  const handleDeleteFile = useCallback(
    (path: string) => {
      if (!id) return;
      deleteFileAction(id, path).then(
        () => addToast(`Deleted ${path}`, 'success'),
        () => addToast('Delete failed', 'error'),
      );
    },
    [id, deleteFileAction, addToast],
  );

  const handleRenameFile = useCallback(
    (from: string, to: string) => {
      if (!id) return;
      renameFileAction(id, from, to).then(
        () => addToast(`Renamed to ${to}`, 'success'),
        () => addToast('Rename failed', 'error'),
      );
    },
    [id, renameFileAction, addToast],
  );

  // Move file (rename path)
  const handleMoveFile = useCallback(
    (from: string, to: string) => {
      if (!id) return;
      renameFileAction(id, from, to).then(
        () => addToast(`Moved to ${to}`, 'success'),
        () => addToast('Move failed', 'error'),
      );
    },
    [id, renameFileAction, addToast],
  );

  // Upload handler for drag-and-drop
  const handleUpload = useCallback(
    (droppedFiles: File[], targetDir?: string) => {
      if (!id) return;
      uploadFiles(id, droppedFiles, targetDir).then(
        (res) => {
          if (res.uploaded.length > 0) {
            addToast(`Uploaded ${res.uploaded.length} file(s)`, 'success');
            fetchTree(id);
          }
          for (const err of res.errors) {
            addToast(`Upload error: ${err.file} - ${err.error}`, 'error');
          }
        },
        () => addToast('Upload failed', 'error'),
      );
    },
    [id, addToast, fetchTree],
  );

  // Track current content for saving
  const activeContent = activeFile ? openFiles.get(activeFile) ?? '' : '';

  // Extract labels and bib keys from all open files for ref/cite completion
  const projectLabels = useMemo(() => {
    const labels: string[] = [];
    const bibKeys: string[] = [];
    openFiles.forEach((content, path) => {
      if (path.endsWith('.tex')) {
        labels.push(...extractLabels(content));
      } else if (path.endsWith('.bib')) {
        bibKeys.push(...extractBibKeys(content));
      }
    });
    return { labels, bibKeys };
  }, [openFiles]);

  const handleChange = useCallback(
    (value: string) => {
      contentRef.current = value;
      if (activeFile) {
        markDirty(activeFile);
      }
    },
    [activeFile, markDirty],
  );

  const handleUndo = useCallback(() => {
    editorRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    editorRef.current?.redo();
  }, []);

  const handleInsert = useCallback((text: string, wrapSelection?: boolean) => {
    editorRef.current?.insertText(text, wrapSelection);
  }, []);

  // Compile handler
  const handleCompile = useCallback(async () => {
    if (!id) return;
    setCompileStatus('compiling');
    try {
      const res = await compile(id, { compiler });
      const log = [res.stdout, res.stderr].filter(Boolean).join('\n');
      setCompileLog(log);
      setPdfExists(res.pdfExists);
      if (res.ok && res.pdfExists) {
        setCompileStatus('success');
        setPdfKey((k) => k + 1);
        addToast('Compilation successful', 'success');
      } else {
        setCompileStatus('error');
        addToast('Compilation failed (exit code ' + res.code + ')', 'error');
      }
    } catch {
      setCompileStatus('error');
      setCompileLog('Compile request failed. Check your connection.');
      addToast('Compile request failed', 'error');
    }
  }, [id, compiler, setCompileStatus, addToast]);

  // Refresh PDF without recompiling
  const handlePdfRefresh = useCallback(() => {
    setPdfKey((k) => k + 1);
  }, []);

  // Ctrl+S save handler and Ctrl+Shift+B compile shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!id || !activeFile) return;
        saveFile(id, activeFile, contentRef.current).then(
          () => addToast('File saved', 'success'),
          () => addToast('Save failed', 'error'),
        );
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        handleCompile();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [id, activeFile, saveFile, addToast, handleCompile]);

  // Listen for compile event from Header button
  useEffect(() => {
    const onCompileEvent = () => handleCompile();
    window.addEventListener('aitex:compile', onCompileEvent);
    return () => window.removeEventListener('aitex:compile', onCompileEvent);
  }, [handleCompile]);

  // Listen for AI compile-done to refresh PDF
  useEffect(() => {
    const onAiCompileDone = () => {
      setPdfExists(true);
      setPdfKey((k) => k + 1);
    };
    window.addEventListener('aitex:compile-done', onAiCompileDone);
    return () => window.removeEventListener('aitex:compile-done', onAiCompileDone);
  }, []);

  // Listen for AI reject → revert file to old content
  useEffect(() => {
    const onRevert = (e: Event) => {
      const { path, content } = (e as CustomEvent).detail as { path: string; content: string };
      if (id && path && typeof content === 'string') {
        saveFile(id, path, content);
        addToast(`Reverted ${path}`, 'info');
      }
    };
    window.addEventListener('aitex:revert-file', onRevert);
    return () => window.removeEventListener('aitex:revert-file', onRevert);
  }, [id, saveFile, addToast]);

  const roleLabel = isAdmin ? 'Admin' : isOwner ? 'Owner' : 'Member';
  const userInitial = (username || 'U').slice(0, 1).toUpperCase();
  const onlinePreview = onlineUsers.slice(0, 4);

  return (
    <div className="editor-page">
      {sidebarOpen && (
        <>
          <aside
            className="editor-page__sidebar"
            style={{ width: panelWidths.sidebar }}
          >
            <div className="editor-page__sidebar-main">
              <FileTree
                files={fileTree}
                activeFile={activeFile}
                isOwner={isOwner}
                projectName={currentProject?.name}
                downloadUrl={currentProject ? getDownloadUrl(currentProject.id) : undefined}
                onSelect={handleFileSelect}
                onCreateFile={handleCreateFile}
                onCreateFolder={handleCreateFolder}
                onDeleteFile={handleDeleteFile}
                onRenameFile={handleRenameFile}
                onMoveFile={handleMoveFile}
                onUpload={handleUpload}
                onShare={toggleCollabManager}
              />
            </div>

            <div className="editor-page__sidebar-footer">
              <div className="editor-page__identity">
                <span className="editor-page__identity-avatar">{userInitial}</span>
                <span className="editor-page__identity-main">
                  <span className="editor-page__identity-name">{username || 'user'}</span>
                  <span className="editor-page__identity-role">{roleLabel}</span>
                </span>
                <button
                  type="button"
                  className="editor-page__collab-btn"
                  onClick={toggleCollabManager}
                  title="Open collaborators"
                >
                  协同
                </button>
              </div>

              <div className="editor-page__presence">
                <span className="editor-page__presence-label">实时在线</span>
                <span className="editor-page__presence-stack">
                  {onlinePreview.length > 0 ? (
                    onlinePreview.map((member, index) => (
                      <span
                        key={member.clientId}
                        className="editor-page__presence-avatar"
                        style={{ backgroundColor: member.color, zIndex: onlinePreview.length - index }}
                        title={member.name}
                      >
                        {member.name.slice(0, 1).toUpperCase()}
                      </span>
                    ))
                  ) : (
                    <span className="editor-page__presence-avatar editor-page__presence-avatar--empty">•</span>
                  )}
                  <span className="editor-page__presence-count" title="Online users">
                    {onlineUsers.length}
                  </span>
                </span>
              </div>
            </div>
          </aside>
          <ResizeHandle onResize={handleSidebarResize} />
        </>
      )}
      <main className="editor-page__main">
        <TabBar />
        <ChangeBanner />
        <EditorToolbar
          onInsert={handleInsert}
          onUndo={handleUndo}
          onRedo={handleRedo}
          fontSize={editorFontSize}
          onFontSizeChange={setEditorFontSize}
          disabled={!activeFile}
        />
        <div className="editor-page__content editor-page__content--stack" ref={editorStackWrapRef}>
          {id && (
            <SearchPanel
              projectId={id}
              visible={searchOpen}
              onClose={() => setSearchOpen(false)}
              onJump={handleSearchJump}
            />
          )}
          <div className="editor-page__editor-surface" ref={editorStackRef}>
            {activeFile ? (
              <CodeEditor
                ref={editorRef}
                key={activeFile}
                content={activeContent}
                onChange={handleChange}
                language={getLanguage(activeFile)}
                labels={projectLabels.labels}
                bibKeys={projectLabels.bibKeys}
                compileLog={compileLog}
                activeFile={activeFile ?? undefined}
              />
            ) : (
              <div className="editor-page__empty">
                Select a file to start editing
              </div>
            )}
          </div>
          {id && aiDockVisible && (
            <div
              className={`editor-page__ai-dock${aiDockExpanded ? ' editor-page__ai-dock--expanded' : ' editor-page__ai-dock--collapsed'}`}
              style={{ height: aiDockExpanded ? aiDockHeight : 56 }}
            >
              {aiDockExpanded && (
                <ResizeHandle
                  onResize={handleAiDockResize}
                  axis="y"
                  className="resize-handle--row editor-page__ai-dock-resize"
                />
              )}
              <div className="editor-page__ai-dock-panel">
                <AiChatPanel
                  projectId={id}
                  onActivate={() => {
                    setAiDockVisible(true);
                    setAiDockExpanded(true);
                    ensureAiDockHeight();
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <UndoBar />
      </main>
      {pdfPanelOpen && id && (
        <>
          <ResizeHandle onResize={handlePdfResize} />
          <aside
            className="editor-page__pdf-panel"
            style={{ width: panelWidths.pdf }}
          >
            <PdfPreview
              key={pdfKey}
              projectId={id}
              pdfExists={pdfExists}
              compileLog={compileLog}
              onRefresh={handlePdfRefresh}
              onJumpToLine={(_file, line) => handleJumpToLine(line)}
            />
          </aside>
        </>
      )}
      {collabManagerOpen && id && (
        <CollabManager projectId={id} onClose={toggleCollabManager} />
      )}
    </div>
  );
}
