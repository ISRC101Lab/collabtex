// Compile Error Handler - Auto AI diagnosis for compile failures
import { aiCompileFix, aiCompilePatch, aiAgentEdit } from '../services/ai.js';

export class CompileErrorHandler {
  static async handleCompileError(projectId, log, diagnostics, mainFile, targetFile, compiler, files) {
    if (!log || !log.trim()) return null;

    try {
      // Show AI diagnosis UI
      this._showDiagnosisUI(projectId, log, diagnostics);

      // Auto-diagnose in background
      const diagnosis = await aiCompileFix({
        log,
        diagnostics,
        mainFile,
        targetFile,
        compiler,
        files: files || []
      });

      return diagnosis;
    } catch (error) {
      console.error('[Compile Error Handler] Diagnosis failed:', error);
      return null;
    }
  }

  static _showDiagnosisUI(projectId, log, diagnostics) {
    const compilePanel = document.getElementById('compile-panel');
    if (!compilePanel) return;

    // Add AI diagnosis section
    let diagnosisSection = document.getElementById('ai-diagnosis-section');
    if (!diagnosisSection) {
      diagnosisSection = document.createElement('div');
      diagnosisSection.id = 'ai-diagnosis-section';
      diagnosisSection.className = 'ai-diagnosis-section';
      compilePanel.appendChild(diagnosisSection);
    }

    diagnosisSection.innerHTML = `
      <div class="ai-diagnosis-header">
        <span class="ai-diagnosis-icon">✨</span>
        <span>AI 诊断中...</span>
      </div>
      <div class="ai-diagnosis-buttons">
        <button class="ai-diagnosis-btn" onclick="window.aiDiagnoseCompile('${projectId}')">
          🔍 查看诊断
        </button>
        <button class="ai-fix-btn" onclick="window.aiFixCompile('${projectId}')">
          🔧 一键修复
        </button>
      </div>
    `;
  }

  static async autoFixCompile(projectId, log, diagnostics, mainFile, targetFile, compiler, files) {
    try {
      // Get AI patch suggestions
      const patchResult = await aiCompilePatch({
        log,
        diagnostics,
        mainFile,
        targetFile,
        compiler,
        files: files || []
      });

      if (!patchResult) return null;

      // Parse result
      let edits = [];
      let notes = '';

      try {
        const parsed = typeof patchResult === 'string' ? JSON.parse(patchResult) : patchResult;
        edits = parsed.edits || [];
        notes = parsed.notes || '';
      } catch {
        notes = patchResult;
      }

      return { edits, notes };
    } catch (error) {
      console.error('[Compile Error Handler] Auto-fix failed:', error);
      return null;
    }
  }

  static async applyFix(projectId, edits) {
    if (!edits || edits.length === 0) return false;

    try {
      // Apply each edit
      for (const edit of edits) {
        await fetch(`/api/projects/${projectId}/file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: edit.path,
            content: edit.content
          })
        });
      }

      return true;
    } catch (error) {
      console.error('[Compile Error Handler] Apply fix failed:', error);
      return false;
    }
  }
}

// Global functions for UI callbacks
window.aiDiagnoseCompile = async function(projectId) {
  const diagnosisSection = document.getElementById('ai-diagnosis-section');
  if (!diagnosisSection) return;

  diagnosisSection.innerHTML = `
    <div class="ai-diagnosis-loading">
      <div class="ai-spinner"></div>
      <span>获取诊断中...</span>
    </div>
  `;

  // Trigger diagnosis
  // This will be called from compile panel
};

window.aiFixCompile = async function(projectId) {
  const diagnosisSection = document.getElementById('ai-diagnosis-section');
  if (!diagnosisSection) return;

  diagnosisSection.innerHTML = `
    <div class="ai-diagnosis-loading">
      <div class="ai-spinner"></div>
      <span>修复中...</span>
    </div>
  `;

  // Trigger fix
  // This will be called from compile panel
};
