import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { marked } from 'marked';
import * as api from '@/api/client';
import type { AiStreamEvent, FileChange, ToolCall } from '@/api/client';
import { useUiStore } from '@/stores/uiStore';
import { useEditorStore } from '@/stores/editorStore';
import { usePendingChangesStore } from '@/stores/pendingChangesStore';
import { useConversationStore, loadConvoMessages, saveConvoMessages } from '@/stores/conversationStore';
import type { ChatMessage } from '@/components/ai/AiMessage';
import FileMentionPopup from '@/components/ai/FileMentionPopup';
import ChevronIcon from '@/components/common/ChevronIcon';
import { WriteIcon, EditIcon, CompileIcon, FixIcon, CheckIcon, XIcon, StopIcon, ToolIcon } from '@/components/common/Icons';
import './AiChatPanel.css';

/* ── Welcome Screen (isrc101-agent inspired) ──── */

function WelcomeScreen() {
  const provider = useConversationStore((s) => s.aiProvider);
  const selectedModel = useConversationStore((s) => s.selectedModel);
  const configured = useConversationStore((s) => s.aiConfigured);

  const modelDisplay = selectedModel || provider || 'connecting...';
  const isReady = configured === true;

  return (
    <div className="ai-welcome">
      {/* ── Brand ── */}
      <div className="ai-welcome__brand">
        <pre className="ai-welcome__ascii" aria-hidden="true">{
` █████╗ ██╗████████╗███████╗██╗  ██╗
██╔══██╗██║╚══██╔══╝██╔════╝╚██╗██╔╝
███████║██║   ██║   █████╗   ╚███╔╝
██╔══██║██║   ██║   ██╔══╝   ██╔██╗
██║  ██║██║   ██║   ███████╗██╔╝ ██╗
╚═╝  ╚═╝╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝`
        }</pre>
        <p className="ai-welcome__tagline">AI-Powered LaTeX Editor</p>
      </div>

      {/* ── Capabilities ── */}
      <div className="ai-welcome__caps">
        <div className="ai-welcome__cap">
          <WriteIcon className="ai-welcome__cap-icon ai-welcome__cap-icon--write" />
          <span className="ai-welcome__cap-name">write</span>
          <span className="ai-welcome__cap-desc">Generate LaTeX from natural language</span>
        </div>
        <div className="ai-welcome__cap">
          <EditIcon className="ai-welcome__cap-icon ai-welcome__cap-icon--edit" />
          <span className="ai-welcome__cap-name">edit</span>
          <span className="ai-welcome__cap-desc">Modify existing files with precision</span>
        </div>
        <div className="ai-welcome__cap">
          <CompileIcon className="ai-welcome__cap-icon ai-welcome__cap-icon--compile" />
          <span className="ai-welcome__cap-name">compile</span>
          <span className="ai-welcome__cap-desc">Build and preview your document</span>
        </div>
        <div className="ai-welcome__cap">
          <FixIcon className="ai-welcome__cap-icon ai-welcome__cap-icon--fix" />
          <span className="ai-welcome__cap-name">fix</span>
          <span className="ai-welcome__cap-desc">Diagnose and resolve compile errors</span>
        </div>
      </div>

      {/* ── Quick Tips ── */}
      <div className="ai-welcome__tips">
        <span className="ai-welcome__tip"><kbd className="ai-welcome__kbd">@</kbd> mention files</span>
        <span className="ai-welcome__tip-sep">&#xB7;</span>
        <span className="ai-welcome__tip"><kbd className="ai-welcome__kbd">Enter</kbd> send</span>
        <span className="ai-welcome__tip-sep">&#xB7;</span>
        <span className="ai-welcome__tip"><kbd className="ai-welcome__kbd">Esc</kbd> cancel</span>
      </div>

      {/* ── Status ── */}
      <div className="ai-welcome__status">
        <span className={`ai-welcome__status-dot${isReady ? ' ai-welcome__status-dot--ok' : ''}`} />
        <span className="ai-welcome__status-label">model</span>
        <span className="ai-welcome__status-value">{modelDisplay}</span>
        {isReady && <span className="ai-welcome__status-badge">ready</span>}
      </div>
    </div>
  );
}

// Configure marked
const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const langLabel = lang ? `<span class="ai-code-lang">${lang}</span>` : '';
  return `<div class="ai-code-block">${langLabel}<button class="ai-code-copy" data-code="${encodeURIComponent(text)}">Copy</button><pre><code class="language-${lang || 'text'}">${escaped}</code></pre></div>`;
};

marked.setOptions({ breaks: true, gfm: true, renderer });

interface AiChatPanelProps {
  projectId: string;
}

const TOOL_LABELS: Record<string, string> = {
  read_file: 'read',
  write_file: 'write',
  edit_file: 'edit',
  delete_file: 'delete',
  list_files: 'ls',
  compile_project: 'compile',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'new',
  write: 'mod',
  edit: 'mod',
  delete: 'del',
};

/* ── ThinkingBlock (compact) ─────────────────── */

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  if (!content) return null;
  return (
    <div className="ai-cli__thinking">
      <button
        className="ai-cli__thinking-toggle"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <ChevronIcon direction={open ? 'down' : 'right'} />
        thinking...
      </button>
      {open && <div className="ai-cli__thinking-content">{content}</div>}
    </div>
  );
}

/* ── CliEntry: renders one message ──────────── */

function CliEntry({
  msg,
  changeStates,
  onChangeState,
}: {
  msg: ChatMessage;
  changeStates: Record<number, 'accepted' | 'rejected'>;
  onChangeState: (idx: number, state: 'accepted' | 'rejected', fc: FileChange) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    if (!msg.content || msg.role === 'user') return '';
    return marked.parse(msg.content) as string;
  }, [msg.content, msg.role]);

  // Copy button handler for code blocks
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
  }, [html]);

  if (msg.role === 'user') {
    return (
      <div className="ai-cli__prompt-line">
        <span className="ai-cli__prompt-char">&gt;</span>
        <span className="ai-cli__prompt-text">{msg.content}</span>
      </div>
    );
  }

  return (
    <div className={`ai-cli__response${msg.streaming ? ' ai-cli__response--streaming' : ''}`}>
      {msg.thinking && <ThinkingBlock content={msg.thinking} />}

      {/* Tool calls */}
      {msg.toolCalls && msg.toolCalls.length > 0 && msg.toolCalls.map((tc, i) => {
        const tcPath = tc.args ? (tc.args as Record<string, unknown>).path : undefined;
        return (
          <div key={i} className="ai-cli__tool">
            <ToolIcon className="ai-cli__tool-icon" />
            <span className="ai-cli__tool-name">{TOOL_LABELS[tc.name] || tc.name}</span>
            {tcPath ? <span className="ai-cli__tool-args">{String(tcPath)}</span> : null}
          </div>
        );
      })}

      {/* Content */}
      {msg.content && (
        <div className="ai-cli__response-text" ref={contentRef}>
          <div dangerouslySetInnerHTML={{ __html: html }} />
          {msg.streaming && <span className="ai-cli__cursor" />}
        </div>
      )}

      {/* File changes */}
      {msg.fileChanges && msg.fileChanges.length > 0 && (
        <div className="ai-cli__changes">
          {msg.fileChanges.map((fc, i) => {
            const state = changeStates[i];
            if (state) {
              return (
                <div key={i} className={`ai-cli__change-resolved ai-cli__change-resolved--${state}`}>
                  <span className="ai-cli__change-resolved-icon">
                    {state === 'accepted' ? <CheckIcon className="ai-cli__icon-svg" /> : <XIcon className="ai-cli__icon-svg" />}
                  </span>
                  <span>{fc.path}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10 }}>
                    {state}
                  </span>
                </div>
              );
            }
            return (
              <div key={i} className="ai-cli__change">
                <span className={`ai-cli__change-badge ai-cli__change-badge--${fc.action}`}>
                  {ACTION_LABELS[fc.action] ?? fc.action}
                </span>
                <span className="ai-cli__change-path">{fc.path}</span>
                <div className="ai-cli__change-actions">
                  <button
                    className="ai-cli__change-btn ai-cli__change-btn--accept"
                    onClick={() => onChangeState(i, 'accepted', fc)}
                    title="Accept"
                  ><CheckIcon className="ai-cli__icon-svg" /></button>
                  <button
                    className="ai-cli__change-btn ai-cli__change-btn--reject"
                    onClick={() => onChangeState(i, 'rejected', fc)}
                    title="Reject"
                  ><XIcon className="ai-cli__icon-svg" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Main AiChatPanel (CLI mode) ─────────────── */

const AiChatPanel: React.FC<AiChatPanelProps> = ({ projectId }) => {
  const activeConvoId = useConversationStore((s) => s.activeConvoId);
  const updateConvoMeta = useConversationStore((s) => s.updateConvoMeta);
  const selectedModel = useConversationStore((s) => s.selectedModel);

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadConvoMessages(projectId, activeConvoId),
  );
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [changeStates, setChangeStates] = useState<Record<string, Record<number, 'accepted' | 'rejected'>>>({});

  const outputEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevConvoRef = useRef(activeConvoId);

  const addToast = useUiStore((s) => s.addToast);
  const compiler = useUiStore((s) => s.compiler);
  const fetchTree = useEditorStore((s) => s.fetchTree);
  const refreshFile = useEditorStore((s) => s.refreshFile);

  // Debounced fetchTree to batch rapid AI file changes
  const fetchTreeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const fetchTreeDebounced = useCallback((pid: string) => {
    clearTimeout(fetchTreeTimerRef.current);
    fetchTreeTimerRef.current = setTimeout(() => fetchTree(pid), 300);
  }, [fetchTree]);

  const fileTree = useEditorStore((s) => s.fileTree);

  // @ mention state
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);

  // Switch conversation
  useEffect(() => {
    if (activeConvoId !== prevConvoRef.current) {
      prevConvoRef.current = activeConvoId;
      setMessages(loadConvoMessages(projectId, activeConvoId));
      setChangeStates({});
    }
  }, [activeConvoId, projectId]);

  // Persist
  useEffect(() => {
    if (messages.length > 0 && !messages.some((m) => m.streaming)) {
      saveConvoMessages(projectId, activeConvoId, messages);
      const firstUserMsg = messages.find((m) => m.role === 'user');
      const title = firstUserMsg?.content?.slice(0, 40) || 'New Chat';
      updateConvoMeta(activeConvoId, title);
    }
  }, [messages, projectId, activeConvoId, updateConvoMeta]);

  // Auto-scroll
  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const buildHistory = useCallback((): api.ChatHistoryMessage[] => {
    return messages
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  const handleChangeState = useCallback((msgIdx: number, changeIdx: number, state: 'accepted' | 'rejected', fc: FileChange) => {
    if (state === 'rejected' && fc.oldContent !== null) {
      window.dispatchEvent(
        new CustomEvent('aitex:revert-file', {
          detail: { path: fc.path, content: fc.oldContent },
        }),
      );
    }
    setChangeStates((prev) => ({
      ...prev,
      [msgIdx]: { ...(prev[msgIdx] || {}), [changeIdx]: state },
    }));
  }, []);

  // Send
  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setMentionActive(false);

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
        } catch { /* skip */ }
      }
      if (contextBlocks.length > 0) {
        messageToSend = contextBlocks.join('\n\n') + '\n\n' + trimmed;
      }
    }

    const userMsg: ChatMessage = { role: 'user', content: trimmed, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
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
    setMessages((prev) => [...prev, streamMsg]);

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
        copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
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
              if (event.name === 'compile_project') {
                try {
                  const res = JSON.parse(event.result);
                  if (res.ok && res.pdfExists) {
                    window.dispatchEvent(new CustomEvent('aitex:compile-done'));
                  }
                } catch { /* ignore */ }
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
              fetchTreeDebounced(projectId);
              break;
            case 'done':
              content = event.reply || content;
              updateStream({ content, streaming: false, timestamp: Date.now() });
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
        compiler,
      );

      if (fileChangeCount > 0) {
        addToast(`AI modified ${fileChangeCount} file${fileChangeCount > 1 ? 's' : ''}`, 'info');
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
  }, [input, loading, projectId, buildHistory, addToast, selectedModel, fetchTreeDebounced, refreshFile, fileTree]);

  // @ mention select
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

  const mentionFiltered = mentionActive
    ? fileTree.filter((f) => f.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8)
    : [];

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (mentionActive && mentionFiltered.length > 0) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, mentionFiltered.length - 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
        if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); handleMentionSelect(mentionFiltered[mentionIndex]); return; }
        if (e.key === 'Escape') { e.preventDefault(); setMentionActive(false); return; }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, mentionActive, mentionFiltered, mentionIndex, handleMentionSelect],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || before[atIdx - 1] === ' ')) {
      const query = before.slice(atIdx + 1);
      if (!query.includes(' ')) {
        setMentionActive(true);
        setMentionQuery(query);
        setMentionStart(atIdx);
        setMentionIndex(0);
        return;
      }
    }
    setMentionActive(false);
  }, []);

  return (
    <aside className="ai-cli">
      {/* Output */}
      <div className="ai-cli__output">
        {messages.length === 0 && !loading && <WelcomeScreen />}
        {messages.map((msg, i) => (
          <CliEntry
            key={i}
            msg={msg}
            changeStates={changeStates[i] || {}}
            onChangeState={(ci, state, fc) => handleChangeState(i, ci, state, fc)}
          />
        ))}
        {loading && !messages[messages.length - 1]?.streaming && (
          <div className="ai-cli__loading">
            <span className="ai-cli__loading-dot" />
            <span className="ai-cli__loading-dot" />
            <span className="ai-cli__loading-dot" />
          </div>
        )}
        <div ref={outputEndRef} />
      </div>

      {/* Input */}
      <div className="ai-cli__input-area">
        {mentionActive && mentionFiltered.length > 0 && (
          <div className="ai-cli__mention-popup">
            <FileMentionPopup
              query={mentionQuery}
              files={mentionFiltered}
              selectedIndex={mentionIndex}
              onSelect={handleMentionSelect}
              onClose={() => setMentionActive(false)}
            />
          </div>
        )}
        <span className="ai-cli__input-prompt">&gt;</span>
        <input
          ref={inputRef}
          className="ai-cli__input"
          placeholder="Ask Aitex AI..."
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={loading}
          autoComplete="off"
          spellCheck={false}
        />
        {loading && (
          <button
            className="ai-cli__stop-btn"
            onClick={() => abortRef.current?.abort()}
            type="button"
            aria-label="Stop"
          >
            <StopIcon className="ai-cli__icon-svg" />
          </button>
        )}
      </div>
    </aside>
  );
};

export default AiChatPanel;
