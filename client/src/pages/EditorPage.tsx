import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { compile, getDownloadUrl, uploadFiles } from '@/api/client';
import ChangeBanner from '@/components/editor/ChangeBanner';
import type { CodeEditorHandle } from '@/components/editor/CodeEditor';
import CompileLog from '@/components/pdf/CompileLog';
import TabBar from '@/components/editor/TabBar';
import UndoBar from '@/components/editor/UndoBar';
import FileTree from '@/components/filetree/FileTree';
import ResizeHandle from '@/components/layout/ResizeHandle';
import ConversationList from '@/components/ai/ConversationList';
import { extractBibKeys, extractLabels } from '@/lib/tex-labels';
import { useAuthStore } from '@/stores/authStore';
import { useConversationStore } from '@/stores/conversationStore';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import './EditorPage.css';

const CodeEditor = lazy(() => import('@/components/editor/CodeEditor'));
const PdfPreview = lazy(() => import('@/components/pdf/PdfPreview'));
const AiChatPanel = lazy(() => import('@/components/ai/AiChatPanel'));
const SearchPanel = lazy(() => import('@/components/editor/SearchPanel'));
const CollabManager = lazy(() => import('@/components/collab/CollabManager'));

function getLanguage(path: string): string | undefined {
  if (path.endsWith('.tex') || path.endsWith('.sty') || path.endsWith('.cls')) {
    return 'tex';
  }
  return undefined;
}

function PanelSkeleton({ label }: { label: string }) {
  return <div className="editor-page__panel-skeleton">Loading {label}...</div>;
}

type SidebarTab = 'chat' | 'cowork';

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ensureCurrentProject = useProjectStore((s) => s.ensureCurrentProject);
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
  const currentProject = useProjectStore((s) => s.currentProject);
  const isOwner = !!(username && currentProject && currentProject.owner === username);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const inspectorView = useUiStore((s) => s.inspectorView);
  const setInspectorView = useUiStore((s) => s.setInspectorView);
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  const compileStatus = useUiStore((s) => s.compileStatus);
  const setCompileStatus = useUiStore((s) => s.setCompileStatus);
  const compiler = useUiStore((s) => s.compiler);
  const addToast = useUiStore((s) => s.addToast);
  const collabManagerOpen = useUiStore((s) => s.collabManagerOpen);
  const toggleCollabManager = useUiStore((s) => s.toggleCollabManager);
  const panelWidths = useUiStore((s) => s.panelWidths);
  const setPanelWidth = useUiStore((s) => s.setPanelWidth);
  const initConversationProject = useConversationStore((s) => s.initProject);

  const contentRef = useRef<string>('');
  const editorRef = useRef<CodeEditorHandle>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('cowork');
  const [compileLogOpen, setCompileLogOpen] = useState(false);
  const [compileLogHeight, setCompileLogHeight] = useState(180);
  const compileLogDragRef = useRef<{ startY: number; startH: number } | null>(null);

  const handleJumpToLine = useCallback((line: number) => {
    editorRef.current?.jumpToLine(line);
  }, []);

  const handleSearchJump = useCallback((file: string, line: number) => {
    if (!id) return;
    openFile(id, file);
    setTimeout(() => editorRef.current?.jumpToLine(line), 100);
  }, [id, openFile]);

  const handleSidebarResize = useCallback(
    (dx: number) => {
      setPanelWidth('sidebar', Math.max(160, Math.min(480, panelWidths.sidebar + dx)));
    },
    [panelWidths.sidebar, setPanelWidth],
  );

  const handleInspectorResize = useCallback(
    (dx: number) => {
      const w = panelWidths.inspector;
      setPanelWidth('inspector', Math.max(240, Math.min(900, w - dx)));
    },
    [panelWidths.inspector, setPanelWidth],
  );

  const [pdfExists, setPdfExists] = useState(false);
  const [compileLog, setCompileLog] = useState('');
  const [compileDiagnostics, setCompileDiagnostics] = useState<Array<{ type: string; severity: string; message: string; suggestion?: string }>>([]);
  const [pdfKey, setPdfKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    ensureCurrentProject(id);
    fetchTree(id);
    initConversationProject(id);
  }, [id, ensureCurrentProject, fetchTree, initConversationProject]);

  const handleFileSelect = useCallback(
    (path: string) => {
      if (!id) return;
      openFile(id, path);
    },
    [id, openFile],
  );

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

  const activeContent = activeFile ? openFiles.get(activeFile) ?? '' : '';

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

  const handleCompile = useCallback(async () => {
    if (!id) return;
    // Auto-save current file before compiling
    if (activeFile && contentRef.current) {
      try {
        await saveFile(id, activeFile, contentRef.current);
      } catch {
        // save failed, try to compile anyway
      }
    }
    setCompileStatus('compiling');
    try {
      const res = await compile(id, { compiler });
      const log = [res.stdout, res.stderr].filter(Boolean).join('\n');
      setCompileLog(log);
      setPdfExists(res.pdfExists);
      setCompileDiagnostics(res.diagnostics || []);
      if (res.ok && res.pdfExists) {
        setCompileStatus('success');
        setPdfKey((k) => k + 1);
        addToast('Compilation successful', 'success');
      } else {
        setCompileStatus('error');

        // Use server diagnostics for better error messages
        const diag = res.diagnostics as Array<{ type: string; severity: string; message: string; suggestion?: string }> | undefined;
        const primaryHint = diag?.find((d) => d.severity === 'error') || diag?.[0];

        let errMsg: string;
        if (primaryHint) {
          errMsg = primaryHint.message;
          // If suggestion is to switch compiler, auto-suggest in toast
          if (primaryHint.suggestion === 'xelatex' && compiler !== 'xelatex') {
            errMsg += ' [Use compiler dropdown to switch]';
          }
        } else {
          errMsg = 'Compilation failed';
          if (res.code !== 0) {
            errMsg += ` (exit code ${res.code})`;
          } else if (!res.pdfExists) {
            errMsg += ': PDF not generated';
          }
          const errLine = log
            .split('\n')
            .find((l) => /^!|error|fatal|undefined control/i.test(l));
          if (errLine) {
            errMsg += ` — ${errLine.trim().slice(0, 80)}`;
          }
        }

        addToast(errMsg, 'error');
        // Auto-open compile log on error
        setCompileLogOpen(true);
        if (inspectorOpen) {
          setInspectorView('pdf');
        }
      }
    } catch {
      setCompileStatus('error');
      setCompileLog('Compile request failed. Check your connection.');
      addToast('Compile request failed — server unreachable', 'error');
    }
  }, [id, activeFile, saveFile, compiler, setCompileStatus, addToast, inspectorOpen, setInspectorView]);

  const handlePdfRefresh = useCallback(() => {
    setPdfKey((k) => k + 1);
  }, []);

  // Ctrl+S / Ctrl+Shift+B / Ctrl+Shift+F shortcuts
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

  useEffect(() => {
    const onCompileEvent = () => handleCompile();
    window.addEventListener('aitex:compile', onCompileEvent);
    return () => window.removeEventListener('aitex:compile', onCompileEvent);
  }, [handleCompile]);

  useEffect(() => {
    const onAiCompileDone = () => {
      setPdfExists(true);
      setPdfKey((k) => k + 1);
    };
    window.addEventListener('aitex:compile-done', onAiCompileDone);
    return () => window.removeEventListener('aitex:compile-done', onAiCompileDone);
  }, []);

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

  // Compile log vertical drag-to-resize
  const handleCompileLogDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    compileLogDragRef.current = { startY: e.clientY, startH: compileLogHeight };
    const onMove = (ev: MouseEvent) => {
      if (!compileLogDragRef.current) return;
      const dy = compileLogDragRef.current.startY - ev.clientY;
      setCompileLogHeight(Math.max(80, Math.min(500, compileLogDragRef.current.startH + dy)));
    };
    const onUp = () => {
      compileLogDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [compileLogHeight]);

  const inspectorWidth = panelWidths.inspector;
  const userInitial = username ? username.charAt(0).toUpperCase() : '?';

  return (
    <div className="editor-page">
      {/* ── Left sidebar ── */}
      {sidebarOpen && (
        <>
          <aside
            className="editor-page__sidebar"
            style={{ width: panelWidths.sidebar }}
          >
            {/* Brand */}
            <div className="editor-page__sidebar-brand">
              <button
                className="editor-page__sidebar-brand-link"
                onClick={() => navigate('/')}
                title="Back to projects"
              >
                <span className="editor-page__brand-text">Aitex</span>
                <span className="editor-page__brand-badge">AI</span>
              </button>
            </div>

            {/* Cowork / Chat toggle */}
            <div className="editor-page__sidebar-tabs">
              <button
                className={`editor-page__sidebar-tab${sidebarTab === 'cowork' ? ' editor-page__sidebar-tab--active' : ''}`}
                onClick={() => setSidebarTab('cowork')}
              >
                Cowork
              </button>
              <button
                className={`editor-page__sidebar-tab${sidebarTab === 'chat' ? ' editor-page__sidebar-tab--active' : ''}`}
                onClick={() => setSidebarTab('chat')}
              >
                Chat
              </button>
            </div>

            {/* Content: conversation history list or file tree */}
            <div className="editor-page__sidebar-content">
              {sidebarTab === 'chat' ? (
                <ConversationList />
              ) : (
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
              )}
            </div>

            {/* User footer */}
            <div className="editor-page__sidebar-footer">
              <div className="editor-page__sidebar-avatar">{userInitial}</div>
              <div className="editor-page__sidebar-user">
                <div className="editor-page__sidebar-username">{username || 'Guest'}</div>
                <div className="editor-page__sidebar-project">{currentProject?.name || 'No project'}</div>
              </div>
            </div>
          </aside>
          <ResizeHandle onResize={handleSidebarResize} />
        </>
      )}

      {/* ── Center panel: code editor ── */}
      <main className="editor-page__main">
        <TabBar compileLogOpen={compileLogOpen} onToggleCompileLog={() => setCompileLogOpen((v) => !v)} />
        <ChangeBanner />
        <div className="editor-page__content">
          <div className="editor-page__code-area">
            {id && (
              <Suspense fallback={<PanelSkeleton label="search" />}>
                <SearchPanel
                  projectId={id}
                  visible={searchOpen}
                  onClose={() => setSearchOpen(false)}
                  onJump={handleSearchJump}
                />
              </Suspense>
            )}
            {activeFile ? (
              <Suspense fallback={<PanelSkeleton label="editor" />}>
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
              </Suspense>
            ) : (
              <div className="editor-page__empty">
                Select a file to start editing
              </div>
            )}
          </div>

          {/* Compile output toggle bar + panel */}
          <div className="editor-page__compile-bar">
            <button
              className={`editor-page__compile-toggle${compileLogOpen ? ' editor-page__compile-toggle--active' : ''}`}
              onClick={() => setCompileLogOpen((v) => !v)}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="8" width="12" height="6" rx="1.5" />
                <line x1="4.5" y1="10.5" x2="8" y2="10.5" />
                <line x1="4.5" y1="12.5" x2="6.5" y2="12.5" />
              </svg>
              Compile Output
              {compileStatus === 'error' && <span className="editor-page__compile-dot editor-page__compile-dot--err" />}
              {compileStatus === 'success' && <span className="editor-page__compile-dot editor-page__compile-dot--ok" />}
            </button>
          </div>
          {compileLogOpen && (
            <div className="editor-page__compile-panel" style={{ height: compileLogHeight }}>
              <div
                className="editor-page__compile-drag"
                onMouseDown={handleCompileLogDragStart}
              />
              <CompileLog
                log={compileLog}
                visible={true}
                diagnostics={compileDiagnostics}
                onClose={() => setCompileLogOpen(false)}
                onJumpToLine={(_file, line) => handleJumpToLine(line)}
              />
            </div>
          )}

          <UndoBar />
        </div>
      </main>

      {/* ── Right inspector: PDF or AI (no header — toggled via TabBar) ── */}
      {inspectorOpen && id && (
        <>
          <ResizeHandle onResize={handleInspectorResize} />
          <aside
            className="editor-page__inspector"
            style={{ width: inspectorWidth }}
          >
            <div className="editor-page__inspector-body">
              {inspectorView === 'pdf' ? (
                <Suspense fallback={<PanelSkeleton label="preview" />}>
                  <PdfPreview
                    key={pdfKey}
                    projectId={id}
                    pdfExists={pdfExists}
                    onRefresh={handlePdfRefresh}
                  />
                </Suspense>
              ) : (
                <Suspense fallback={<PanelSkeleton label="AI" />}>
                  <AiChatPanel projectId={id} />
                </Suspense>
              )}
            </div>
          </aside>
        </>
      )}

      {/* ── Collab manager modal ── */}
      {collabManagerOpen && id && (
        <Suspense fallback={null}>
          <CollabManager projectId={id} onClose={toggleCollabManager} />
        </Suspense>
      )}
    </div>
  );
}
