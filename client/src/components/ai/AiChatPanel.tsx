import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as api from '@/api/client';
import type { AiStreamEvent, FileChange, ToolCall } from '@/api/client';
import { useUiStore } from '@/stores/uiStore';
import { useEditorStore } from '@/stores/editorStore';
import { usePendingChangesStore } from '@/stores/pendingChangesStore';
import { useConversationStore, loadConvoMessages, saveConvoMessages } from '@/stores/conversationStore';
import AiMessage, { type ChatMessage } from '@/components/ai/AiMessage';
import FileMentionPopup from '@/components/ai/FileMentionPopup';
import './AiChatPanel.css';

interface AiChatPanelProps {
  projectId: string;
  showCollapse?: boolean;
  onCollapse?: () => void;
  onActivate?: () => void;
}

const AiChatPanel: React.FC<AiChatPanelProps> = ({ projectId, showCollapse, onCollapse, onActivate }) => {
  const activeConvoId = useConversationStore((s) => s.activeConvoId);
  const updateConvoMeta = useConversationStore((s) => s.updateConvoMeta);
  const selectedModel = useConversationStore((s) => s.selectedModel);
  const activeConvoIdRef = useRef(activeConvoId);
  const skipNextSaveRef = useRef(false);

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadConvoMessages(projectId, activeConvoId),
  );
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);

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
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (!messages.some((m) => m.streaming)) {
      const convoId = activeConvoIdRef.current;
      saveConvoMessages(projectId, convoId, messages);
      const firstUserMsg = messages.find((m) => m.role === 'user');
      const title = firstUserMsg?.content?.slice(0, 40) || 'New Chat';
      updateConvoMeta(convoId, title);
    }
  }, [messages, projectId, updateConvoMeta]);

  // Reload when convo changes
  useEffect(() => {
    activeConvoIdRef.current = activeConvoId;
    skipNextSaveRef.current = true;
    setMessages(loadConvoMessages(projectId, activeConvoId));
  }, [projectId, activeConvoId]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesRef.current = messages;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Build history for the API (only role + content)
  const buildHistoryFrom = useCallback((baseMessages: ChatMessage[]): api.ChatHistoryMessage[] => {
    return baseMessages
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));
  }, []);

  const resolveMentions = useCallback(async (text: string) => {
    const mentionRegex = /@([\w./_-]+)/g;
    const mentions = [...text.matchAll(mentionRegex)].map((m) => m[1]);
    const validMentions = mentions.filter((m) => fileTree.includes(m));

    if (validMentions.length === 0) return text;

    const contextBlocks: string[] = [];
    for (const filePath of validMentions) {
      try {
        const res = await api.getFile(projectId, filePath);
        contextBlocks.push(`[Context: @${filePath}]\n${res.content}\n[End context]`);
      } catch {
        // skip unreadable files
      }
    }

    if (contextBlocks.length === 0) return text;
    return contextBlocks.join('\n\n') + '\n\n' + text;
  }, [fileTree, projectId]);

  const startStream = useCallback(async (messageToSend: string, baseMessages: ChatMessage[]) => {
    setLoading(true);

    const streamMsg: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
      toolCalls: [],
      fileChanges: [],
      thinking: '',
    };
    setMessages([...baseMessages, streamMsg]);

    const abort = new AbortController();
    abortRef.current = abort;

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
      const history = buildHistoryFrom(baseMessages);
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
              if (event.name === 'compile_project') {
                try {
                  const res = JSON.parse(event.result);
                  if (res.ok && res.pdfExists) {
                    window.dispatchEvent(new CustomEvent('aitex:compile-done'));
                  }
                } catch {
                  // ignore parse errors
                }
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
      updateStream({ streaming: false, timestamp: Date.now() });
      setLoading(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }, [addToast, buildHistoryFrom, fetchTree, projectId, refreshFile, selectedModel]);

  // Send message handler (SSE streaming)
  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setMentionActive(false);

    const userMsg: ChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    const baseMessages = [...messagesRef.current, userMsg];
    setMessages(baseMessages);
    setInput('');

    const messageToSend = await resolveMentions(trimmed);
    await startStream(messageToSend, baseMessages);
  }, [input, loading, resolveMentions, startStream]);

  const handleEditStart = useCallback((index: number) => {
    const msg = messagesRef.current[index];
    if (!msg || msg.role !== 'user') return;
    setEditingIndex(index);
    setEditDraft(msg.content);
  }, []);

  const handleEditCancel = useCallback(() => {
    setEditingIndex(null);
    setEditDraft('');
  }, []);

  const handleEditSave = useCallback(async (index: number) => {
    if (loading) return;
    const trimmed = editDraft.trim();
    if (!trimmed) return;

    abortRef.current?.abort();

    const prev = messagesRef.current;
    if (!prev[index] || prev[index].role !== 'user') return;

    const updated: ChatMessage[] = prev.slice(0, index + 1).map((m, i) =>
      i === index ? { ...m, content: trimmed, timestamp: Date.now() } : m,
    );

    setEditingIndex(null);
    setEditDraft('');
    setMessages(updated);

    const messageToSend = await resolveMentions(trimmed);
    await startStream(messageToSend, updated);
  }, [editDraft, loading, resolveMentions, startStream]);

  const handleCopyMessage = useCallback((index: number) => {
    const msg = messagesRef.current[index];
    if (!msg?.content) return;
    navigator.clipboard.writeText(msg.content).then(
      () => addToast('Copied', 'success'),
      () => addToast('Copy failed', 'error'),
    );
  }, [addToast]);

  const handleRegenerateFrom = useCallback(async (index: number) => {
    if (loading) return;
    abortRef.current?.abort();

    const prev = messagesRef.current;
    const userIndex = [...prev.slice(0, index + 1)]
      .map((m, i) => ({ m, i }))
      .reverse()
      .find((item) => item.m.role === 'user')?.i;

    if (userIndex === undefined) return;

    const baseMessages = prev.slice(0, userIndex + 1);
    const userMsg = prev[userIndex];
    if (!userMsg?.content) return;

    setMessages(baseMessages);
    const messageToSend = await resolveMentions(userMsg.content);
    await startStream(messageToSend, baseMessages);
  }, [loading, resolveMentions, startStream]);

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
      {showCollapse && (
        <div className="ai-chat-panel__top">
          <span className="ai-chat-panel__grip" />
          <button
            className="ai-chat-panel__collapse"
            onClick={onCollapse}
            title="Collapse"
            type="button"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>
        </div>
      )}
      {messages.length === 0 && !loading ? (
        <div className="ai-chat-panel__empty">
          Ask a question about your LaTeX project
        </div>
      ) : (
        <div className="ai-chat-panel__messages">
          {messages.map((msg, i) => (
            <AiMessage
              key={i}
              message={msg}
              canEdit={msg.role === 'user' && !loading && !msg.streaming}
              isEditing={editingIndex === i}
              editValue={editingIndex === i ? editDraft : ''}
              onEditStart={() => handleEditStart(i)}
              onEditChange={setEditDraft}
              onEditCancel={handleEditCancel}
              onEditSave={() => handleEditSave(i)}
              onCopy={() => handleCopyMessage(i)}
              onRegenerate={() => handleRegenerateFrom(i)}
            />
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
          onFocus={() => onActivate?.()}
          onChange={(e) => {
            const val = e.target.value;
            setInput(val);
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
            <svg viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M3.5 9.5L16.5 3.5L13 16.5L9.5 11.5L3.5 9.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M9.5 11.5L16.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </aside>
  );
};

export default AiChatPanel;
