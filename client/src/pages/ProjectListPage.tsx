import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal, Spinner } from '@/components/common';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import type { Project } from '@/stores/projectStore';
import './ProjectListPage.css';

export default function ProjectListPage() {
  const navigate = useNavigate();
  const { projects, loading, fetchProjects, createProject, deleteProject } =
    useProjectStore();
  const addToast = useUiStore((s) => s.addToast);

  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchProjects().catch(() => {
      addToast('Failed to load projects.', 'error');
    });
  }, [fetchProjects, addToast]);

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

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await deleteProject(confirmDeleteId);
      addToast('Project deleted.', 'success');
    } catch {
      addToast('Could not delete project.', 'error');
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const deletingProject = projects.find((p) => p.id === confirmDeleteId);

  if (loading && projects.length === 0) {
    return (
      <div className="projects-loading">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="projects-page">
      <header className="projects-header">
        <h1 className="projects-heading">Projects</h1>
        <Button variant="primary" onClick={() => setShowNewModal(true)}>
          New Project
        </Button>
      </header>

      {projects.length === 0 ? (
        <div className="projects-empty">
          <p>No projects yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="projects-grid">
          {projects.map((project: Project) => (
            <article
              key={project.id}
              className="project-card"
              onClick={() => navigate(`/project/${project.id}`)}
            >
              <h2 className="project-card__name">{project.name}</h2>
              <p className="project-card__owner">Owner: {project.owner}</p>
              <p className="project-card__date">
                Updated {formatDate(project.updatedAt)}
              </p>
              <button
                className="project-card__delete"
                title="Delete project"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteId(project.id);
                }}
              >
                Delete
              </button>
            </article>
          ))}
        </div>
      )}

      {/* New Project Modal */}
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

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        title="Delete Project"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          Are you sure you want to delete{' '}
          <strong>{deletingProject?.name ?? 'this project'}</strong>? This
          action cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
