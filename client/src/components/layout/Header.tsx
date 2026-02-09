import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useLocation, useNavigate } from 'react-router-dom';
import './Header.css';

export function Header() {
  const { currentProject } = useProjectStore();
  const activeFile = useEditorStore((s) => s.activeFile);
  const location = useLocation();
  const navigate = useNavigate();
  const isEditorPage = location.pathname.startsWith('/project/');

  if (!isEditorPage) {
    return null;
  }

  return (
    <header className="header">
      <button
        className="header__brand"
        onClick={() => navigate('/')}
        title="Back to projects"
      >
        Aitex
      </button>

      <div className="header__center">
        {currentProject && (
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
    </header>
  );
}
