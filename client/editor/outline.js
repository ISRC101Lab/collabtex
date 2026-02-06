const OUTLINE_RE =
  /^\\(chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\\[[^\\]]*\\])?\s*{([^}]*)}/;

function readInput(input, maxChars) {
  const limit = Math.max(1, Number(maxChars) || 1_500_000);
  if (input && typeof input === "object" && typeof input.sliceString === "function") {
    const total = Number.isFinite(input.length) ? Number(input.length) : null;
    const end = total !== null ? Math.min(limit, total) : limit;
    const text = input.sliceString(0, end);
    const truncated = total !== null ? total > limit : false;
    return { text: String(text || ""), truncated };
  }
  const raw = String(input || "");
  if (raw.length > limit) {
    return { text: raw.slice(0, limit), truncated: true };
  }
  return { text: raw, truncated: false };
}

function headingLevel(kind) {
  if (kind === "chapter") return 0;
  if (kind === "section") return 1;
  if (kind === "subsection") return 2;
  if (kind === "subsubsection") return 3;
  if (kind === "paragraph") return 4;
  return 5;
}

export function extractOutline(text, { maxChars = 1_500_000 } = {}) {
  const { text: clipped, truncated } = readInput(text, maxChars);
  const lines = clipped.split(/\r?\n/);
  const items = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%")) continue;
    const m = trimmed.match(OUTLINE_RE);
    if (!m) continue;

    const kind = m[1];
    const title = (m[2] || "").trim() || "(untitled)";
    items.push({ title, level: headingLevel(kind), line: i + 1, kind });
  }

  return {
    items,
    truncated,
  };
}

export function sameOutline(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (!ai || !bi) return false;
    if (ai.title !== bi.title || ai.level !== bi.level || ai.line !== bi.line || ai.kind !== bi.kind) {
      return false;
    }
  }
  return true;
}
