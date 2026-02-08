import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useLocation, useNavigate } from 'react-router-dom';
import './Header.css';

export function Header() {
  const { user, logout } = useAuthStore();
  const { currentProject } = useProjectStore();
  const activeFile = useEditorStore((s) => s.activeFile);
  const location = useLocation();
  const navigate = useNavigate();
  const isEditorPage = location.pathname.startsWith('/project/');

  return (
    <header className="header">
      <div className="header__left">
        {isEditorPage && (
          <button
            className="header__back-btn"
            onClick={() => navigate('/')}
            title="Back to projects"
          >
            &#x2190;
          </button>
        )}
        <span
          className="header__logo"
          onClick={() => navigate('/')}
          role="button"
          tabIndex={0}
        >
          Aitex
        </span>
      </div>

      <div className="header__center">
        {isEditorPage && currentProject && (
          <div className="header__breadcrumb">
            <span className="header__breadcrumb-project">{currentProject.name}</span>
            {activeFile && (
              <>
                <span className="header__breadcrumb-sep">/</span>
                <span className="header__breadcrumb-file">{activeFile}</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="header__right">
        {user && (
          <div className="header__user-menu">
            <span className="header__username">{user.username}</span>
            <button className="header__logout-btn" onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
