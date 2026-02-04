export function fileExt(filePath) {
  const raw = String(filePath || "").toLowerCase();
  const idx = raw.lastIndexOf(".");
  return idx === -1 ? "" : raw.slice(idx);
}

export function joinPath(base, rel) {
  if (!base) return rel;
  const b = String(base).replace(/\/+$/, "");
  const r = String(rel).replace(/^\/+/, "");
  return b ? `${b}/${r}` : r;
}

export function normalizeTexPath(raw, baseDir) {
  let p = String(raw || "").trim();
  if (!p) return "";
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1);
  }
  p = p.replace(/\\\\/g, "/").replace(/^\.\/+/, "");
  if (!fileExt(p)) p += ".tex";
  if (baseDir && !p.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(p)) {
    p = joinPath(baseDir, p);
  }
  return p.replace(/\/+/g, "/");
}

export function normalizeBibPath(raw, baseDir) {
  let p = String(raw || "").trim();
  if (!p) return "";
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1);
  }
  p = p.replace(/\\\\/g, "/").replace(/^\.\/+/, "");
  if (!fileExt(p)) p += ".bib";
  if (baseDir && !p.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(p)) {
    p = joinPath(baseDir, p);
  }
  return p.replace(/\/+/g, "/");
}
