// AI Service - Handles API calls with caching and deduplication
const aiRequestCache = new Map();
const aiRequestQueue = new Map();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const REQUEST_TIMEOUT = 30000; // 30 seconds

export class AiService {
  static async callApi(endpoint, payload, options = {}) {
    const cacheKey = this._generateCacheKey(endpoint, payload);

    // 1. Check cache
    if (aiRequestCache.has(cacheKey)) {
      const { result, timestamp } = aiRequestCache.get(cacheKey);
      if (Date.now() - timestamp < CACHE_TTL) {
        console.log(`[AI Cache Hit] ${endpoint}`);
        return result;
      } else {
        aiRequestCache.delete(cacheKey);
      }
    }

    // 2. Check if request is already in progress (deduplication)
    if (aiRequestQueue.has(cacheKey)) {
      console.log(`[AI Dedup] ${endpoint}`);
      return aiRequestQueue.get(cacheKey);
    }

    // 3. Make request
    const promise = this._makeRequest(endpoint, payload, options)
      .then(result => {
        // Cache successful result
        aiRequestCache.set(cacheKey, { result, timestamp: Date.now() });
        aiRequestQueue.delete(cacheKey);
        return result;
      })
      .catch(err => {
        aiRequestQueue.delete(cacheKey);
        throw err;
      });

    aiRequestQueue.set(cacheKey, promise);
    return promise;
  }

  static async _makeRequest(endpoint, payload, options = {}) {
    const timeout = options.timeout || REQUEST_TIMEOUT;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(`/api/ai/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static _generateCacheKey(endpoint, payload) {
    // Create a deterministic cache key
    const payloadStr = JSON.stringify(payload);
    return `${endpoint}:${payloadStr}`;
  }

  static clearCache() {
    aiRequestCache.clear();
    console.log('[AI Cache] Cleared');
  }

  static getCacheStats() {
    return {
      cacheSize: aiRequestCache.size,
      queueSize: aiRequestQueue.size,
      cacheEntries: Array.from(aiRequestCache.keys())
    };
  }
}

// Convenience methods
export async function aiChat(payload) {
  return AiService.callApi('chat', payload);
}

export async function aiPolish(payload) {
  return AiService.callApi('polish', payload);
}

export async function aiCompileFix(payload) {
  return AiService.callApi('compile-fix', payload);
}

export async function aiCompilePatch(payload) {
  return AiService.callApi('compile-patch', payload);
}

export async function aiAgentEdit(payload) {
  return AiService.callApi('agent-edit', payload);
}

// Clear cache on page unload
window.addEventListener('beforeunload', () => {
  AiService.clearCache();
});
