import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("../", import.meta.url).pathname);
const clientDir = path.join(root, "client");
const publicDir = path.join(root, "public");

await fs.mkdir(publicDir, { recursive: true });

// Copy static files
const buildId = Date.now().toString();
const indexSrc = await fs.readFile(path.join(clientDir, "index.html"), "utf8");
const indexOut = indexSrc.replaceAll("{{BUILD_ID}}", buildId);
await fs.writeFile(path.join(publicDir, "index.html"), indexOut);
await fs.copyFile(path.join(clientDir, "style.css"), path.join(publicDir, "style.css"));
try {
  const assetsSrc = path.join(clientDir, "assets");
  const assetsDst = path.join(publicDir, "assets");
  await fs.cp(assetsSrc, assetsDst, { recursive: true });
} catch {
  // ignore if assets not present yet
}
// Copy modular styles (if present)
try {
  const stylesSrc = path.join(clientDir, "styles");
  const stylesDst = path.join(publicDir, "styles");
  await fs.cp(stylesSrc, stylesDst, { recursive: true });
} catch {
  // ignore if styles not present
}
// PDF.js worker
try {
  const workerSrc = path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
  await fs.copyFile(workerSrc, path.join(publicDir, "pdf.worker.min.mjs"));
} catch {
  // ignore if dependency not installed yet
}

// PDF.js CMaps and standard fonts (for CJK rendering)
try {
  const cmapsSrc = path.join(root, "node_modules", "pdfjs-dist", "cmaps");
  const cmapsDst = path.join(publicDir, "cmaps");
  await fs.cp(cmapsSrc, cmapsDst, { recursive: true });
} catch {
  // ignore if dependency not installed yet
}
try {
  const fontsSrc = path.join(root, "node_modules", "pdfjs-dist", "standard_fonts");
  const fontsDst = path.join(publicDir, "standard_fonts");
  await fs.cp(fontsSrc, fontsDst, { recursive: true });
} catch {
  // ignore if dependency not installed yet
}

await esbuild.build({
  entryPoints: [path.join(clientDir, "app.js")],
  bundle: true,
  format: "esm",
  target: "es2020",
  sourcemap: true,
  outfile: path.join(publicDir, "bundle.js"),
});

console.log("Built to", publicDir);
