import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { ensureDir } from './paths.js'
import { projectPath, resolveProjectFilePath } from './projects.js'

const cache = new Map()

function nowIso() {
  return new Date().toISOString()
}

function fileKey(filePath) {
  return Buffer.from(String(filePath)).toString('base64url')
}

function historyRoot(projDir) {
  return path.join(projDir, '.collabtex-history')
}

function indexPathFor(projDir, filePath) {
  return path.join(historyRoot(projDir), fileKey(filePath), 'index.jsonl')
}

function snapshotPathFor(projDir, filePath, id) {
  return path.join(historyRoot(projDir), fileKey(filePath), `${id}.txt`)
}

function hashText(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex')
}

async function readIndexLines(indexPath) {
  try {
    const txt = await fs.readFile(indexPath, 'utf8')
    return txt.split(/\r?\n/).filter(Boolean)
  } catch {
    return []
  }
}

async function trimHistory(indexPath, fileDir, maxEntries) {
  const lines = await readIndexLines(indexPath)
  if (lines.length <= maxEntries) return lines.length
  const keep = lines.slice(-maxEntries)
  const keepIds = new Set()
  for (const line of keep) {
    try {
      const obj = JSON.parse(line)
      if (obj && obj.snapshot) keepIds.add(String(obj.snapshot))
    } catch {
      // ignore bad line
    }
  }
  try {
    const files = await fs.readdir(fileDir)
    for (const f of files) {
      if (f === 'index.jsonl') continue
      if (!keepIds.has(f)) {
        try { await fs.rm(path.join(fileDir, f), { force: true }) } catch {}
      }
    }
  } catch {
    // ignore
  }
  await fs.writeFile(indexPath, keep.join('\n') + '\n', 'utf8')
  return keep.length
}

export async function recordHistory({ dataDir, projectId, filePath, user, content }) {
  if (process.env.HISTORY_ENABLED === '0') return null
  if (!filePath) return null
  const projDir = projectPath(dataDir, projectId)
  const cacheKey = `${projectId}::${filePath}`
  const prev = cache.get(cacheKey) || { lastHash: null, count: 0 }
  const hash = hashText(content)
  if (prev.lastHash === hash) return null

  const maxEntries = Number(process.env.HISTORY_MAX_PER_FILE || 200)
  const ts = nowIso()
  const id = `${ts.replace(/[:.]/g, '-')}_${hash.slice(0, 8)}`
  const fileDir = path.join(historyRoot(projDir), fileKey(filePath))
  await ensureDir(fileDir)
  const indexPath = path.join(fileDir, 'index.jsonl')
  const snapshotPath = path.join(fileDir, `${id}.txt`)

  try {
    await fs.writeFile(snapshotPath, String(content), 'utf8')
  } catch {
    return null
  }

  const entry = {
    id,
    ts,
    user: user || 'unknown',
    size: Buffer.byteLength(String(content)),
    hash,
    file: filePath,
    snapshot: `${id}.txt`,
  }
  try {
    await fs.appendFile(indexPath, JSON.stringify(entry) + '\n', 'utf8')
  } catch {
    // ignore
  }

  prev.lastHash = hash
  prev.count = (prev.count || 0) + 1
  cache.set(cacheKey, prev)

  if (maxEntries > 0 && prev.count > maxEntries) {
    const count = await trimHistory(indexPath, fileDir, maxEntries)
    prev.count = count
    cache.set(cacheKey, prev)
  }

  return entry
}

export async function listHistory({ dataDir, projectId, filePath, limit = 50 }) {
  if (!filePath) return []
  const projDir = projectPath(dataDir, projectId)
  const abs = resolveProjectFilePath(dataDir, projectId, filePath)
  // Ensure safe path but do not require existing file.
  try { await fs.stat(abs) } catch {}

  const indexPath = indexPathFor(projDir, filePath)
  const lines = await readIndexLines(indexPath)
  const entries = []
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj && obj.id) entries.push(obj)
    } catch {
      // ignore
    }
  }
  const slice = entries.slice(-Math.max(1, limit)).reverse()
  return slice
}

export async function readHistoryItem({ dataDir, projectId, filePath, id }) {
  if (!filePath || !id) return null
  const projDir = projectPath(dataDir, projectId)
  const abs = resolveProjectFilePath(dataDir, projectId, filePath)
  try { await fs.stat(abs) } catch {}

  const snapshotPath = snapshotPathFor(projDir, filePath, id)
  const text = await fs.readFile(snapshotPath, 'utf8')
  return text
}
