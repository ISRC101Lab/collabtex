import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal, Spinner } from '@/components/common';
import ChevronIcon from '@/components/common/ChevronIcon';
import { WriteIcon, EditIcon, CompileIcon, FixIcon } from '@/components/common/Icons';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import {
  getProjectListPreferences,
  setProjectListPreferences,
  importProject,
  type ProjectListScope,
} from '@/api/client';
import type { Project } from '@/stores/projectStore';
import './ProjectListPage.css';

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <title>Search</title>
      <circle cx="9" cy="9" r="4.7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12.5 12.5L15.7 15.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function RenameIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <title>Rename</title>
      <path d="M13.9 3.5L16.5 6.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5 15.1L7.3 14.6L15.6 6.4L13 3.8L4.8 12.1L4.3 14.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.2 15.8H15.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function DeleteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <title>Delete</title>
      <path d="M5.8 6.2H14.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7.1 6.2V14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10 6.2V14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12.9 6.2V14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8 4.1H12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.6 6.2V14.3C6.6 14.9 7.1 15.4 7.7 15.4H12.3C12.9 15.4 13.4 14.9 13.4 14.3V6.2" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function MoreIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <title>More actions</title>
      <circle cx="5.2" cy="10" r="1.2" fill="currentColor" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" />
      <circle cx="14.8" cy="10" r="1.2" fill="currentColor" />
    </svg>
  );
}

type ActionMode = 'menu' | 'rename';

const SCOPE_ITEMS: { scope: ProjectListScope; label: string }[] = [
  { scope: 'all', label: 'All Projects' },
  { scope: 'owned', label: 'Your Projects' },
  { scope: 'shared', label: 'Shared with you' },
];

export default function ProjectListPage() {
  const navigate = useNavigate();
  const {
    projects,
    loading,
    fetchProjectsWithQuery,
    prefetchProjectsWithQuery,
    createProject,
    updateMeta,
    deleteProject,
  } = useProjectStore();

  const username = useAuthStore((s) => s.user?.username ?? 'user');
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false);
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);
  const addToast = useUiStore((s) => s.addToast);

  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);

  const [scope, setScope] = useState<ProjectListScope>('owned');
  const [prefsReady, setPrefsReady] = useState(false);
  const searchHydrated = useRef(false);

  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const newMenuRef = useRef<HTMLDivElement | null>(null);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountPanelMode, setAccountPanelMode] = useState<'menu' | 'switch'>('menu');
  const [switchUsername, setSwitchUsername] = useState('');
  const [switchPassword, setSwitchPassword] = useState('');
  const [switchingUser, setSwitchingUser] = useState(false);

  const [activeActionProjectId, setActiveActionProjectId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>('menu');
  const [actionName, setActionName] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const fetchByControls = useCallback(async (query: string, nextScope: ProjectListScope) => {
    await fetchProjectsWithQuery({
      q: query.trim() || undefined,
      scope: nextScope,
      sort: 'updated_desc',
    });
  }, [fetchProjectsWithQuery]);

  const closeActionMenu = useCallback(() => {
    setActiveActionProjectId(null);
    setActionMode('menu');
    setActionName('');
    setActionBusy(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const { prefs } = await getProjectListPreferences();
        if (cancelled) return;
        setScope(prefs.scope);
        await fetchProjectsWithQuery({ scope: prefs.scope, sort: 'updated_desc' });
      } catch {
        if (cancelled) return;
        try {
          await fetchProjectsWithQuery({ scope: 'owned', sort: 'updated_desc' });
        } catch {
          addToast('Failed to load projects.', 'error');
        }
      } finally {
        if (!cancelled) setPrefsReady(true);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [addToast, fetchProjectsWithQuery]);

  useEffect(() => {
    if (!prefsReady) return;
    if (!searchHydrated.current) {
      searchHydrated.current = true;
      return;
    }

    const handler = window.setTimeout(() => {
      fetchByControls(searchValue, scope).catch(() => {
        addToast('Search failed.', 'error');
      });
    }, 220);

    return () => window.clearTimeout(handler);
  }, [searchValue, prefsReady, fetchByControls, scope, addToast]);

  useEffect(() => {
    if (!prefsReady) return;

    prefetchProjectsWithQuery({
      scope: 'shared',
      sort: 'updated_desc',
    });
  }, [prefsReady, prefetchProjectsWithQuery]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (accountMenuRef.current && !accountMenuRef.current.contains(target)) {
        setAccountMenuOpen(false);
        setAccountPanelMode('menu');
        setSwitchUsername('');
        setSwitchPassword('');
      }
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!activeActionProjectId) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (actionMenuRef.current && !actionMenuRef.current.contains(target)) {
        closeActionMenu();
      }
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [activeActionProjectId, closeActionMenu]);

  useEffect(() => {
    if (!newMenuOpen) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (newMenuRef.current && !newMenuRef.current.contains(target)) {
        setNewMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [newMenuOpen]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const project = await createProject(newName.trim());
      setShowNewModal(false);
      setNewName('');
      navigate(`/project/${project.id}`);
    } catch {
      addToast('Could not create project.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleSubmitSwitchUser = async () => {
    if (!switchUsername.trim() || !switchPassword) return;
    setSwitchingUser(true);
    try {
      await login(switchUsername.trim(), switchPassword);
      // Force full reload to clear all in-memory stores (editor, projects, collab, AI history)
      window.location.replace('/');
    } catch {
      addToast('Switch user failed.', 'error');
    } finally {
      setSwitchingUser(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    // Force full reload to clear all in-memory stores
    window.location.replace('/login');
  };

  const handleScopeChange = (nextScope: ProjectListScope) => {
    if (nextScope === scope) return;

    setScope(nextScope);
    closeActionMenu();

    fetchByControls(searchValue, nextScope).catch(() => {
      addToast('Failed to switch scope.', 'error');
    });

    setProjectListPreferences({ scope: nextScope }).catch(() => {
      // keep navigation responsive even if preference write fails
    });
  };

  const importFromFile = async (file: File) => {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const imported = await importProject({
        name: file.name.replace(/\.zip$/i, ''),
        sourceType: 'zip',
        fileName: file.name,
        contentBase64: base64,
      });
      await fetchByControls(searchValue, scope);
      addToast(`Imported ${imported.importedCount} files`, 'success');
    } catch {
      addToast('Import failed.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleImportArchive = () => {
    if (importing) return;
    setNewMenuOpen(false);

    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.zip,application/zip';
    picker.onchange = async () => {
      const file = picker.files?.[0];
      if (!file) return;
      await importFromFile(file);
    };
    picker.click();
  };

  const toggleProjectActions = (project: Project) => {
    if (actionBusy) return;
    if (activeActionProjectId === project.id) {
      closeActionMenu();
      return;
    }
    setActiveActionProjectId(project.id);
    setActionMode('menu');
    setActionName(project.name);
  };

  const openRenamePanel = (project: Project) => {
    if (actionBusy) return;
    setActiveActionProjectId(project.id);
    setActionMode('rename');
    setActionName(project.name);
  };

  const handleRenameProject = async (projectId: string) => {
    const nextName = actionName.trim();
    if (!nextName || actionBusy) return;

    setActionBusy(true);
    try {
      await updateMeta(projectId, { name: nextName });
      addToast('Project renamed.', 'success');
      closeActionMenu();
    } catch {
      addToast('Could not rename project.', 'error');
      setActionBusy(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (actionBusy) return;

    setActionBusy(true);
    try {
      await deleteProject(projectId);
      addToast('Project deleted.', 'success');
      closeActionMenu();
    } catch {
      addToast('Could not delete project.', 'error');
      setActionBusy(false);
    }
  };

  const formatDate = (iso: string) => {
    const updatedAt = new Date(iso).getTime();
    const now = Date.now();
    const safeDiff = Math.max(0, now - updatedAt);

    const minutes = Math.floor(safeDiff / (1000 * 60));
    if (minutes < 60) {
      return `${Math.max(1, minutes)}m ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${Math.max(1, hours)}h ago`;
    }

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const avatarLetter = username.slice(0, 1).toUpperCase();
  const showOwnerMeta = scope !== 'owned' || isAdmin;

  const renderProjectActions = (project: Project) => {
    const isOpen = activeActionProjectId === project.id;

    return (
      <div
        className={`projects-table__actions${isOpen ? ' project-row__actions--open' : ''}`}
        ref={isOpen ? actionMenuRef : null}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className={`project-actions__trigger${isOpen ? ' project-actions__trigger--active' : ''}`}
          type="button"
          title="Project actions"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={(e) => {
            e.stopPropagation();
            toggleProjectActions(project);
          }}
        >
          <MoreIcon className="project-actions__trigger-icon" />
        </button>

        {isOpen && (
          <div className="project-actions__menu" role="menu">
            {actionMode === 'rename' ? (
              <fieldset className="project-actions__rename">
                <legend className="visually-hidden">Rename project</legend>
                <input
                  className="project-actions__rename-input"
                  value={actionName}
                  onChange={(e) => setActionName(e.target.value)}
                  placeholder="Project name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleRenameProject(project.id);
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      closeActionMenu();
                    }
                  }}
                />
                <div className="project-actions__rename-buttons">
                  <button
                    type="button"
                    className="project-actions__rename-btn"
                    onClick={closeActionMenu}
                    disabled={actionBusy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="project-actions__rename-btn project-actions__rename-btn--primary"
                    onClick={() => handleRenameProject(project.id)}
                    disabled={!actionName.trim() || actionBusy}
                  >
                    {actionBusy ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </fieldset>
            ) : (
              <>
                <button
                  type="button"
                  className="project-actions__item"
                  onClick={() => openRenamePanel(project)}
                  disabled={actionBusy}
                >
                  <RenameIcon className="project-actions__item-icon" />
                  Rename
                </button>
                <button
                  type="button"
                  className="project-actions__item project-actions__item--danger"
                  onClick={() => handleDeleteProject(project.id)}
                  disabled={actionBusy}
                >
                  <DeleteIcon className="project-actions__item-icon" />
                  {actionBusy ? 'Deleting...' : 'Delete'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  if (!prefsReady && loading && projects.length === 0) {
    return (
      <div className="projects-loading">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="projects-dashboard">
      {/* ── Navbar ── */}
      <nav className="projects-navbar">
        <span className="projects-navbar__brand">
          <span className="projects-navbar__brand-text">Aitex</span>
          <span className="projects-navbar__brand-badge">AI LaTeX</span>
        </span>

        <div className="projects-navbar__right" ref={accountMenuRef}>
          <button
            className="projects-nav__account"
            type="button"
            onClick={() => {
              const nextOpen = !accountMenuOpen;
              setAccountMenuOpen(nextOpen);
              if (nextOpen) setAccountPanelMode('menu');
            }}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
          >
            <span className="projects-nav__avatar-ring">
              <span className="projects-nav__avatar">{avatarLetter}</span>
            </span>
            <span className="projects-nav__identity">
              <span className="projects-nav__name">{username}</span>
              <span className="projects-nav__meta">
                {isAdmin ? 'Admin' : 'Personal'}
              </span>
            </span>
            <span
              className={`projects-nav__caret${accountMenuOpen ? ' projects-nav__caret--open' : ''}`}
              aria-hidden
            >
              <ChevronIcon className="projects-nav__caret-icon" />
            </span>
          </button>

          {accountMenuOpen && (
            <div className="projects-nav__account-menu" role="menu">
              {/* User card header */}
              <div className="projects-nav__account-header">
                <div className="projects-nav__account-header-avatar">
                  <div className="projects-nav__account-header-avatar-inner">{avatarLetter}</div>
                </div>
                <div className="projects-nav__account-header-info">
                  <div className="projects-nav__account-header-name">{username}</div>
                  <div className="projects-nav__account-header-role">
                    <span className="projects-nav__account-header-dot" />
                    {isAdmin ? 'Admin' : 'Personal'}
                  </div>
                </div>
              </div>

              {accountPanelMode === 'menu' ? (
                <>
                  <button
                    type="button"
                    className="projects-nav__account-action"
                    onClick={() => setAccountPanelMode('switch')}
                  >
                    Switch User...
                  </button>
                  <button
                    type="button"
                    className="projects-nav__account-action projects-nav__account-action--danger"
                    onClick={handleSignOut}
                  >
                    Log Out
                  </button>
                </>
              ) : (
                <fieldset className="projects-nav__switch-panel">
                  <legend className="visually-hidden">Switch user</legend>
                  <div className="projects-nav__switch-title">Switch User</div>
                  <input
                    className="projects-nav__switch-input"
                    placeholder="Username"
                    value={switchUsername}
                    onChange={(e) => setSwitchUsername(e.target.value)}
                  />
                  <input
                    className="projects-nav__switch-input"
                    type="password"
                    placeholder="Password"
                    value={switchPassword}
                    onChange={(e) => setSwitchPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSubmitSwitchUser();
                      }
                    }}
                  />
                  <div className="projects-nav__switch-actions">
                    <button
                      type="button"
                      className="projects-nav__switch-btn"
                      onClick={() => {
                        setAccountPanelMode('menu');
                        setSwitchUsername('');
                        setSwitchPassword('');
                      }}
                      disabled={switchingUser}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="projects-nav__switch-btn projects-nav__switch-btn--primary"
                      onClick={handleSubmitSwitchUser}
                      disabled={!switchUsername.trim() || !switchPassword || switchingUser}
                    >
                      {switchingUser ? 'Switching...' : 'Switch'}
                    </button>
                  </div>
                </fieldset>
              )}
            </div>
          )}
        </div>
      </nav>

      {/* ── Body: sidebar + main ── */}
      <div className="projects-body">
        {/* Sidebar */}
        <aside className="projects-sidebar">
          <div className="projects-sidebar__section">
            {SCOPE_ITEMS.map((item) => (
              <button
                key={item.scope}
                type="button"
                className={`projects-sidebar__nav-item${scope === item.scope ? ' projects-sidebar__nav-item--active' : ''}`}
                onClick={() => handleScopeChange(item.scope)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </aside>

        {/* Main */}
        <div className="projects-main">
          {/* Toolbar */}
          <div className="projects-toolbar">
            <div className="projects-toolbar__new-group" ref={newMenuRef}>
              <button
                type="button"
                className="projects-toolbar__new-btn"
                onClick={() => {
                  setNewMenuOpen(false);
                  setShowNewModal(true);
                }}
              >
                New Project
              </button>
              <button
                type="button"
                className="projects-toolbar__new-dropdown"
                onClick={() => setNewMenuOpen((v) => !v)}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3 6l5 5 5-5H3z" />
                </svg>
              </button>
              {newMenuOpen && (
                <div className="projects-toolbar__new-menu">
                  <button
                    type="button"
                    className="projects-toolbar__new-menu-item"
                    onClick={() => {
                      setNewMenuOpen(false);
                      setShowNewModal(true);
                    }}
                  >
                    Blank Project
                  </button>
                  <button
                    type="button"
                    className="projects-toolbar__new-menu-item"
                    onClick={handleImportArchive}
                    disabled={importing}
                  >
                    {importing ? 'Importing...' : 'Upload Project (.zip)'}
                  </button>
                </div>
              )}
            </div>

            <div className="projects-toolbar__search">
              <SearchIcon className="projects-toolbar__search-icon" />
              <input
                className="projects-toolbar__search-input"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Search projects..."
                aria-label="Search projects"
              />
            </div>
          </div>

          {/* Table */}
          <div className="projects-table">
            <div className="projects-table__header">
              <span className="projects-table__header-cell">Name</span>
              <span className="projects-table__header-cell">Owner</span>
              <span className="projects-table__header-cell">Modified</span>
              <span className="projects-table__header-cell" />
            </div>

            {projects.length === 0 ? (
              <div className="projects-empty">
                <pre className="projects-empty__ascii" aria-hidden="true">{
` \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557  \u2588\u2588\u2557
\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551\u255A\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D\u255A\u2588\u2588\u2557\u2588\u2588\u2554\u255D
\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2557   \u255A\u2588\u2588\u2588\u2554\u255D
\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2554\u2550\u2550\u255D   \u2588\u2588\u2554\u2588\u2588\u2557
\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2554\u255D \u2588\u2588\u2557
\u255A\u2550\u255D  \u255A\u2550\u255D\u255A\u2550\u255D   \u255A\u2550\u255D   \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u255D\u255A\u2550\u255D  \u255A\u2550\u255D`
                }</pre>
                <p className="projects-empty__title">
                  {loading ? 'Loading projects...' : 'No projects yet'}
                </p>
                {!loading && (
                  <>
                    <p className="projects-empty__desc">
                      Create your first project to start writing LaTeX with AI assistance.
                    </p>
                    <div className="projects-empty__caps">
                      <span className="projects-empty__cap"><WriteIcon className="projects-empty__cap-icon projects-empty__cap-icon--write" /> Write</span>
                      <span className="projects-empty__cap-sep">&#xB7;</span>
                      <span className="projects-empty__cap"><EditIcon className="projects-empty__cap-icon projects-empty__cap-icon--edit" /> Edit</span>
                      <span className="projects-empty__cap-sep">&#xB7;</span>
                      <span className="projects-empty__cap"><CompileIcon className="projects-empty__cap-icon projects-empty__cap-icon--compile" /> Compile</span>
                      <span className="projects-empty__cap-sep">&#xB7;</span>
                      <span className="projects-empty__cap"><FixIcon className="projects-empty__cap-icon projects-empty__cap-icon--fix" /> Fix</span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              projects.map((project) => {
                const canManage = isAdmin || project.owner === username;
                return (
                  <div
                    key={project.id}
                    className="projects-table__row"
                    onClick={() => navigate(`/project/${project.id}`)}
                  >
                    <span className="projects-table__name">{project.name}</span>
                    <span className="projects-table__owner">
                      {showOwnerMeta ? project.owner : 'You'}
                    </span>
                    <span className="projects-table__date">
                      {formatDate(project.updatedAt)}
                    </span>
                    {canManage ? renderProjectActions(project) : <span />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── New Project Modal ── */}
      <Modal
        open={showNewModal}
        onClose={() => {
          setShowNewModal(false);
          setNewName('');
        }}
        title="New Project"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowNewModal(false);
                setNewName('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={creating}
              disabled={!newName.trim()}
              onClick={handleCreate}
            >
              Create
            </Button>
          </>
        }
      >
        <Input
          label="Project name"
          placeholder="My LaTeX Paper"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
      </Modal>
    </div>
  );
}
