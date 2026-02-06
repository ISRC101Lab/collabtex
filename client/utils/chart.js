function detectDelimiter(line) {
  if (line.includes("\t")) return "\t";
  if (line.includes(";") && !line.includes(",")) return ";";
  return ",";
}

export function parseTable(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delim = detectDelimiter(lines[0]);
  return lines.map((line) => line.split(delim).map((value) => value.trim()));
}

function isNumeric(val) {
  if (val === null || val === undefined) return false;
  const text = String(val).trim();
  if (!text) return false;
  return Number.isFinite(Number(text));
}

export function generatePgfplots({
  type,
  table,
  header,
  xlabel,
  ylabel,
  title,
  caption,
  label,
  theme = "default",
  smooth = false,
  stacked = false,
  xVals,
  series,
  style,
} = {}) {
  let rowsTable = Array.isArray(table) ? table : [];
  let hasHeader = !!header;

  if (!rowsTable.length && Array.isArray(xVals) && Array.isArray(series) && series.length) {
    const names = series.map((item, idx) => String((item && item.name) || `Series ${idx + 1}`));
    const rows = xVals.map((x, idx) => [x, ...series.map((item) => (item && Array.isArray(item.values) ? item.values[idx] : ""))]);
    rowsTable = [["x", ...names], ...rows];
    hasHeader = true;
  }

  if (!rowsTable.length) return "";

  let rows = rowsTable;
  let seriesNames = [];
  if (hasHeader) {
    const head = rows[0];
    rows = rows.slice(1);
    seriesNames = head.slice(1).filter(Boolean);
  }
  if (!rows.length) return "";

  const chartType = String(type || "line");
  const xValues = rows.map((row) => row[0]);
  const xIsNumeric = xValues.every((x) => isNumeric(x));
  const seriesCount = Math.max(1, rows[0].length - 1);
  if (!seriesNames.length) {
    seriesNames = Array.from({ length: seriesCount }, (_, idx) => `Series ${idx + 1}`);
  }

  const normalizedTheme = String(theme || style || "default") === "gray" ? "mono" : String(theme || style || "default");
  const palettes = {
    default: ["blue!70!black", "red!70!black", "green!60!black", "magenta!70!black", "cyan!60!black", "black"],
    vivid: ["blue", "red", "green", "magenta", "cyan", "black"],
    mono: ["black", "black!70", "black!55", "black!40", "black!25"],
  };
  const palette = palettes[normalizedTheme] || palettes.default;
  const pickColor = (idx) => palette[idx % palette.length];

  const axis = [];
  axis.push("width=0.9\\\\linewidth");
  axis.push("height=0.55\\\\linewidth");
  if (xlabel) axis.push(`xlabel={${xlabel}}`);
  if (ylabel) axis.push(`ylabel={${ylabel}}`);
  if (title) axis.push(`title={${title}}`);
  axis.push("grid=both");
  axis.push("tick style={black!60}");
  axis.push("label style={font=\\\\small}");
  axis.push("legend style={font=\\\\small}");
  if (chartType === "bar") {
    axis.push(stacked ? "ybar stacked" : "ybar");
    axis.push("bar width=12pt");
    axis.push("enlarge x limits=0.15");
  }
  if (!xIsNumeric) {
    const uniq = [];
    const seen = new Set();
    for (const x of xValues) {
      const value = String(x).trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      uniq.push(value);
    }
    if (uniq.length) {
      axis.push(`symbolic x coords={${uniq.join(",")}}`);
      axis.push("xtick=data");
    }
  }
  if (seriesNames.length > 1) {
    axis.push("legend style={at={(0.5,-0.22)},anchor=north,legend columns=2}");
  }

  const lines = [];
  lines.push("\\\\begin{figure}[t]");
  lines.push("  \\\\centering");
  lines.push("  \\\\begin{tikzpicture}");
  lines.push(`    \\\\begin{axis}[${axis.join(", ")}]`);

  for (let index = 0; index < seriesCount; index += 1) {
    const coords = [];
    for (const row of rows) {
      if (!row.length) continue;
      const x = row[0];
      const y = row[index + 1];
      if (x === undefined || y === undefined || String(y).trim() === "") continue;
      coords.push(`(${x},${y})`);
    }

    const color = pickColor(index);
    const styleParts = [];
    if (chartType === "bar") {
      styleParts.push(`fill=${color}`, "draw=none");
      if (stacked) styleParts.push("area legend");
    } else {
      styleParts.push(`color=${color}`);
      if (chartType === "scatter") {
        styleParts.push("only marks", "mark=*");
      } else {
        styleParts.push("mark=*");
        if (smooth) styleParts.push("smooth");
      }
      styleParts.push("line width=1pt");
    }

    const drawStyle = styleParts.join(", ");
    lines.push(`      \\\\addplot+[${drawStyle}] coordinates {`);
    lines.push(`        ${coords.join(" ")}`);
    lines.push("      };");
    if (seriesNames[index]) lines.push(`      \\\\addlegendentry{${seriesNames[index]}}`);
  }

  lines.push("    \\\\end{axis}");
  lines.push("  \\\\end{tikzpicture}");
  if (caption) lines.push(`  \\\\caption{${caption}}`);
  if (label) lines.push(`  \\\\label{${label}}`);
  lines.push("\\\\end{figure}");
  return lines.join("\n");
}

export function buildFigureSnippet({ filePath, width, caption, label }) {
  const widthVal = width && width.trim() ? width.trim() : "0.8\\linewidth";
  const lines = [
    "\\begin{figure}[t]",
    "  \\centering",
    `  \\includegraphics[width=${widthVal}]{${filePath}}`,
  ];
  if (caption && caption.trim()) lines.push(`  \\caption{${caption.trim()}}`);
  if (label && label.trim()) lines.push(`  \\label{${label.trim()}}`);
  lines.push("\\end{figure}");
  return lines.join("\n");
}
