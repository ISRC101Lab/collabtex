import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("../", import.meta.url).pathname);
const clientDir = path.join(root, "client");
const publicDir = path.join(root, "public");

await fs.mkdir(publicDir, { recursive: true });

// Copy static files
await fs.copyFile(path.join(clientDir, "index.html"), path.join(publicDir, "index.html"));
await fs.copyFile(path.join(clientDir, "style.css"), path.join(publicDir, "style.css"));
// PDF.js worker
try {
  const workerSrc = path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
  await fs.copyFile(workerSrc, path.join(publicDir, "pdf.worker.min.mjs"));
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
