const aiDefaults = {
  apiKey: localStorage.getItem("ct_ai_key") || "",
  baseUrl: localStorage.getItem("ct_ai_base") || "",
  model: localStorage.getItem("ct_ai_model") || "",
  apiStyle: localStorage.getItem("ct_ai_style") || "responses",
};

const AI_PROFILE_KEY = "ct_ai_profiles";
const AI_ACTIVE_PROFILE_KEY = "ct_ai_profile_active";
const AI_PROFILE_POLISH_KEY = "ct_ai_profile_polish";
const AI_PROFILE_CHAT_KEY = "ct_ai_profile_chat";
const AI_PROFILE_DIAG_KEY = "ct_ai_profile_diag";

function mkAiProfileId() {
  return `ai_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function normalizeAiProfile(p, fallbackName) {
  const obj = p && typeof p === "object" ? p : {};
  return {
    id: String(obj.id || mkAiProfileId()),
    name: String(obj.name || fallbackName || "Model"),
    apiKey: String(obj.apiKey || ""),
    baseUrl: String(obj.baseUrl || ""),
    model: String(obj.model || ""),
    apiStyle: String(obj.apiStyle || ""),
  };
}

function loadAiProfilesFromStorage() {
  try {
    const raw = localStorage.getItem(AI_PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((p, i) => normalizeAiProfile(p, `Model ${i + 1}`));
      }
    }
  } catch {
    // ignore parse errors
  }
  const legacy = normalizeAiProfile(
    {
      id: "default",
      name: "Default",
      apiKey: aiDefaults.apiKey,
      baseUrl: aiDefaults.baseUrl,
      model: aiDefaults.model,
      apiStyle: aiDefaults.apiStyle,
    },
    "Default"
  );
  return [legacy];
}

function saveAiProfilesToStorage(list) {
  try {
    localStorage.setItem(AI_PROFILE_KEY, JSON.stringify(list || []));
  } catch {
    // ignore storage errors
  }
}

export {
  aiDefaults,
  AI_PROFILE_KEY,
  AI_ACTIVE_PROFILE_KEY,
  AI_PROFILE_POLISH_KEY,
  AI_PROFILE_CHAT_KEY,
  AI_PROFILE_DIAG_KEY,
  mkAiProfileId,
  normalizeAiProfile,
  loadAiProfilesFromStorage,
  saveAiProfilesToStorage,
};
