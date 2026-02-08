import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function ensureDataDir() {
  const dir = process.env.DATA_DIR || path.resolve(__dirname, '../../aitex-data')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function projectDir(dataDir, projectId) {
  return path.join(dataDir, 'projects', projectId)
}
