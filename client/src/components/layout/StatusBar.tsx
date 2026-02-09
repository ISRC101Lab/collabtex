import { useUiStore } from '@/stores/uiStore';
import './StatusBar.css';

interface StatusBarProps {
  activeFile: string | null;
}

const COMPILE_LABELS: Record<string, string> = {
  idle: 'Connected',
  compiling: 'Compiling...',
  success: 'Compile Complete',
  error: 'Compile Error',
};

export default function StatusBar({ activeFile }: StatusBarProps) {
  const cursorLine = useUiStore((s) => s.cursorLine);
  const cursorCol = useUiStore((s) => s.cursorCol);
  const wordCount = useUiStore((s) => s.wordCount);
  const compileStatus = useUiStore((s) => s.compileStatus);
  return (
    <footer className="status-bar">
      <div className="status-bar__left">
        {activeFile && (
          <span className="status-bar__item">
            Ln {cursorLine}, Col {cursorCol}
          </span>
        )}
        {activeFile && wordCount > 0 && (
          <span className="status-bar__item">
            {wordCount} words
          </span>
        )}
      </div>
      <div className="status-bar__right">
        <span className={`status-bar__item status-bar__compile--${compileStatus}`}>
          {COMPILE_LABELS[compileStatus] ?? compileStatus}
        </span>
        {activeFile && (
          <span className="status-bar__item status-bar__file">
            {activeFile}
          </span>
        )}
      </div>
    </footer>
  );
}
