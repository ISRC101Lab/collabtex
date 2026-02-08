import React, { useState, useMemo, useEffect, useRef } from 'react';
import { marked } from 'marked';
import type { FileChange, ToolCall } from '@/api/client';
import { usePendingChangesStore } from '@/stores/pendingChangesStore';
import DiffView from './DiffView';
import './AiMessage.css';

// Configure marked with custom code block renderer
const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const langLabel = lang ? `<span class="ai-code-lang">${lang}</span>` : '';
  return `<div class="ai-code-block">${langLabel}<button class="ai-code-copy" data-code="${encodeURIComponent(text)}">Copy</button><pre><code class="language-${lang || 'text'}">${escaped}</code></pre></div>`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer,
});

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  fileChanges?: FileChange[];
  toolCalls?: ToolCall[];
  thinking?: string;
  streaming?: boolean;
}

interface AiMessageProps {
  message: ChatMessage;
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toolIcon(name: string): string {
  switch (name) {
    case 'read_file': return '\u{1F4C4}';
    case 'write_file': return '\u{270F}';
    case 'edit_file': return '\u{2702}';
    case 'delete_file': return '\u{1F5D1}';
    case 'list_files': return '\u{1F4C2}';
    default: return '\u{2699}';
  }
}

function toolLabel(name: string): string {
  switch (name) {
    case 'read_file': return 'Read file';
    case 'write_file': return 'Write file';
    case 'edit_file': return 'Edit file';
    case 'delete_file': return 'Delete file';
    case 'list_files': return 'List files';
    default: return name;
  }
}

const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  write: 'Modified',
  edit: 'Modified',
  delete: 'Deleted',
};

function FileChangeSummary({ change }: { change: FileChange }) {
  return (
    <div className="ai-file-summary">
      <span className={`ai-file-summary__badge ai-file-summary__badge--${change.action}`}>
        {ACTION_LABELS[change.action] ?? change.action}
      </span>
      <span className="ai-file-summary__path">{change.path}</span>
    </div>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  if (!content) return null;
  return (
    <div className="ai-thinking-block">
      <button
        className="ai-thinking-block__toggle"
        onClick={() => setOpen(!open)}
        type="button"
      >
        {open ? '\u25BC' : '\u25B6'} Thinking
      </button>
      {open && (
        <div className="ai-thinking-block__content">{content}</div>
      )}
    </div>
  );
}

const AiMessage: React.FC<AiMessageProps> = ({ message }) => {
  const roleClass = `ai-message ai-message--${message.role}${message.streaming ? ' ai-message--streaming' : ''}`;
  const contentRef = useRef<HTMLDivElement>(null);
  // Track accepted/rejected state per file change index
  const [changeStates, setChangeStates] = useState<Record<number, 'accepted' | 'rejected'>>({});

  const renderedHtml = useMemo(() => {
    if (!message.content || message.role === 'user') return '';
    return marked.parse(message.content) as string;
  }, [message.content, message.role]);

  // Delegate click on copy buttons inside rendered markdown
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('.ai-code-copy') as HTMLElement | null;
      if (!btn) return;
      const code = decodeURIComponent(btn.dataset.code || '');
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [renderedHtml]);

  return (
    <div className={roleClass}>
      <div className="ai-message__role">
        {message.role === 'user' ? 'You' : 'Aitex AI'}
      </div>
      {message.thinking && (
        <ThinkingBlock content={message.thinking} />
      )}
      {message.content && (
        message.role === 'assistant' ? (
          <div className="ai-message__content ai-message__markdown" ref={contentRef}>
            <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
            {message.streaming && <span className="ai-message__cursor" />}
          </div>
        ) : (
          <div className="ai-message__content">
            {message.content}
          </div>
        )
      )}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="ai-message__tools">
          {message.toolCalls.map((tc, i) => (
            <div key={i} className="ai-tool-call">
              <span className="ai-tool-call__icon">{toolIcon(tc.name)}</span>
              {toolLabel(tc.name)}
              {tc.args && (tc.args as Record<string, unknown>).path
                ? `: ${(tc.args as Record<string, unknown>).path}`
                : ''}
            </div>
          ))}
        </div>
      )}
      {message.fileChanges && message.fileChanges.length > 0 && (
        <div className="ai-message__changes">
          {message.fileChanges.map((fc, i) => {
            const state = changeStates[i];
            if (state) {
              return (
                <div key={i} className={`ai-change-resolved ai-change-resolved--${state}`}>
                  <span className="ai-change-resolved__icon">
                    {state === 'accepted' ? '\u2713' : '\u2717'}
                  </span>
                  <span className="ai-change-resolved__path">{fc.path}</span>
                  <span className="ai-change-resolved__label">
                    {state === 'accepted' ? 'Accepted' : 'Rejected'}
                  </span>
                </div>
              );
            }
            const handleAccept = () => {
              setChangeStates((s) => ({ ...s, [i]: 'accepted' }));
            };
            const handleReject = () => {
              if (fc.oldContent !== null) {
                window.dispatchEvent(
                  new CustomEvent('aitex:revert-file', {
                    detail: { path: fc.path, content: fc.oldContent },
                  }),
                );
              }
              setChangeStates((s) => ({ ...s, [i]: 'rejected' }));
            };
            const hasDiffContent = fc.oldContent !== null || fc.newContent !== null;
            if (hasDiffContent) {
              return (
                <DiffView
                  key={i}
                  change={fc}
                  onAccept={handleAccept}
                  onReject={handleReject}
                />
              );
            }
            return (
              <div key={i} className="ai-file-summary">
                <span className={`ai-file-summary__badge ai-file-summary__badge--${fc.action}`}>
                  {ACTION_LABELS[fc.action] ?? fc.action}
                </span>
                <span className="ai-file-summary__path">{fc.path}</span>
                <div className="ai-file-summary__actions">
                  <button className="ai-file-summary__btn ai-file-summary__btn--accept" onClick={handleAccept} title="Accept">&#x2713;</button>
                  <button className="ai-file-summary__btn ai-file-summary__btn--reject" onClick={handleReject} title="Reject">&#x2717;</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!message.streaming && (
        <span className="ai-message__timestamp">{formatTime(message.timestamp)}</span>
      )}
    </div>
  );
};

export default AiMessage;
