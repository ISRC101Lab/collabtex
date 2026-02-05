// AI Config Manager - Manage AI model configurations
import { loadAiProfilesFromStorage, saveAiProfilesToStorage, normalizeAiProfile, mkAiProfileId } from './profiles.js';

export class AiConfigManager {
  static profiles = [];
  static activeProfileId = 'default';

  static init() {
    this.profiles = loadAiProfilesFromStorage();
    this.activeProfileId = localStorage.getItem('ct_ai_active_profile') || 'default';
  }

  static getProfiles() {
    return this.profiles;
  }

  static getActiveProfile() {
    return this.profiles.find(p => p.id === this.activeProfileId) || this.profiles[0];
  }

  static setActiveProfile(profileId) {
    if (this.profiles.find(p => p.id === profileId)) {
      this.activeProfileId = profileId;
      localStorage.setItem('ct_ai_active_profile', profileId);
      return true;
    }
    return false;
  }

  static addProfile(name, config) {
    const profile = normalizeAiProfile({
      id: mkAiProfileId(),
      name,
      ...config
    });
    this.profiles.push(profile);
    saveAiProfilesToStorage(this.profiles);
    return profile;
  }

  static updateProfile(profileId, updates) {
    const profile = this.profiles.find(p => p.id === profileId);
    if (!profile) return false;

    Object.assign(profile, normalizeAiProfile(updates));
    saveAiProfilesToStorage(this.profiles);
    return true;
  }

  static deleteProfile(profileId) {
    if (profileId === 'default') return false; // Cannot delete default

    const index = this.profiles.findIndex(p => p.id === profileId);
    if (index === -1) return false;

    this.profiles.splice(index, 1);
    if (this.activeProfileId === profileId) {
      this.activeProfileId = this.profiles[0]?.id || 'default';
      localStorage.setItem('ct_ai_active_profile', this.activeProfileId);
    }

    saveAiProfilesToStorage(this.profiles);
    return true;
  }

  static async testConnection(profile) {
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: 'Test',
          question: 'Say "OK"',
          apiKey: profile.apiKey,
          baseUrl: profile.baseUrl,
          model: profile.model,
          apiStyle: profile.apiStyle
        })
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}

export function createAiConfigPanel() {
  const container = document.createElement('div');
  container.id = 'ai-config-panel';
  container.className = 'ai-config-panel';

  container.innerHTML = `
    <div class="ai-config-header">
      <h3>AI 模型配置</h3>
      <button class="ai-config-close" onclick="document.getElementById('ai-config-panel').remove()">✕</button>
    </div>

    <div class="ai-config-content">
      <div class="ai-profiles-list" id="ai-profiles-list"></div>

      <div class="ai-config-form">
        <h4>新增配置</h4>
        <div class="ai-form-group">
          <label>配置名称</label>
          <input type="text" id="ai-config-name" placeholder="e.g., GPT-4, Claude">
        </div>

        <div class="ai-form-group">
          <label>API Key</label>
          <input type="password" id="ai-config-key" placeholder="sk-...">
        </div>

        <div class="ai-form-group">
          <label>Base URL</label>
          <input type="text" id="ai-config-url" placeholder="https://api.openai.com/v1">
        </div>

        <div class="ai-form-group">
          <label>模型名称</label>
          <input type="text" id="ai-config-model" placeholder="gpt-4o-mini">
        </div>

        <div class="ai-form-group">
          <label>API 风格</label>
          <select id="ai-config-style">
            <option value="">自动检测</option>
            <option value="chat">Chat Completions</option>
            <option value="responses">Responses</option>
          </select>
        </div>

        <div class="ai-config-actions">
          <button class="ai-config-test" onclick="window.testAiConnection()">🧪 测试连接</button>
          <button class="ai-config-add" onclick="window.addAiProfile()">➕ 添加</button>
        </div>
      </div>
    </div>
  `;

  return container;
}

export function renderAiProfilesList() {
  const list = document.getElementById('ai-profiles-list');
  if (!list) return;

  AiConfigManager.init();
  const profiles = AiConfigManager.getProfiles();
  const activeId = AiConfigManager.activeProfileId;

  list.innerHTML = profiles.map(profile => `
    <div class="ai-profile-item ${profile.id === activeId ? 'active' : ''}">
      <div class="ai-profile-info">
        <div class="ai-profile-name">${profile.name}</div>
        <div class="ai-profile-model">${profile.model || '未配置'}</div>
      </div>
      <div class="ai-profile-actions">
        <button class="ai-profile-select" onclick="window.selectAiProfile('${profile.id}')">
          ${profile.id === activeId ? '✓ 已选' : '选择'}
        </button>
        ${profile.id !== 'default' ? `
          <button class="ai-profile-delete" onclick="window.deleteAiProfile('${profile.id}')">删除</button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

// Global functions for UI callbacks
window.testAiConnection = async function() {
  const name = document.getElementById('ai-config-name')?.value;
  const key = document.getElementById('ai-config-key')?.value;
  const url = document.getElementById('ai-config-url')?.value;
  const model = document.getElementById('ai-config-model')?.value;
  const style = document.getElementById('ai-config-style')?.value;

  if (!key || !url || !model) {
    alert('请填写 API Key、Base URL 和模型名称');
    return;
  }

  const testBtn = document.querySelector('.ai-config-test');
  testBtn.disabled = true;
  testBtn.textContent = '测试中...';

  const profile = { apiKey: key, baseUrl: url, model, apiStyle: style };
  const success = await AiConfigManager.testConnection(profile);

  testBtn.disabled = false;
  testBtn.textContent = success ? '✓ 连接成功' : '✗ 连接失败';

  setTimeout(() => {
    testBtn.textContent = '🧪 测试连接';
  }, 3000);
};

window.addAiProfile = function() {
  const name = document.getElementById('ai-config-name')?.value?.trim();
  const key = document.getElementById('ai-config-key')?.value?.trim();
  const url = document.getElementById('ai-config-url')?.value?.trim();
  const model = document.getElementById('ai-config-model')?.value?.trim();
  const style = document.getElementById('ai-config-style')?.value;

  if (!name || !key || !url || !model) {
    alert('请填写所有必填项');
    return;
  }

  AiConfigManager.addProfile(name, { apiKey: key, baseUrl: url, model, apiStyle: style });

  // Clear form
  document.getElementById('ai-config-name').value = '';
  document.getElementById('ai-config-key').value = '';
  document.getElementById('ai-config-url').value = '';
  document.getElementById('ai-config-model').value = '';
  document.getElementById('ai-config-style').value = '';

  renderAiProfilesList();
  alert('配置已添加');
};

window.selectAiProfile = function(profileId) {
  AiConfigManager.setActiveProfile(profileId);
  renderAiProfilesList();
};

window.deleteAiProfile = function(profileId) {
  if (confirm('确定要删除此配置吗？')) {
    AiConfigManager.deleteProfile(profileId);
    renderAiProfilesList();
  }
};

window.openAiConfigPanel = function() {
  const existing = document.getElementById('ai-config-panel');
  if (existing) existing.remove();

  const panel = createAiConfigPanel();
  document.body.appendChild(panel);
  renderAiProfilesList();
};
