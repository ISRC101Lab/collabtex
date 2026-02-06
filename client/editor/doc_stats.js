import { computeDocStats } from "../utils/latex.js";

function readInput(input, maxChars = 0) {
  const limit = Math.max(0, Number(maxChars) || 0);
  if (input && typeof input === "object" && typeof input.sliceString === "function") {
    const total = Number.isFinite(input.length) ? Number(input.length) : null;
    if (limit > 0) {
      const end = total !== null ? Math.min(total, limit) : limit;
      const text = String(input.sliceString(0, end) || "");
      return { text, truncated: total !== null ? total > limit : false };
    }
    const text = String(input.sliceString(0) || "");
    return { text, truncated: false };
  }

  const raw = String(input || "");
  if (limit > 0 && raw.length > limit) {
    return { text: raw.slice(0, limit), truncated: true };
  }
  return { text: raw, truncated: false };
}

export function hashTextFast(text) {
  let hash = 0;
  const str = String(text || "");
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return String(hash);
}

export function createDocStatsCache({ maxChars = 1_500_000 } = {}) {
  let cache = new WeakMap();

  return {
    clear() {
      cache = new WeakMap();
    },
    get(doc) {
      if (doc && typeof doc === "object" && typeof doc.sliceString === "function") {
        const hit = cache.get(doc);
        if (hit) return hit;
        const { text, truncated } = readInput(doc, maxChars);
        const stats = computeDocStats(text);
        const value = { ...stats, truncated };
        cache.set(doc, value);
        return value;
      }
      const { text, truncated } = readInput(doc, maxChars);
      return { ...computeDocStats(text), truncated };
    },
  };
}

export function readTextForWork(input, { maxChars = 0 } = {}) {
  return readInput(input, maxChars);
}
