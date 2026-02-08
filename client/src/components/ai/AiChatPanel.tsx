import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as api from '@/api/client';
import type { AiStreamEvent, FileChange, ToolCall } from '@/api/client';
import { useUiStore } from '@/stores/uiStore';
import { useEditorStore } from '@/stores/editorStore';
import { usePendingChangesStore } from '@/stores/pendingChangesStore';
import AiMessage, { type ChatMessage } from '@/components/ai/AiMessage';
import FileMentionPopup from '@/components/ai/FileMentionPopup';
import './AiChatPanel.css';

interface AiChatPanelProps {
  projectId: string;
}

// ── Multi-conversation persistence helpers ──────────────────────────
interface ConvoMeta {
  id: string;
  title: string;
  updatedAt: number;
}

const CONVOS_KEY = (pid: string) => `aitex-convos-${pid}`;
const CONV_KEY = (pid: string, cid: string) => `aitex-conv-${pid}-${cid}`;
const MAX_PERSISTED = 50;

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadConvoList(projectId: string): ConvoMeta[] {
  try {
    const raw = localStorage.getItem(CONVOS_KEY(projectId));
    return raw ? (JSON.parse(raw) as ConvoMeta[]) : [];
  } catch { return []; }
}

function saveConvoList(projectId: string, list: ConvoMeta[]) {
  try {
    localStorage.setItem(CONVOS_KEY(projectId), JSON.stringify(list));
  } catch { /* ignore */ }
}

function loadConvoMessages(projectId: string, convoId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CONV_KEY(projectId, convoId));
    if (!raw) return [];
    return (JSON.parse(raw) as ChatMessage[]).map((m) => ({ ...m, streaming: false }));
  } catch { return []; }
}

function saveConvoMessages(projectId: string, convoId: string, msgs: ChatMessage[]) {
  try {
    const toSave = msgs
      .filter((m) => !m.streaming)
      .slice(-MAX_PERSISTED)
      .map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        thinking: m.thinking,
        toolCalls: m.toolCalls,
        fileChanges: m.fileChanges?.map((fc) => ({
          action: fc.action,
          path: fc.path,
          oldContent: null,
          newContent: null,
        })),
      }));
    localStorage.setItem(CONV_KEY(projectId, convoId), JSON.stringify(toSave));
  } catch { /* quota exceeded */ }
}

function deleteConvo(projectId: string, convoId: string) {
  localStorage.removeItem(CONV_KEY(projectId, convoId));
}

const AiChatPanel: React.FC<AiChatPanelProps> = ({ projectId }) => {
  // Multi-conversation state
  const [convoList, setConvoList] = useState<ConvoMeta[]>(() => loadConvoList(projectId));
  const [activeConvoId, setActiveConvoId] = useState<string>(() => {
    const list = loadConvoList(projectId);
    return list.length > 0 ? list[0].id : genId();
  });
  const [showHistory, setShowHistory] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const list = loadConvoList(projectId);
    if (list.length > 0) return loadConvoMessages(projectId, list[0].id);
    return [];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [aiProvider, setAiProvider] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const toggleAiPanel = useUiStore((s) => s.toggleAiPanel);
  const addToast = useUiStore((s) => s.addToast);
  const fetchTree = useEditorStore((s) => s.fetchTree);
  const refreshFile = useEditorStore((s) => s.refreshFile);
  const fileTree = useEditorStore((s) => s.fileTree);

  // @ mention state
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);



  // Persist messages to localStorage when they change
  useEffect(() => {
    if (messages.length > 0 && !messages.some((m) => m.streaming)) {
      saveConvoMessages(projectId, activeConvoId, messages);
      // Update convo list metadata
      const firstUserMsg = messages.find((m) => m.role === 'user');
      const title = firstUserMsg?.content?.slice(0, 40) || 'New Chat';
      setConvoList((prev) => {
        const exists = prev.find((c) => c.id === activeConvoId);
        let updated: ConvoMeta[];
        if (exists) {
          updated = prev.map((c) =>
            c.id === activeConvoId ? { ...c, title, updatedAt: Date.now() } : c,
          );
        } else {
          updated = [{ id: activeConvoId, title, updatedAt: Date.now() }, ...prev];
        }
        saveConvoList(projectId, updated);
        return updated;
      });
    }
  }, [messages, projectId, activeConvoId]);

  // Reload when projectId changes
  useEffect(() => {
    const list = loadConvoList(projectId);
    setConvoList(list);
    if (list.length > 0) {
      setActiveConvoId(list[0].id);
      setMessages(loadConvoMessages(projectId, list[0].id));
    } else {
      setActiveConvoId(genId());
      setMessages([]);
    }
    setShowHistory(false);
  }, [projectId]);

  // Check AI provider status on mount
  useEffect(() => {
    api.aiStatus().then(
      (res) => {
        setAiConfigured(res.configured);
        setAiProvider(res.provider);
        if (res.models?.length) {
          setModels(res.models);
          setSelectedModel(res.provider);
        }
      },
      () => {
        setAiConfigured(false);
      },
    );
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Build history for the API (only role + content)
  const buildHistory = useCallback((): api.ChatHistoryMessage[] => {
    return messages
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  // Send message handler (SSE streaming)
  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setMentionActive(false);

    // Resolve @file references — fetch content and prepend as context
    const mentionRegex = /@([\w./_-]+)/g;
    const mentions = [...trimmed.matchAll(mentionRegex)].map((m) => m[1]);
    const validMentions = mentions.filter((m) => fileTree.includes(m));

    let messageToSend = trimmed;
    if (validMentions.length > 0) {
      const contextBlocks: string[] = [];
      for (const filePath of validMentions) {
        try {
          const res = await api.getFile(projectId, filePath);
          contextBlocks.push(`[Context: @${filePath}]\n${res.content}\n[End context]`);
        } catch { /* skip unreadable files */ }
      }
      if (contextBlocks.length > 0) {
        messageToSend = contextBlocks.join('\n\n') + '\n\n' + trimmed;
      }
    }

    const userMsg: ChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Create a streaming assistant message placeholder
    const streamMsg: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
      toolCalls: [],
      fileChanges: [],
      thinking: '',
    };
    setMessages((prev) => [...prev, streamMsg]);

    const abort = new AbortController();
    abortRef.current = abort;

    // Mutable accumulators for the streaming message
    let content = '';
    let thinking = '';
    const toolCalls: ToolCall[] = [];
    const fileChanges: FileChange[] = [];
    let fileChangeCount = 0;

    const updateStream = (patch: Partial<ChatMessage>) => {
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, ...patch };
        return copy;
      });
    };

    try {
      const history = buildHistory();
      await api.aiChatStream(
        projectId,
        messageToSend,
        history,
        selectedModel || undefined,
        (event: AiStreamEvent) => {
          switch (event.type) {
            case 'thinking_content':
              thinking += event.content;
              updateStream({ thinking });
              break;
            case 'thinking_done':
              thinking = event.content;
              updateStream({ thinking });
              break;
            case 'content':
              content += event.content;
              updateStream({ content });
              break;
            case 'tool_call':
              toolCalls.push({ name: event.name, args: event.args, result: '' });
              updateStream({ toolCalls: [...toolCalls] });
              break;
            case 'tool_result': {
              const tc = toolCalls.find((t) => t.name === event.name && !t.result);
              if (tc) tc.result = event.result;
              updateStream({ toolCalls: [...toolCalls] });
              // Auto-refresh PDF after AI compile
              if (event.name === 'compile_project') {
                try {
                  const res = JSON.parse(event.result);
                  if (res.ok && res.pdfExists) {
                    window.dispatchEvent(new CustomEvent('aitex:compile-done'));
                  }
                } catch { /* ignore parse errors */ }
              }
              break;
            }
            case 'file_change':
              fileChanges.push({
                action: event.action as FileChange['action'],
                path: event.path,
                oldContent: event.oldContent,
                newContent: event.newContent,
              });
              fileChangeCount++;
              updateStream({ fileChanges: [...fileChanges] });
              // Sync editor (P0-2)
              if (refreshFile) refreshFile(projectId, event.path);
              fetchTree(projectId);
              break;
            case 'done':
              content = event.reply || content;
              updateStream({
                content,
                streaming: false,
                timestamp: Date.now(),
              });
              // Push file changes to the pending changes store for banner review
              if (fileChanges.length > 0) {
                usePendingChangesStore.getState().addChanges(fileChanges);
              }
              break;
            case 'error':
              addToast(`AI error: ${event.message}`, 'error');
              break;
          }
        },
        abort.signal,
      );

      // Finalize
      if (fileChangeCount > 0) {
        addToast(
          `AI modified ${fileChangeCount} file${fileChangeCount > 1 ? 's' : ''}`,
          'info',
        );
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addToast('Failed to get AI response', 'error');
      }
    } finally {
      // Ensure streaming flag is off
      updateStream({ streaming: false, timestamp: Date.now() });
      setLoading(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }, [input, loading, projectId, buildHistory, addToast, selectedModel, fetchTree, refreshFile, fileTree]);

  // Delete a specific conversation
  const handleDeleteConvo = useCallback((convoId: string) => {
    deleteConvo(projectId, convoId);
    setConvoList((prev) => {
      const updated = prev.filter((c) => c.id !== convoId);
      saveConvoList(projectId, updated);
      return updated;
    });
    // If deleting the active conversation, reset to new
    if (convoId === activeConvoId) {
      const newId = genId();
      setActiveConvoId(newId);
      setMessages([]);
    }
  }, [projectId, activeConvoId]);

  // New conversation
  const handleNewChat = useCallback(() => {
    const newId = genId();
    setActiveConvoId(newId);
    setMessages([]);
    setShowHistory(false);
  }, []);

  // Switch to existing conversation
  const handleSwitchConvo = useCallback((convoId: string) => {
    setActiveConvoId(convoId);
    setMessages(loadConvoMessages(projectId, convoId));
    setShowHistory(false);
  }, [projectId]);

  // @ mention: select a file from popup
  const handleMentionSelect = useCallback(
    (file: string) => {
      const before = input.slice(0, mentionStart);
      const after = input.slice(mentionStart + 1 + mentionQuery.length);
      setInput(before + '@' + file + ' ' + after);
      setMentionActive(false);
      inputRef.current?.focus();
    },
    [input, mentionStart, mentionQuery],
  );

  // Filtered files for mention popup
  const mentionFiltered = mentionActive
    ? fileTree.filter((f) => f.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8)
    : [];

  // Handle keyboard: mention nav + Enter to send
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionActive && mentionFiltered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => Math.min(i + 1, mentionFiltered.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          handleMentionSelect(mentionFiltered[mentionIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMentionActive(false);
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, mentionActive, mentionFiltered, mentionIndex, handleMentionSelect],
  );

  return (
    <aside className="ai-chat-panel">
      {/* Header */}
      <div className="ai-chat-panel__header">
        <span className="ai-chat-panel__title">
          AI Assistant
          {messages.length > 0 && (
            <span className="ai-chat-panel__history-badge">{messages.length}</span>
          )}
        </span>
        <div className="ai-chat-panel__header-actions">
          <button
            className="ai-chat-panel__header-btn"
            onClick={handleNewChat}
            type="button"
            title="New conversation"
          >
            &#x2795;
          </button>
          {convoList.length > 0 && (
            <button
              className={'ai-chat-panel__header-btn' + (showHistory ? ' ai-chat-panel__header-btn--active' : '')}
              onClick={() => setShowHistory((v) => !v)}
              type="button"
              title="Conversation history"
            >
              &#x1F4CB;
            </button>
          )}
          <button
            className="ai-chat-panel__header-btn"
            onClick={toggleAiPanel}
            type="button"
          >
            Close
          </button>
        </div>
      </div>

      {/* Conversation history list */}
      {showHistory && (
        <div className="ai-chat-panel__convo-list">
          {convoList.map((c) => (
            <div
              key={c.id}
              className={'ai-chat-panel__convo-item' + (c.id === activeConvoId ? ' ai-chat-panel__convo-item--active' : '')}
            >
              <button
                className="ai-chat-panel__convo-main"
                onClick={() => handleSwitchConvo(c.id)}
                type="button"
              >
                <span className="ai-chat-panel__convo-title">{c.title}</span>
                <span className="ai-chat-panel__convo-date">
                  {new Date(c.updatedAt).toLocaleDateString()}
                </span>
              </button>
              <button
                className="ai-chat-panel__convo-delete"
                onClick={(e) => { e.stopPropagation(); handleDeleteConvo(c.id); }}
                type="button"
                title="Delete conversation"
              >
                &#x2715;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Status bar + model selector */}
      {aiConfigured !== null && (
        <div
          className={`ai-chat-panel__status ${
            aiConfigured
              ? 'ai-chat-panel__status--ok'
              : 'ai-chat-panel__status--error'
          }`}
        >
          {aiConfigured ? (
            <div className="ai-chat-panel__status-row">
              <span>Connected</span>
              {models.length > 0 && (
                <select
                  className="ai-chat-panel__model-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={loading}
                >
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m.replace('Qwen3-VL-', '').replace('-Instruct', '').replace('-Thinking', ' Think')}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            'AI not configured'
          )}
        </div>
      )}

      {/* Messages area */}
      {messages.length === 0 && !loading ? (
        <div className="ai-chat-panel__empty">
          Ask a question about your LaTeX project
        </div>
      ) : (
        <div className="ai-chat-panel__messages">
          {messages.map((msg, i) => (
            <AiMessage key={i} message={msg} />
          ))}
          {loading && (
            <div className="ai-chat-panel__loading">
              <span className="ai-chat-panel__loading-dot" />
              <span className="ai-chat-panel__loading-dot" />
              <span className="ai-chat-panel__loading-dot" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input area */}
      <div className="ai-chat-panel__input-area">
        {mentionActive && mentionFiltered.length > 0 && (
          <FileMentionPopup
            query={mentionQuery}
            files={mentionFiltered}
            selectedIndex={mentionIndex}
            onSelect={handleMentionSelect}
            onClose={() => setMentionActive(false)}
          />
        )}
        <textarea
          ref={inputRef}
          className="ai-chat-panel__input"
          placeholder="Ask about your project..."
          value={input}
          onChange={(e) => {
            const val = e.target.value;
            setInput(val);
            // Detect @ mention trigger
            const cursor = e.target.selectionStart ?? val.length;
            const before = val.slice(0, cursor);
            const atIdx = before.lastIndexOf('@');
            if (atIdx >= 0 && (atIdx === 0 || before[atIdx - 1] === ' ' || before[atIdx - 1] === '\n')) {
              const query = before.slice(atIdx + 1);
              if (!query.includes(' ') && !query.includes('\n')) {
                setMentionActive(true);
                setMentionQuery(query);
                setMentionStart(atIdx);
                setMentionIndex(0);
                return;
              }
            }
            setMentionActive(false);
          }}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={loading}
        />
        {loading ? (
          <button
            className="ai-chat-panel__stop-btn"
            onClick={() => abortRef.current?.abort()}
            type="button"
            aria-label="Stop generation"
          >
            &#x25A0;
          </button>
        ) : (
          <button
            className="ai-chat-panel__send-btn"
            onClick={handleSend}
            disabled={!input.trim()}
            type="button"
            aria-label="Send message"
          >
            &#10148;
          </button>
        )}
      </div>
    </aside>
  );
};

export default AiChatPanel;
