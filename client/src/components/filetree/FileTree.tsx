import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import './FileTree.css';

interface FileTreeProps {
  files: string[];
  activeFile: string | null;
  isOwner: boolean;
  projectName?: string;
  downloadUrl?: string;
  onSelect: (path: string) => void;
  onCreateFile?: (path: string) => void;
  onCreateFolder?: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  onRenameFile?: (from: string, to: string) => void;
  onMoveFile?: (from: string, to: string) => void;
  onUpload?: (files: File[], targetDir?: string) => void;
  onShare?: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode | null;       // null = background right-click
  showMoveMenu?: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isDir: boolean;
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const raw of paths) {
    const isExplicitDir = raw.endsWith('/');
    const p = isExplicitDir ? raw.slice(0, -1) : raw;
    if (!p) continue;

    const parts = p.split('/');
    let current = root;
    let accumulated = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      const isLast = i === parts.length - 1;
      const isDir = !isLast || isExplicitDir;
      let node = current.find((n) => n.name === part && n.isDir === isDir);
      if (!node) {
        node = { name: part, path: accumulated, children: [], isDir };
        current.push(node);
      }
      current = node.children;
    }
  }
  return sortTree(root);
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((n) => ({ ...n, children: sortTree(n.children) }))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function fileTypeClass(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.tex': case '.sty': case '.cls': case '.dtx':
      return 'ft-icon--tex';
    case '.bib':
      return 'ft-icon--bib';
    case '.pdf':
      return 'ft-icon--pdf';
    case '.png': case '.jpg': case '.jpeg': case '.gif': case '.svg': case '.eps':
      return 'ft-icon--img';
    case '.json': case '.yaml': case '.yml': case '.toml':
      return 'ft-icon--config';
    case '.md': case '.txt': case '.log':
      return 'ft-icon--text';
    default:
      return '';
  }
}

function fileTypeLabel(name: string): string | null {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.tex': return 'TEX';
    case '.sty': return 'STY';
    case '.cls': return 'CLS';
    case '.bib': return 'BIB';
    case '.pdf': return 'PDF';
    case '.png': return 'PNG';
    case '.jpg': case '.jpeg': return 'JPG';
    case '.svg': return 'SVG';
    case '.eps': return 'EPS';
    default: return null;
  }
}

/* ── Icons ─────────────────────────────────────────────────────── */

function FolderOpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 14h13l.5-.5V6l-.5-.5H7.7l-2-2H1.5l-.5.5v9.5l.5.5zM2 5h3.3l2 2H14v6H2V5z" />
    </svg>
  );
}

function FolderClosedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M14.5 3H7.7l-2-2H1.5l-.5.5v11l.5.5h13l.5-.5V3.5l-.5-.5zM14 12H2V4h3.3l2 2H14v6z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M10 1H3.5l-.5.5v13l.5.5h9l.5-.5V4l-3-3zm2 13H4V2h5v3h3v9z" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 3l5 5-5 5V3z" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 6l5 5 5-5H3z" />
    </svg>
  );
}

/* ── TreeItem ──────────────────────────────────────────────────── */

function TreeItem({
  node,
  activeFile,
  onSelect,
  onDeleteFile,
  onRenameFile,
  onContextMenu,
  depth,
}: {
  node: TreeNode;
  activeFile: string | null;
  onSelect: (path: string) => void;
  onDeleteFile?: (path: string) => void;
  onRenameFile?: (from: string, to: string) => void;
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(node.name);

  const isActive = node.path === activeFile;
  const label = fileTypeLabel(node.name);
  const typeClass = fileTypeClass(node.name);

  const handleClick = () => {
    if (node.isDir) {
      setOpen((v) => !v);
    } else {
      onSelect(node.path);
    }
  };

  const handleRenameSubmit = () => {
    if (renameVal && renameVal !== node.name && onRenameFile) {
      const dir = node.path.includes('/')
        ? node.path.slice(0, node.path.lastIndexOf('/') + 1)
        : '';
      onRenameFile(node.path, dir + renameVal);
    }
    setRenaming(false);
  };

  return (
    <>
      <div
        className={`ft-item${isActive ? ' ft-item--active' : ''}`}
        style={{ paddingLeft: depth * 16 + 10 }}
        onClick={handleClick}
        onContextMenu={(e) => {
          if (onContextMenu) {
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(e, node);
          }
        }}
        onDoubleClick={() => {
          if (!node.isDir && onRenameFile) {
            setRenaming(true);
            setRenameVal(node.name);
          }
        }}
      >
        {/* Indent guides */}
        {Array.from({ length: depth }, (_, i) => (
          <span
            key={i}
            className="ft-indent"
            style={{ left: i * 16 + 16 }}
          />
        ))}

        {/* Chevron for dirs */}
        {node.isDir && (
          <span className="ft-chevron">
            {open ? <ChevronDown /> : <ChevronRight />}
          </span>
        )}

        {/* Icon */}
        <span className={`ft-icon ${node.isDir ? 'ft-icon--dir' : typeClass}`}>
          {node.isDir ? (open ? <FolderOpenIcon /> : <FolderClosedIcon />) : <FileIcon />}
        </span>

        {/* Name or rename input */}
        {renaming ? (
          <input
            className="ft-rename-input"
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') setRenaming(false);
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span className="ft-name">{node.name}</span>
            {!node.isDir && label && (
              <span className={`ft-tag ${typeClass}`}>{label}</span>
            )}
          </>
        )}

        {/* Delete button */}
        {!node.isDir && onDeleteFile && (
          <button
            className="ft-delete"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete ${node.path}?`)) onDeleteFile(node.path);
            }}
            title="Delete"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 7.22L11.78 3.44 12.56 4.22 8.78 8l3.78 3.78-.78.78L8 8.78 4.22 12.56l-.78-.78L7.22 8 3.44 4.22l.78-.78L8 7.22z" />
            </svg>
          </button>
        )}
      </div>

      {node.isDir && open &&
        node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            activeFile={activeFile}
            onSelect={onSelect}
            onDeleteFile={onDeleteFile}
            onRenameFile={onRenameFile}
            onContextMenu={onContextMenu}
            depth={depth + 1}
          />
        ))}
    </>
  );
}

/* ── FileTree (main) ───────────────────────────────────────────── */

export default function FileTree({
  files,
  activeFile,
  isOwner,
  downloadUrl,
  onSelect,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onMoveFile,
  onUpload,
  onShare,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [showNew, setShowNew] = useState<false | 'file' | 'folder'>(false);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  // Collect all folder paths for move menu
  const folderPaths = useMemo(() => {
    const dirs: string[] = [''];  // root
    function walk(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.isDir) { dirs.push(n.path); walk(n.children); }
      }
    }
    walk(tree);
    return dirs;
  }, [tree]);

  const handleNewSubmit = () => {
    const name = newName.trim();
    if (!name) {
      setShowNew(false);
      setNewParent('');
      return;
    }
    const fullPath = newParent ? `${newParent}/${name}` : name;
    if (showNew === 'folder') {
      onCreateFolder?.(fullPath);
    } else {
      onCreateFile?.(fullPath);
    }
    setNewName('');
    setNewParent('');
    setShowNew(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0 && onUpload) {
      onUpload(Array.from(e.dataTransfer.files));
    }
  };

  const handleUploadClick = () => {
    uploadRef.current?.click();
    setShowMenu(false);
  };

  const handleUploadChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0 && onUpload) {
      onUpload(Array.from(fileList));
    }
    e.target.value = '';
  };

  // Right-click context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    if (!isOwner) return;
    setCtxMenu({ x: e.clientX, y: e.clientY, node });
  }, [isOwner]);

  // Background right-click (no node)
  const handleBgContextMenu = useCallback((e: React.MouseEvent) => {
    if (!isOwner) return;
    // Only if clicking on the list background, not a tree item
    if ((e.target as HTMLElement).closest('.ft-item')) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, node: null });
  }, [isOwner]);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu]);

  // Close add menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  return (
    <div
      className="ft"
      onDragOver={(e) => { if (isOwner) e.preventDefault(); }}
      onDrop={isOwner ? handleDrop : undefined}
    >
      {/* ── Toolbar: Files label + actions ── */}
      <div className="ft-toolbar">
        <span className="ft-toolbar__label">Files</span>
        <div className="ft-toolbar__actions">
          {onShare && (
            <button className="ft-toolbar__btn" onClick={onShare} title="Share project" type="button">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="3" r="2" />
                <circle cx="12" cy="13" r="2" />
                <circle cx="4" cy="8" r="2" />
                <path d="M5.8 6.9L10.2 4.1M5.8 9.1L10.2 11.9" />
              </svg>
            </button>
          )}
          {downloadUrl && (
            <a className="ft-toolbar__btn" href={downloadUrl} title="Download ZIP">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 2v8M5 7l3 3 3-3" />
                <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
              </svg>
            </a>
          )}
          {isOwner && (
            <div className="ft-add-menu-wrap" ref={menuRef}>
              <button
                className="ft-toolbar__btn"
                onClick={() => setShowMenu((v) => !v)}
                title="New..."
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </button>
              {showMenu && (
                <div className="ft-add-menu">
                  <button
                    className="ft-add-menu__item"
                    onClick={() => {
                      setShowNew('file');
                      setShowMenu(false);
                    }}
                  >
                    <FileIcon /> New File
                  </button>
                  <button
                    className="ft-add-menu__item"
                    onClick={() => {
                      setShowNew('folder');
                      setShowMenu(false);
                    }}
                  >
                    <FolderClosedIcon /> New Folder
                  </button>
                  <button
                    className="ft-add-menu__item"
                    onClick={handleUploadClick}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M8 10V3M5 5l3-3 3 3" />
                      <path d="M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" />
                    </svg>
                    Upload
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>


      {/* Hidden upload input */}
      <input
        ref={uploadRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleUploadChange}
      />

      {/* ── New file/folder input ── */}
      {showNew && (
        <div className="ft-new-row">
          <span className="ft-new-icon">
            {showNew === 'folder' ? <FolderClosedIcon /> : <FileIcon />}
          </span>
          <input
            className="ft-new-input"
            placeholder={showNew === 'folder' ? 'Folder name...' : 'File name...'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleNewSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNewSubmit();
              if (e.key === 'Escape') { setShowNew(false); setNewName(''); }
            }}
            autoFocus
          />
        </div>
      )}

      {/* ── File tree list ── */}
      <div className="ft-list" onContextMenu={handleBgContextMenu}>
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            activeFile={activeFile}
            onSelect={onSelect}
            onDeleteFile={isOwner ? onDeleteFile : undefined}
            onRenameFile={isOwner ? onRenameFile : undefined}
            onContextMenu={isOwner ? handleContextMenu : undefined}
            depth={0}
          />
        ))}
        {tree.length === 0 && (
          <div className="ft-empty">No files yet</div>
        )}
      </div>

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="ft-ctx-menu"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
        >
          {/* New File */}
          <button
            className="ft-ctx-menu__item"
            onClick={() => {
              const parent = ctxMenu.node?.isDir ? ctxMenu.node.path : '';
              setNewParent(parent);
              setShowNew('file');
              setCtxMenu(null);
            }}
          >
            New File
          </button>
          {/* New Folder */}
          <button
            className="ft-ctx-menu__item"
            onClick={() => {
              const parent = ctxMenu.node?.isDir ? ctxMenu.node.path : '';
              setNewParent(parent);
              setShowNew('folder');
              setCtxMenu(null);
            }}
          >
            New Folder
          </button>

          {ctxMenu.node && (
            <>
              <div className="ft-ctx-menu__sep" />
              {/* Rename */}
              {onRenameFile && (
                <button
                  className="ft-ctx-menu__item"
                  onClick={() => {
                    const name = prompt('Rename to:', ctxMenu.node!.name);
                    if (name && name !== ctxMenu.node!.name) {
                      const dir = ctxMenu.node!.path.includes('/')
                        ? ctxMenu.node!.path.slice(0, ctxMenu.node!.path.lastIndexOf('/') + 1)
                        : '';
                      onRenameFile(ctxMenu.node!.path, dir + name);
                    }
                    setCtxMenu(null);
                  }}
                >
                  Rename
                </button>
              )}
              {/* Move to... */}
              {onMoveFile && !ctxMenu.showMoveMenu && (
                <button
                  className="ft-ctx-menu__item"
                  onClick={() => setCtxMenu((s) => s ? { ...s, showMoveMenu: true } : s)}
                >
                  Move to...
                </button>
              )}
              {ctxMenu.showMoveMenu && onMoveFile && (
                <div className="ft-ctx-submenu">
                  {folderPaths
                    .filter((d) => {
                      const nodePath = ctxMenu.node!.path;
                      const nodeDir = nodePath.includes('/') ? nodePath.slice(0, nodePath.lastIndexOf('/')) : '';
                      return d !== nodeDir && !d.startsWith(nodePath + '/');
                    })
                    .map((d) => (
                      <button
                        key={d}
                        className="ft-ctx-menu__item"
                        onClick={() => {
                          const name = ctxMenu.node!.name;
                          const dest = d ? `${d}/${name}` : name;
                          onMoveFile!(ctxMenu.node!.path, dest);
                          setCtxMenu(null);
                        }}
                      >
                        {d || '/ (root)'}
                      </button>
                    ))}
                </div>
              )}
              {/* Delete */}
              {onDeleteFile && (
                <>
                  <div className="ft-ctx-menu__sep" />
                  <button
                    className="ft-ctx-menu__item ft-ctx-menu__item--danger"
                    onClick={() => {
                      if (confirm(`Delete ${ctxMenu.node!.path}?`)) {
                        onDeleteFile(ctxMenu.node!.path);
                      }
                      setCtxMenu(null);
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
