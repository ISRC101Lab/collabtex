export function isPathUnderPrefix(path, prefix) {
  if (!path || !prefix) return false;
  if (path === prefix) return true;
  return path.startsWith(`${prefix}/`);
}

export function remapPathPrefix(path, fromPrefix, toPrefix) {
  const from = String(fromPrefix || "").replace(/\/+$/, "");
  const to = String(toPrefix || "").replace(/\/+$/, "");
  if (!from) return path;
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return path;
}

export function remapPathList(list, fromPrefix, toPrefix) {
  const out = [];
  const seen = new Set();
  for (const p of list || []) {
    const next = remapPathPrefix(p, fromPrefix, toPrefix);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

export function filterPathList(list, prefix) {
  return (list || []).filter((p) => !isPathUnderPrefix(p, prefix));
}

export function remapPathSet(set, fromPrefix, toPrefix) {
  const out = new Set();
  for (const p of set || []) {
    const next = remapPathPrefix(p, fromPrefix, toPrefix);
    if (next) out.add(next);
  }
  return out;
}

export function filterPathSet(set, prefix) {
  const out = new Set();
  for (const p of set || []) {
    if (!isPathUnderPrefix(p, prefix)) out.add(p);
  }
  return out;
}

export function normalizeTagList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((v) => String(v || "").trim()).filter(Boolean)));
  }
  if (!value) return [];
  const raw = String(value || "");
  const parts = raw.split(/[,，;；]/).map((v) => v.trim()).filter(Boolean);
  return Array.from(new Set(parts)).slice(0, 20);
}

export function formatTagList(tags) {
  const list = Array.isArray(tags) ? tags : normalizeTagList(tags || "");
  return list.filter(Boolean);
}

export function projectMatchesFilter(project, filterText, category) {
  if (!project) return false;
  const cat = String(category || "all");
  if (cat && cat !== "all") {
    if (String(project.category || "") !== cat) return false;
  }
  const q = String(filterText || "").trim().toLowerCase();
  if (!q) return true;
  const tags = formatTagList(project.tags || []).join(" ").toLowerCase();
  const hay = [project.name, project.id, project.owner, project.category, tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function projectMatchesScope(project, scope, me) {
  if (!project) return false;
  const mode = String(scope || "all");
  if (mode === "mine") return !!me && project.owner === me.username;
  if (mode === "shared") return !!me && project.owner !== me.username;
  return true;
}

export function formatProjectAge(project, t) {
  const stamp = project && (project.updatedAt || project.createdAt);
  const ts = stamp ? Date.parse(stamp) : NaN;
  if (!Number.isFinite(ts)) return "";
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("刚刚");
  if (mins < 60) return t("{n}分钟", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("{n}小时", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("{n}天", { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t("{n}月", { n: months });
  const years = Math.floor(months / 12);
  return t("{n}年", { n: years });
}
