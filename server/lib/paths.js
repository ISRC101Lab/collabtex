import path from 'node:path'
import fs from 'node:fs/promises'

export function packageRoot() {
  // `collabtex/server/lib/paths.js` -> `collabtex`
  return path.resolve(new URL('../../', import.meta.url).pathname)
}

export function resolveDataDir() {
  const root = packageRoot()
  const dir = process.env.DATA_DIR ? process.env.DATA_DIR : path.join(root, 'collabtex-data')
  return path.resolve(dir)
}

export async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true })
}

export function safeJoin(base, rel) {
  // Prevent path traversal.
  const relNorm = rel.replaceAll('\\', '/')
  if (relNorm.startsWith('/')) throw new Error('absolute path not allowed')
  const full = path.resolve(base, relNorm)
  const baseFull = path.resolve(base)
  if (!full.startsWith(baseFull + path.sep) && full !== baseFull) throw new Error('path escapes base')
  return full
}

