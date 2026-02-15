import React, { useEffect } from 'react';
import * as api from '@/api/client';
import { useConversationStore } from '@/stores/conversationStore';
import { useUiStore } from '@/stores/uiStore';
import './ConversationList.css';

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

const ConversationList: React.FC = () => {
  const convoList = useConversationStore((s) => s.convoList);
  const activeConvoId = useConversationStore((s) => s.activeConvoId);
  const newConvo = useConversationStore((s) => s.newConvo);
  const switchConvo = useConversationStore((s) => s.switchConvo);
  const deleteConvo = useConversationStore((s) => s.deleteConvo);

  const aiConfigured = useConversationStore((s) => s.aiConfigured);
  const models = useConversationStore((s) => s.models);
  const selectedModel = useConversationStore((s) => s.selectedModel);
  const setAiConfig = useConversationStore((s) => s.setAiConfig);
  const setSelectedModel = useConversationStore((s) => s.setSelectedModel);
  const setAiDockVisible = useUiStore((s) => s.setAiDockVisible);
  const setAiDockExpanded = useUiStore((s) => s.setAiDockExpanded);

  useEffect(() => {
    api.aiStatus().then(
      (res) => {
        setAiConfig(res.configured, res.provider, res.models ?? []);
      },
      () => {
        setAiConfig(false, '', []);
      },
    );
  }, [setAiConfig]);

  return (
    <div className="convo-list">
      <div className="convo-list__model-bar">
        {aiConfigured === null ? (
          <span className="convo-list__model-status">Checking AI...</span>
        ) : aiConfigured ? (
          <>
            <span className="convo-list__model-dot convo-list__model-dot--ok" />
            {models.length > 0 ? (
              <select
                className="convo-list__model-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m.replace('Qwen3-VL-', '').replace('-Instruct', '').replace('-Thinking', ' Think')}
                  </option>
                ))}
              </select>
            ) : (
              <span className="convo-list__model-status">Connected</span>
            )}
          </>
        ) : (
          <>
            <span className="convo-list__model-dot convo-list__model-dot--err" />
            <span className="convo-list__model-status convo-list__model-status--err">Not configured</span>
          </>
        )}
      </div>

      <button
        className="convo-list__new"
        onClick={() => {
          newConvo();
          setAiDockVisible(true);
          setAiDockExpanded(true);
        }}
        type="button"
      >
        <PlusIcon className="convo-list__new-icon" />
        New chat
      </button>

      <div className="convo-list__items">
        {convoList.map((c) => (
          <div
            key={c.id}
            className={`convo-list__item${c.id === activeConvoId ? ' convo-list__item--active' : ''}`}
          >
            <button
              className="convo-list__item-btn"
              onClick={() => {
                switchConvo(c.id);
                setAiDockVisible(true);
                setAiDockExpanded(true);
              }}
              type="button"
            >
              <span className="convo-list__item-title">{c.title}</span>
              <span className="convo-list__item-date">{formatRelative(c.updatedAt)}</span>
            </button>
            <button
              className="convo-list__item-delete"
              onClick={(e) => { e.stopPropagation(); deleteConvo(c.id); }}
              type="button"
              title="Delete conversation"
            >
              <XIcon className="convo-list__delete-icon" />
            </button>
          </div>
        ))}
        {convoList.length === 0 && (
          <div className="convo-list__empty">
            No conversations yet.
            <br />Start a chat in the editor.
          </div>
        )}
      </div>
    </div>
  );
};

export default ConversationList;
