export function diffLines(aText, bText) {
  const a = String(aText || "").split(/\r?\n/);
  const b = String(bText || "").split(/\r?\n/);
  const max = 2000;
  if (a.length > max || b.length > max) return { tooLarge: true };

  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "eq", line: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", line: a[i] });
      i += 1;
    } else {
      out.push({ type: "add", line: b[j] });
      j += 1;
    }
  }
  while (i < n) out.push({ type: "del", line: a[i++] });
  while (j < m) out.push({ type: "add", line: b[j++] });
  return { tooLarge: false, diff: out };
}

export function buildDiffSnippet(diff, { context = 2, maxLines = 400 } = {}) {
  const out = [];
  let pre = [];
  let after = 0;
  let skipped = false;
  const pushSkip = () => {
    if (out.length && out[out.length - 1].type !== "skip") out.push({ type: "skip" });
  };
  for (const row of diff) {
    if (row.type === "eq") {
      if (after > 0) {
        out.push(row);
        after -= 1;
      } else {
        pre.push(row);
        if (pre.length > context) {
          pre.shift();
          skipped = true;
        }
      }
      continue;
    }
    if (skipped) {
      pushSkip();
      skipped = false;
    }
    if (pre.length) {
      for (const r of pre) out.push(r);
      pre = [];
    }
    out.push(row);
    after = context;
    if (out.length > maxLines) break;
  }
  if (out.length > maxLines) {
    out.length = maxLines;
    out.push({ type: "skip" });
  }
  return out;
}

export function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeParagraphs(text) {
  const raw = String(text || "");
  const blocks = raw.split(/\n{2,}/);
  const out = [];
  let removed = 0;
  let lastNorm = null;
  for (const block of blocks) {
    const norm = normalizeWhitespace(block);
    if (!norm) {
      out.push(block);
      lastNorm = null;
      continue;
    }
    if (norm === lastNorm) {
      removed += 1;
      continue;
    }
    out.push(block);
    lastNorm = norm;
  }
  return { text: out.join("\n\n"), removed };
}
