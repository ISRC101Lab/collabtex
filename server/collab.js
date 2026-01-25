import { Server } from '@hocuspocus/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseCookieHeader } from './lib/cookies.js'
import { verifySession } from './lib/session.js'
import { atomicWriteFile } from './lib/atomic_write.js'
import { loadProjects, canAccessProject, resolveProjectFilePath, projectPath } from './lib/projects.js'
import { recordHistory } from './lib/history.js'
import { ensureDir } from './lib/paths.js'

function parseDocName(documentName) {
  const idx = documentName.indexOf(':')
  if (idx === -1) throw new Error('bad documentName')
  const projectId = documentName.slice(0, idx)
  const fileEnc = documentName.slice(idx + 1)
  const filePath = decodeURIComponent(fileEnc)
  return { projectId, filePath }
}

function stripLatexComment(line) {
  let out = ''
  let escaped = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '%' && !escaped) break
    if (ch === '\\\\' && !escaped) {
      escaped = true
      out += ch
      continue
    }
    escaped = false
    out += ch
  }
  return out
}

function findFirstEndDocumentIndex(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  let offset = 0
  for (const line of lines) {
    const clean = stripLatexComment(line)
    const idx = clean.indexOf('\\end{document}')
    if (idx !== -1) {
      return offset + idx
    }
    offset += line.length + 1
  }
  return -1
}

function trimRepeatedDocument(text) {
  const raw = String(text || '')
  const docClassCount = (raw.match(/\\documentclass\b/g) || []).length
  const beginCount = (raw.match(/\\begin\s*\{document\}/g) || []).length
  const endCount = (raw.match(/\\end\s*\{document\}/g) || []).length
  if (docClassCount <= 1 && beginCount <= 1 && endCount <= 1) return raw
  const endIdx = findFirstEndDocumentIndex(raw)
  if (endIdx === -1) return raw
  const endLen = '\\end{document}'.length
  return raw.slice(0, endIdx + endLen) + '\n'
}

function trimAfterEndDocument(text) {
  const raw = String(text || '')
  const endIdx = findFirstEndDocumentIndex(raw)
  if (endIdx === -1) return raw
  const endLen = '\\end{document}'.length
  const tail = raw.slice(endIdx + endLen)
  if (!tail) return raw
  const lines = tail.replace(/\r/g, '').split('\n')
  const hasContent = lines.some((line) => stripLatexComment(line).trim().length > 0)
  if (!hasContent) return raw
  return raw.slice(0, endIdx + endLen) + '\n'
}

const DUP_TAIL_SIZES = [100000, 50000, 20000, 10000, 5000, 2000]
function dedupeRepeatedTail(text) {
  let raw = String(text || '')
  let changed = true
  while (changed) {
    changed = false
    const dynSizes = []
    if (raw.length > 4000) {
      dynSizes.push(Math.floor(raw.length / 2))
      dynSizes.push(Math.floor(raw.length / 3))
      dynSizes.push(Math.floor(raw.length / 4))
    }
    const sizes = Array.from(new Set([...dynSizes, ...DUP_TAIL_SIZES])).filter((n) => n > 1200)
    for (const size of sizes) {
      if (raw.length < size * 2) continue
      const tail = raw.slice(-size)
      const prev = raw.slice(-size * 2, -size)
      if (tail === prev) {
        raw = raw.slice(0, -size)
        changed = true
        break
      }
    }
  }
  return raw
}

function dedupeRepeatedWhole(text) {
  const raw = String(text || '')
  const trimmed = raw.replace(/\s+$/, '')
  const len = trimmed.length
  if (len < 2000) return raw
  for (const n of [2, 3, 4]) {
    if (len % n !== 0) continue
    const chunkLen = len / n
    if (chunkLen < 1800) continue
    const chunk = trimmed.slice(0, chunkLen)
    let ok = true
    for (let i = 1; i < n; i += 1) {
      if (trimmed.slice(i * chunkLen, (i + 1) * chunkLen) !== chunk) {
        ok = false
        break
      }
    }
    if (ok) return chunk + '\n'
  }
  return raw
}

export function createCollabServer({ dataDir, session, host = '0.0.0.0' }) {
  const server = Server.configure({
    address: host,
    // Persist to real .tex files on disk with debounce; this is our source of truth for compilation.
    debounce: Number(process.env.STORE_DEBOUNCE_MS || 500),

    async onConnect(data) {
      const cookies = parseCookieHeader(data.requestHeaders?.cookie)
      let token = cookies[session.cookieName]
      if (!token) {
        const auth = data.requestHeaders?.authorization || data.requestHeaders?.Authorization
        if (auth && typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
          token = auth.slice(7).trim()
        }
      }
      if (!token) {
        const params = data.requestParameters || {}
        if (typeof params.token === 'string') token = params.token
      }
      const sess = verifySession(session.secret, token)
      if (!sess?.username) throw new Error('unauthorized')

      const { projectId } = parseDocName(data.documentName)
      const projectsDb = await loadProjects(dataDir)
      const project = projectsDb.projects.find((p) => p.id === projectId)
      if (!project) throw new Error('project not found')
      if (!canAccessProject(project, sess.username)) throw new Error('forbidden')

      data.context.user = { username: sess.username, isAdmin: !!sess.isAdmin }
      data.context.project = project
    },

    async onLoadDocument(data) {
      const { projectId, filePath } = parseDocName(data.documentName)
      const abs = resolveProjectFilePath(dataDir, projectId, filePath)

      await ensureDir(path.dirname(abs))
      let content = ''
      try {
        content = await fs.readFile(abs, 'utf8')
      } catch {
        content = ''
      }

      const ytext = data.document.getText('content')
      if (ytext.length === 0 && content) {
        ytext.insert(0, content)
      }
      if (ytext.length === 0 && !content) {
        // Ensure the file exists on disk so compilation doesn't fail on missing input files.
        await atomicWriteFile(abs, '')
      }
    },

    async onStoreDocument(data) {
      const { projectId, filePath } = parseDocName(data.documentName)
      const abs = resolveProjectFilePath(dataDir, projectId, filePath)
      await ensureDir(path.dirname(abs))
      const ytext = data.document.getText('content')
      const rawText = ytext.toString()
      let text = rawText
      text = trimRepeatedDocument(text)
      text = trimAfterEndDocument(text)
      text = dedupeRepeatedWhole(text)
      text = dedupeRepeatedTail(text)
      if (text !== rawText) {
        ytext.delete(0, ytext.length)
        ytext.insert(0, text)
      }
      await atomicWriteFile(abs, text)

      // Touch a small marker so the web UI can detect recent activity if needed.
      const marker = path.join(projectPath(dataDir, projectId), '.last_edit')
      await atomicWriteFile(marker, new Date().toISOString() + '\n')

      try {
        await recordHistory({
          dataDir,
          projectId,
          filePath,
          user: data.context?.user?.username,
          content: text,
        })
      } catch {
        // ignore history errors
      }
    },
  })

  return server
}
