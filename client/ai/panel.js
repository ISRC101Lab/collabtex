// AI Panel Component - Main UI for AI features
import { h } from '../utils/dom.js';

let aiPanelState = {
  isOpen: false,
  activeTab: 'chat',
  chatHistory: [],
  isLoading: false,
  selectedText: '',
  currentFile: '',
};

export function createAiPanel() {
  return h('div.ai-panel', { id: 'ai-panel', style: 'display:none' }, [
    h('div.ai-header', [
      h('div.ai-title', [
        h('span.ai-icon', '✨'),
        h('h3', 'AI 助手')
      ]),
      h('button.ai-close-btn', {
        onclick: () => closeAiPanel(),
        title: '关闭 (Esc)'
      }, '✕')
    ]),

    h('div.ai-tabs', [
      h('button.ai-tab-btn.active', {
        'data-tab': 'chat',
        onclick: (e) => switchAiTab('chat', e)
      }, '💬 聊天'),
      h('button.ai-tab-btn', {
        'data-tab': 'fix',
        onclick: (e) => switchAiTab('fix', e)
      }, '🔧 修复'),
      h('button.ai-tab-btn', {
        'data-tab': 'polish',
        onclick: (e) => switchAiTab('polish', e)
      }, '✨ 润色')
    ]),

    h('div.ai-content', [
      // Chat Tab
      h('div.ai-tab-content.active', { 'data-tab': 'chat' }, [
        h('div.ai-chat-history', { id: 'ai-chat-history' }),
        h('div.ai-input-area', [
          h('textarea.ai-input', {
            id: 'ai-input',
            placeholder: '输入指令... (Ctrl+Enter 发送)',
            rows: 3
          }),
          h('div.ai-input-actions', [
            h('button.ai-send-btn', {
              onclick: () => sendAiMessage(),
              title: 'Ctrl+Enter'
            }, '📤 发送'),
            h('button.ai-clear-btn', {
              onclick: () => clearAiChat()
            }, '🗑️ 清空')
          ])
        ])
      ]),

      // Fix Tab
      h('div.ai-tab-content', { 'data-tab': 'fix' }, [
        h('div.ai-fix-info', '编译失败时自动显示修复选项'),
        h('button.ai-fix-btn', {
          id: 'ai-fix-btn',
          onclick: () => fixCompileError(),
          disabled: true
        }, '🔧 修复编译错误'),
        h('div.ai-fix-result', { id: 'ai-fix-result' })
      ]),

      // Polish Tab
      h('div.ai-tab-content', { 'data-tab': 'polish' }, [
        h('div.ai-polish-info', '选择文本后自动填充'),
        h('textarea.ai-polish-input', {
          id: 'ai-polish-input',
          placeholder: '选中编辑器中的文本，它会自动出现在这里',
          rows: 6
        }),
        h('div.ai-polish-actions', [
          h('button.ai-polish-btn', {
            onclick: () => polishText()
          }, '✨ 润色'),
          h('button.ai-polish-replace-btn', {
            onclick: () => replaceWithPolished(),
            disabled: true,
            id: 'ai-polish-replace-btn'
          }, '✅ 替换')
        ]),
        h('div.ai-polish-result', { id: 'ai-polish-result' })
      ])
    ]),

    h('div.ai-loading', { id: 'ai-loading', style: 'display:none' }, [
      h('div.ai-spinner'),
      h('span', 'AI 处理中...')
    ]),

    h('div.ai-error', { id: 'ai-error', style: 'display:none' })
  ]);
}

export function openAiPanel() {
  const panel = document.getElementById('ai-panel');
  if (panel) {
    panel.style.display = 'flex';
    aiPanelState.isOpen = true;
    document.getElementById('ai-input')?.focus();
  }
}

export function closeAiPanel() {
  const panel = document.getElementById('ai-panel');
  if (panel) {
    panel.style.display = 'none';
    aiPanelState.isOpen = false;
  }
}

export function toggleAiPanel() {
  if (aiPanelState.isOpen) {
    closeAiPanel();
  } else {
    openAiPanel();
  }
}

function switchAiTab(tabName, event) {
  // Update active tab button
  document.querySelectorAll('.ai-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');

  // Update active tab content
  document.querySelectorAll('.ai-tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.querySelector(`.ai-tab-content[data-tab="${tabName}"]`)?.classList.add('active');

  aiPanelState.activeTab = tabName;
}

async function sendAiMessage() {
  const input = document.getElementById('ai-input');
  const question = input?.value?.trim();

  if (!question) return;

  // Get current editor context
  const editor = window.editor;
  if (!editor) {
    showAiError('编辑器未初始化');
    return;
  }

  const context = editor.state.doc.toString();
  const filePath = window.currentFilePath || '';

  // Add user message to history
  addChatMessage('user', question);
  input.value = '';

  // Show loading
  showAiLoading(true);

  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context,
        question,
        filePath,
        history: aiPanelState.chatHistory.slice(-6),
        mode: 'agent'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || '请求失败');
    }

    const data = await response.json();
    const result = data.result || '';

    // Add assistant message to history
    addChatMessage('assistant', result);

    // Show success
    showAiSuccess('AI 已回复');
  } catch (error) {
    showAiError(error.message || '发送失败');
    addChatMessage('error', `错误: ${error.message}`);
  } finally {
    showAiLoading(false);
  }
}

function addChatMessage(role, content) {
  const history = document.getElementById('ai-chat-history');
  if (!history) return;

  const messageEl = h('div.ai-chat-message', { 'data-role': role }, [
    h('div.ai-message-content', content)
  ]);

  history.appendChild(messageEl);
  history.scrollTop = history.scrollHeight;

  // Store in state
  aiPanelState.chatHistory.push({ role, content });
}

function clearAiChat() {
  const history = document.getElementById('ai-chat-history');
  if (history) {
    history.innerHTML = '';
  }
  aiPanelState.chatHistory = [];
}

async function fixCompileError() {
  // This will be called when compile fails
  // Implementation in main app
}

async function polishText() {
  const input = document.getElementById('ai-polish-input');
  const text = input?.value?.trim();

  if (!text) {
    showAiError('请输入要润色的文本');
    return;
  }

  showAiLoading(true);

  try {
    const response = await fetch('/api/ai/polish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        mode: 'polish'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || '请求失败');
    }

    const data = await response.json();
    const result = data.result || '';

    // Show result
    const resultEl = document.getElementById('ai-polish-result');
    if (resultEl) {
      resultEl.innerHTML = '';
      resultEl.appendChild(h('div.ai-polish-output', result));
    }

    // Enable replace button
    document.getElementById('ai-polish-replace-btn').disabled = false;

    showAiSuccess('润色完成');
  } catch (error) {
    showAiError(error.message || '润色失败');
  } finally {
    showAiLoading(false);
  }
}

function replaceWithPolished() {
  const resultEl = document.getElementById('ai-polish-result');
  const polishedText = resultEl?.textContent?.trim();

  if (!polishedText) {
    showAiError('没有润色结果');
    return;
  }

  // Replace in editor
  const editor = window.editor;
  if (editor) {
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: polishedText
      }
    });
    showAiSuccess('已替换');
  }
}

function showAiLoading(show) {
  const loading = document.getElementById('ai-loading');
  if (loading) {
    loading.style.display = show ? 'flex' : 'none';
  }
  aiPanelState.isLoading = show;
}

function showAiError(message) {
  const errorEl = document.getElementById('ai-error');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    setTimeout(() => {
      errorEl.style.display = 'none';
    }, 5000);
  }
}

function showAiSuccess(message) {
  // Show success message (optional)
  console.log('✅', message);
}

export function setAiSelectedText(text) {
  const input = document.getElementById('ai-polish-input');
  if (input) {
    input.value = text;
  }
  aiPanelState.selectedText = text;
}

export function getAiPanelState() {
  return aiPanelState;
}
