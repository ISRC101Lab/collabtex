import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal, Spinner } from '@/components/common';
import ChevronIcon from '@/components/common/ChevronIcon';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import {
  getProjectListPreferences,
  setProjectListPreferences,
  importProject,
  type ProjectListScope,
  type ProjectListView,
} from '@/api/client';
import type { Project } from '@/stores/projectStore';
import ProjectThumbnail from '@/components/projects/ProjectThumbnail';
import './ProjectListPage.css';

function ViewListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M6 5.5H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 10H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 14.5H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="4" cy="5.5" r="0.9" fill="currentColor" />
      <circle cx="4" cy="10" r="0.9" fill="currentColor" />
      <circle cx="4" cy="14.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

function ViewGridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="11" y="11" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="9" cy="9" r="4.7" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12.5 12.5L15.7 15.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function RenameIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M13.9 3.5L16.5 6.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5 15.1L7.3 14.6L15.6 6.4L13 3.8L4.8 12.1L4.3 14.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.2 15.8H15.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function DeleteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
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
      <circle cx="5.2" cy="10" r="1.2" fill="currentColor" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" />
      <circle cx="14.8" cy="10" r="1.2" fill="currentColor" />
    </svg>
  );
}

type ActionMode = 'menu' | 'rename';

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

  const [scope, setScope] = useState<ProjectListScope>('owned');
  const [viewMode, setViewMode] = useState<ProjectListView>('list');
  const [prefsReady, setPrefsReady] = useState(false);
  const searchHydrated = useRef(false);

  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountPanelMode, setAccountPanelMode] = useState<'menu' | 'switch'>('menu');
  const [switchUsername, setSwitchUsername] = useState('');
  const [switchPassword, setSwitchPassword] = useState('');
  const [switchingUser, setSwitchingUser] = useState(false);

  const [activeActionProjectId, setActiveActionProjectId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>('menu');
  const [actionName, setActionName] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const fetchByControls = async (query: string, nextScope: ProjectListScope) => {
    await fetchProjectsWithQuery({
      q: query.trim() || undefined,
      scope: nextScope,
      sort: 'updated_desc',
    });
  };

  const closeActionMenu = () => {
    setActiveActionProjectId(null);
    setActionMode('menu');
    setActionName('');
    setActionBusy(false);
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const { prefs } = await getProjectListPreferences();
        if (cancelled) return;
        setScope(prefs.scope);
        setViewMode('list');
        await fetchProjectsWithQuery({ scope: prefs.scope, sort: 'updated_desc' });
      } catch {
        if (cancelled) return;
        try {
          await fetchProjectsWithQuery({ scope, sort: 'updated_desc' });
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
  }, [fetchProjectsWithQuery, addToast, username]);

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
  }, [searchValue, prefsReady]);

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
  }, [activeActionProjectId]);

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
      setAccountMenuOpen(false);
      setAccountPanelMode('menu');
      setSwitchUsername('');
      setSwitchPassword('');
      addToast('User switched.', 'success');
    } catch {
      addToast('Switch user failed.', 'error');
    } finally {
      setSwitchingUser(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setAccountMenuOpen(false);
    setAccountPanelMode('menu');
    setSwitchUsername('');
    setSwitchPassword('');
    navigate('/login', { replace: true });
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

  const handleViewChange = (nextView: ProjectListView) => {
    if (nextView === viewMode) return;
    setViewMode(nextView);
    closeActionMenu();
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
      return `${Math.max(1, minutes)}m`;
    }

    const hours = Math.floor(minutes / 60);
    return `${Math.max(1, hours)}h`;
  };

  const avatarLetter = username.slice(0, 1).toUpperCase();
  const scopeTitle = scope === 'all' ? 'All Projects' : scope === 'shared' ? 'Shared with You' : 'Your Projects';
  const showOwnerMeta = scope !== 'owned' || isAdmin;

  const renderProjectActions = (project: Project, variant: 'card' | 'row') => {
    const isOpen = activeActionProjectId === project.id;
    const wrapperClass = variant === 'card'
      ? `project-card__actions${isOpen ? ' project-card__actions--open' : ''}`
      : `project-row__actions${isOpen ? ' project-row__actions--open' : ''}`;

    return (
      <div
        className={wrapperClass}
        ref={isOpen ? actionMenuRef : null}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className={`project-actions__trigger project-actions__trigger--${variant}${isOpen ? ' project-actions__trigger--active' : ''}`}
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
              <div className="project-actions__rename" role="group" aria-label="Rename project">
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
                  autoFocus
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
              </div>
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
    <div className="projects-page">
      <aside className="projects-nav">
        <div className="projects-nav__brand">Aitex</div>
        <div className="projects-nav__account-wrap" ref={accountMenuRef}>
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
            <span className="projects-nav__avatar">{avatarLetter}</span>
            <span className="projects-nav__identity">
              <span className="projects-nav__name">{username}</span>
              <span className="projects-nav__meta">
                {isAdmin ? 'Admin workspace' : 'Personal workspace'}
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
                <div className="projects-nav__switch-panel" role="group" aria-label="Switch user">
                  <div className="projects-nav__switch-title">Switch User</div>
                  <input
                    className="projects-nav__switch-input"
                    placeholder="Username"
                    value={switchUsername}
                    onChange={(e) => setSwitchUsername(e.target.value)}
                    autoFocus
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
                </div>
              )}
            </div>
          )}
        </div>

        <nav className="projects-nav__menu">
          <button
            className={`projects-nav__item${scope === 'all' ? ' projects-nav__item--active' : ''}`}
            type="button"
            onClick={() => handleScopeChange('all')}
          >
            All Projects
          </button>
          <button
            className={`projects-nav__item${scope === 'owned' ? ' projects-nav__item--active' : ''}`}
            type="button"
            onClick={() => handleScopeChange('owned')}
          >
            Your Projects
          </button>
          <button
            className={`projects-nav__item${scope === 'shared' ? ' projects-nav__item--active' : ''}`}
            type="button"
            onClick={() => handleScopeChange('shared')}
          >
            Shared with You
          </button>
        </nav>
      </aside>

      <section className="projects-main">
        <header className="projects-toolbar">
          <h1 className="projects-heading">{scopeTitle}</h1>
          <div className="projects-toolbar__right">
            <div className="projects-search">
              <SearchIcon className="projects-search__icon" />
              <input
                className="projects-search__input"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Search"
                aria-label="Search projects"
              />
            </div>
            <div className="projects-toolbar__view-switch" role="group" aria-label="Project view mode">
              <button
                className={`projects-toolbar__icon projects-toolbar__icon--square${viewMode === 'list' ? ' projects-toolbar__icon--active' : ''}`}
                type="button"
                aria-label="List view"
                title="List view"
                onClick={() => handleViewChange('list')}
              >
                <ViewListIcon className="projects-toolbar__icon-svg" />
              </button>
              <button
                className={`projects-toolbar__icon projects-toolbar__icon--square${viewMode === 'card' ? ' projects-toolbar__icon--active' : ''}`}
                type="button"
                aria-label="Card view"
                title="Card view"
                onClick={() => handleViewChange('card')}
              >
                <ViewGridIcon className="projects-toolbar__icon-svg" />
              </button>
            </div>
            <div className="projects-import">
              <button
                className="projects-import__main"
                type="button"
                onClick={handleImportArchive}
                disabled={importing}
                title="Import .zip project archive"
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
            </div>
            <Button
              variant="primary"
              className="projects-toolbar__pill"
              onClick={() => setShowNewModal(true)}
            >
              + New
            </Button>
          </div>
        </header>

        {projects.length === 0 ? (
          <div className="projects-empty">
            <p>No projects yet. Create one to get started.</p>
          </div>
        ) : viewMode === 'card' ? (
          <div className="projects-grid">
            {projects.map((project: Project) => {
              const canManageProject = isAdmin || project.owner === username;
              return (
                <article
                  key={project.id}
                  className="project-card"
                  onClick={() => navigate(`/project/${project.id}`)}
                >
                  <div className="project-card__header">
                    <ProjectThumbnail
                      projectId={project.id}
                      updatedAt={project.updatedAt}
                      variant="card"
                      className="project-card__icon"
                    />
                    {canManageProject && renderProjectActions(project, 'card')}
                  </div>
                  <h2 className="project-card__name">{project.name}</h2>
                  <p className="project-card__date">{formatDate(project.updatedAt)}</p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="projects-list">
            {projects.map((project: Project) => {
              const canManageProject = isAdmin || project.owner === username;
              return (
                <article
                  key={project.id}
                  className="project-row"
                  onClick={() => navigate(`/project/${project.id}`)}
                >
                  <div className="project-row__left">
                    <ProjectThumbnail
                      projectId={project.id}
                      updatedAt={project.updatedAt}
                      variant="list"
                      className="project-row__icon"
                    />
                    <div className="project-row__meta">
                      <h2 className="project-row__name">{project.name}</h2>
                      {showOwnerMeta && <p className="project-row__owner">Owner: {project.owner}</p>}
                    </div>
                  </div>

                  <div className="project-row__right">
                    <p className="project-row__date">{formatDate(project.updatedAt)}</p>
                    {canManageProject && renderProjectActions(project, 'row')}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

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
