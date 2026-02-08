import { useState, useEffect, useCallback } from 'react';
import * as api from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import './CollabManager.css';

interface CollabManagerProps {
  projectId: string;
  onClose: () => void;
}

export default function CollabManager({ projectId, onClose }: CollabManagerProps) {
  const [owner, setOwner] = useState('');
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [newUser, setNewUser] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const currentUser = useAuthStore((s) => s.user?.username);
  const isOwner = currentUser === owner;

  const fetchCollabs = useCallback(() => {
    api.getCollaborators(projectId).then(
      (res) => {
        setOwner(res.owner);
        setCollaborators(res.collaborators);
      },
      () => setError('Failed to load collaborators'),
    );
  }, [projectId]);

  useEffect(() => {
    fetchCollabs();
  }, [fetchCollabs]);

  const handleAdd = useCallback(() => {
    const name = newUser.trim();
    if (!name) return;
    setLoading(true);
    setError('');
    api.addCollaborator(projectId, name).then(
      (res) => {
        setCollaborators(res.collaborators);
        setNewUser('');
        setLoading(false);
      },
      () => {
        setError('Failed to add collaborator');
        setLoading(false);
      },
    );
  }, [projectId, newUser]);

  const handleRemove = useCallback((username: string) => {
    api.removeCollaborator(projectId, username).then(
      (res) => setCollaborators(res.collaborators),
      () => setError('Failed to remove collaborator'),
    );
  }, [projectId]);

  return (
    <div className="collab-manager__overlay" onClick={onClose}>
      <div className="collab-manager" onClick={(e) => e.stopPropagation()}>
        <div className="collab-manager__header">
          <h3 className="collab-manager__title">Collaborators</h3>
          <button className="collab-manager__close" onClick={onClose}>
            &#x2715;
          </button>
        </div>

        <div className="collab-manager__body">
          {/* Owner */}
          <div className="collab-manager__member collab-manager__member--owner">
            <span className="collab-manager__name">{owner}</span>
            <span className="collab-manager__badge">Owner</span>
          </div>

          {/* Collaborators list */}
          {collaborators.map((c) => (
            <div key={c} className="collab-manager__member">
              <span className="collab-manager__name">{c}</span>
              {isOwner && (
                <button
                  className="collab-manager__remove-btn"
                  onClick={() => handleRemove(c)}
                  title="Remove"
                >
                  &#x2715;
                </button>
              )}
            </div>
          ))}

          {collaborators.length === 0 && (
            <div className="collab-manager__empty">
              No collaborators yet
            </div>
          )}
        </div>

        {/* Add collaborator (owner only) */}
        {isOwner && (
          <div className="collab-manager__add">
            <input
              className="collab-manager__input"
              placeholder="Username..."
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
              disabled={loading}
            />
            <button
              className="collab-manager__add-btn"
              onClick={handleAdd}
              disabled={loading || !newUser.trim()}
            >
              Add
            </button>
          </div>
        )}

        {error && <div className="collab-manager__error">{error}</div>}
      </div>
    </div>
  );
}
