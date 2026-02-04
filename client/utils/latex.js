import { escapeRegExp } from "./strings.js";
import { normalizeTexPath, normalizeBibPath } from "./paths.js";

export function stripLatexComment(line) {
  let out = "";
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "%" && !escaped) break;
    if (ch === "\\" && !escaped) {
      escaped = true;
      out += ch;
      continue;
    }
    escaped = false;
    out += ch;
  }
  return out;
}

export function stripLatexForCount(text) {
  let s = String(text || "");
  if (!s.trim()) return "";
  const lines = s.split(/\r?\n/).map((line) => stripLatexComment(line));
  s = lines.join("\n");
  s = s.replace(/\\(cite|citep|citet|ref|eqref|label)\*?(?:\[[^\]]*\])?\{[^}]*\}/g, " ");
  s = s.replace(/\\\[[\s\S]*?\\\]/g, " ");
  s = s.replace(/\\\([\s\S]*?\\\)/g, " ");
  s = s.replace(/\$\$[\s\S]*?\$\$/g, " ");
  s = s.replace(/\$[^$]*\$/g, " ");
  s = s.replace(/\\[a-zA-Z@]+\*?/g, "");
  s = s.replace(/\\\\/g, " ");
  s = s.replace(/~/g, " ");
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/[{}]/g, " ");
  return s;
}

export function extractIncludePaths(text, baseDir) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  const includeRe = /\\(input|include|subfile)\*?\s*(?:\[[^\]]*\\])?\s*\{([^}]+)\}/g;
  for (const line of lines) {
    const clean = stripLatexComment(line);
    if (!clean) continue;
    let m;
    while ((m = includeRe.exec(clean))) {
      const raw = m[2] || "";
      const norm = normalizeTexPath(raw, baseDir);
      if (norm) out.push(norm);
    }
  }
  return out;
}

export function extractBibPaths(text, baseDir) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  const bibRe = /\\bibliography\s*\{([^}]+)\}/g;
  const addBibRe = /\\addbibresource\s*\{([^}]+)\}/g;
  for (const line of lines) {
    const clean = stripLatexComment(line);
    if (!clean) continue;
    let m;
    while ((m = bibRe.exec(clean))) {
      const raw = m[1] || "";
      const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
      for (const part of parts) {
        const norm = normalizeBibPath(part, baseDir);
        if (norm) out.push(norm);
      }
    }
    while ((m = addBibRe.exec(clean))) {
      const raw = m[1] || "";
      const norm = normalizeBibPath(raw, baseDir);
      if (norm) out.push(norm);
    }
  }
  return out;
}

export function extractLabels(text) {
  const lines = String(text || "").split(/\r?\n/);
  const labels = [];
  const re = /\\label\*?\s*\{([^}]+)\}/g;
  for (const line of lines) {
    const clean = stripLatexComment(line);
    if (!clean) continue;
    let m;
    while ((m = re.exec(clean))) {
      const key = String(m[1] || "").trim();
      if (key) labels.push(key);
    }
  }
  return Array.from(new Set(labels));
}

export function extractBibKeys(text) {
  const raw = String(text || "");
  if (!raw.trim()) return [];
  const lines = raw.split(/\r?\n/);
  const cleaned = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("%")) continue;
    if (/^@comment/i.test(trimmed)) continue;
    cleaned.push(trimmed);
  }
  const joined = cleaned.join("\n");
  const keys = [];
  const re = /@\w+\s*\{\s*([^,\s]+)\s*,/g;
  let m;
  while ((m = re.exec(joined))) {
    const key = String(m[1] || "").trim();
    if (key) keys.push(key);
  }
  return Array.from(new Set(keys));
}

export function computeDocStats(text) {
  const plain = stripLatexForCount(text);
  if (!plain.trim()) return { words: 0, chars: 0, cjk: 0 };
  const cjkMatches = plain.match(/[\u4e00-\u9fff]/g) || [];
  const cjk = cjkMatches.length;
  const noCjk = plain.replace(/[\u4e00-\u9fff]/g, " ");
  const words = noCjk.trim() ? noCjk.trim().split(/\s+/).filter(Boolean).length : 0;
  const chars = plain.replace(/\s+/g, "").length;
  return { words, chars, cjk };
}

export function latexFoldService(state, lineStart) {
  const line = state.doc.lineAt(lineStart);
  const text = stripLatexComment(line.text);
  const m = text.match(/\\begin\s*\{([^}]+)\}/);
  if (!m) return null;

  const env = String(m[1] || "").trim();
  if (!env) return null;

  const beginRe = new RegExp(`\\\\begin\\s*\\{${escapeRegExp(env)}\\}`, "g");
  const endRe = new RegExp(`\\\\end\\s*\\{${escapeRegExp(env)}\\}`, "g");

  const countMatches = (re, s) => {
    re.lastIndex = 0;
    let count = 0;
    let mm;
    while ((mm = re.exec(s))) count += 1;
    return count;
  };

  let depth = 0;
  depth += countMatches(beginRe, text);
  depth -= countMatches(endRe, text);
  if (depth <= 0) return null;

  let pos = line.to + 1;
  while (pos <= state.doc.length) {
    const l = state.doc.lineAt(pos);
    const t = stripLatexComment(l.text);
    depth += countMatches(beginRe, t);
    depth -= countMatches(endRe, t);
    if (depth <= 0) {
      if (l.from <= line.to) return null;
      return { from: line.to, to: l.from };
    }
    pos = l.to + 1;
  }

  return null;
}
