function createMemoryStorage() {
  const memory = new Map();
  return {
    getItem(key) {
      const k = String(key);
      return memory.has(k) ? memory.get(k) : null;
    },
    setItem(key, value) {
      memory.set(String(key), String(value));
    },
    removeItem(key) {
      memory.delete(String(key));
    },
    clear() {
      memory.clear();
    },
    key(index) {
      const keys = Array.from(memory.keys());
      const i = Number(index) || 0;
      return i >= 0 && i < keys.length ? keys[i] : null;
    },
    get length() {
      return memory.size;
    },
  };
}

function resolveSafeStorage(memoryStorage) {
  try {
    const nativeStorage = globalThis.localStorage;
    if (nativeStorage) {
      const probe = "__ct_probe__" + Math.random().toString(36).slice(2);
      nativeStorage.setItem(probe, "1");
      nativeStorage.removeItem(probe);
      return nativeStorage;
    }
  } catch {
    // ignore localStorage security restrictions
  }
  return memoryStorage;
}

function installSafeLocalStorage(storage) {
  try {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      enumerable: true,
      get() {
        return storage;
      },
      set() {},
    });
  } catch {
    // ignore environments that do not allow overriding localStorage
  }
}

function renderBootError(error) {
  const root = document.getElementById("app");
  if (root) {
    root.innerHTML = `
      <div class="boot-fallback" style="padding:16px;max-width:720px;margin:8vh auto;">
        <div class="boot-title" style="font-size:18px;font-weight:700;">CollabTeX 加载失败</div>
        <div class="boot-desc" style="margin-top:8px;line-height:1.6;">
          前端资源加载异常（可能是网络中断或缓存损坏）。请先点击“重试加载”。
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
          <button id="ct-retry-load" class="btn primary" type="button">重试加载</button>
          <button id="ct-hard-refresh" class="btn" type="button">强制刷新</button>
        </div>
      </div>
    `;
    const retryBtn = document.getElementById("ct-retry-load");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => {
        const next = Date.now().toString();
        import(`/bundle.js?v=${next}`)
          .then(() => {})
          .catch((e) => {
            console.error("[CollabTeX] retry load failed", e);
          });
      });
    }
    const refreshBtn = document.getElementById("ct-hard-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        const sep = location.href.includes("?") ? "&" : "?";
        location.replace(`${location.href}${sep}ct_reload=${Date.now()}`);
      });
    }
  }
  console.error("[CollabTeX] bundle load failed", error);
}

async function loadBundle(buildId) {
  const mainUrl = `/bundle.js?v=${encodeURIComponent(buildId)}`;
  try {
    await import(mainUrl);
    return;
  } catch (firstError) {
    const retryUrl = `${mainUrl}&retry=${Date.now()}`;
    try {
      await import(retryUrl);
      return;
    } catch {
      throw firstError;
    }
  }
}

const buildId = new URL(import.meta.url).searchParams.get("v") || Date.now().toString();
const safeStorage = resolveSafeStorage(createMemoryStorage());
installSafeLocalStorage(safeStorage);

loadBundle(buildId).catch(renderBootError);
