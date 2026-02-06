export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.floor(sec % 60);
  if (min < 60) return `${min}m${rem}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h${remMin}m`;
}

export function formatTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString();
}

export function formatMb(mb) {
  if (!Number.isFinite(mb)) return "-";
  return `${Math.round(mb)}MB`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(1)}GB`;
}
