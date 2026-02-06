const memory = new Map();

const memoryStorage = {
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

function getNativeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

const nativeStorage = getNativeStorage();

export const safeStorage = {
  getItem(key) {
    if (nativeStorage) {
      try {
        const value = nativeStorage.getItem(String(key));
        if (value !== null) {
          memoryStorage.setItem(key, value);
          return value;
        }
      } catch {
        // ignore native storage read errors
      }
    }
    return memoryStorage.getItem(key);
  },
  setItem(key, value) {
    const k = String(key);
    const v = String(value);
    if (nativeStorage) {
      try {
        nativeStorage.setItem(k, v);
      } catch {
        // ignore native storage write errors
      }
    }
    memoryStorage.setItem(k, v);
  },
  removeItem(key) {
    const k = String(key);
    if (nativeStorage) {
      try {
        nativeStorage.removeItem(k);
      } catch {
        // ignore native storage remove errors
      }
    }
    memoryStorage.removeItem(k);
  },
  clear() {
    if (nativeStorage) {
      try {
        nativeStorage.clear();
      } catch {
        // ignore native storage clear errors
      }
    }
    memoryStorage.clear();
  },
  key(index) {
    const i = Number(index) || 0;
    if (nativeStorage) {
      try {
        const value = nativeStorage.key(i);
        if (value !== null) return value;
      } catch {
        // ignore native storage key errors
      }
    }
    return memoryStorage.key(i);
  },
  get length() {
    if (nativeStorage) {
      try {
        return nativeStorage.length;
      } catch {
        // ignore native storage length errors
      }
    }
    return memoryStorage.length;
  },
};
