// AI Integration Module - Integrates AI panel with editor
import { createAiPanel, openAiPanel, closeAiPanel, toggleAiPanel, setAiSelectedText } from './ai/panel.js';

export function initializeAiIntegration(editor, projectId) {
  // Create and mount AI panel
  const aiPanel = createAiPanel();
  document.body.appendChild(aiPanel);

  // Store editor reference globally for AI panel to access
  window.editor = editor;
  window.currentProjectId = projectId;

  // Setup keyboard shortcuts
  setupAiKeyboardShortcuts(editor);

  // Setup editor context menu
  setupAiContextMenu(editor);

  // Setup selection tracking
  setupAiSelectionTracking(editor);

  return {
    openAiPanel,
    closeAiPanel,
    toggleAiPanel,
    setAiSelectedText
  };
}

function setupAiKeyboardShortcuts(editor) {
  document.addEventListener('keydown', (e) => {
    // Ctrl+K or Cmd+K: Toggle AI panel
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      toggleAiPanel();
    }

    // Ctrl+Enter in AI input: Send message
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const aiInput = document.getElementById('ai-input');
      if (aiInput && document.activeElement === aiInput) {
        e.preventDefault();
        const sendBtn = document.querySelector('.ai-send-btn');
        sendBtn?.click();
      }
    }

    // Escape: Close AI panel
    if (e.key === 'Escape') {
      const aiPanel = document.getElementById('ai-panel');
      if (aiPanel && aiPanel.style.display !== 'none') {
        e.preventDefault();
        closeAiPanel();
      }
    }
  });
}

function setupAiContextMenu(editor) {
  const editorDOM = editor.dom;
  if (!editorDOM) return;

  editorDOM.addEventListener('contextmenu', (e) => {
    const selection = editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to);

    if (selection.trim()) {
      e.preventDefault();

      // Show context menu with AI options
      showAiContextMenu(e.clientX, e.clientY, selection, editor);
    }
  });
}

function showAiContextMenu(x, y, selectedText, editor) {
  // Remove existing menu
  const existing = document.getElementById('ai-context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.id = 'ai-context-menu';
  menu.className = 'ai-context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  const options = [
    { label: '✨ 润色', action: () => polishSelectedText(selectedText) },
    { label: '💬 AI 聊天', action: () => chatAboutSelection(selectedText) },
    { label: '🔧 修复', action: () => fixSelectedText(selectedText) },
  ];

  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'ai-context-menu-item';
    item.textContent = opt.label;
    item.onclick = () => {
      opt.action();
      menu.remove();
    };
    menu.appendChild(item);
  });

  document.body.appendChild(menu);

  // Close menu on click outside
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  }, 0);
}

function setupAiSelectionTracking(editor) {
  editor.view.addEventListener('mouseup', () => {
    const selection = editor.state.sliceDoc(
      editor.state.selection.main.from,
      editor.state.selection.main.to
    );
    if (selection.trim()) {
      setAiSelectedText(selection);
    }
  });
}

function polishSelectedText(text) {
  const input = document.getElementById('ai-polish-input');
  if (input) {
    input.value = text;
    // Switch to polish tab
    const polishTab = document.querySelector('[data-tab="polish"]');
    polishTab?.click();
    openAiPanel();
  }
}

function chatAboutSelection(text) {
  const input = document.getElementById('ai-input');
  if (input) {
    input.value = `请帮我改进这段文本：\n\n${text}`;
    // Switch to chat tab
    const chatTab = document.querySelector('[data-tab="chat"]');
    chatTab?.click();
    openAiPanel();
    input.focus();
  }
}

function fixSelectedText(text) {
  const input = document.getElementById('ai-input');
  if (input) {
    input.value = `请修复这段代码中的问题：\n\n${text}`;
    // Switch to chat tab
    const chatTab = document.querySelector('[data-tab="chat"]');
    chatTab?.click();
    openAiPanel();
    input.focus();
  }
}

export function addAiButtonToToolbar(toolbarContainer) {
  const aiBtn = document.createElement('button');
  aiBtn.className = 'toolbar-btn ai-toolbar-btn';
  aiBtn.title = 'AI 助手 (Ctrl+K)';
  aiBtn.innerHTML = '✨ AI';
  aiBtn.onclick = () => toggleAiPanel();

  toolbarContainer.appendChild(aiBtn);
}
