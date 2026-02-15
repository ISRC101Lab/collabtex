import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import { requireAuth } from '../lib/session.js'
import { loadProjects, canAccess } from '../lib/projects.js'
import { projectDir } from '../lib/paths.js'

export function registerSyncTexRoutes({ app, dataDir, session }) {
  const auth = requireAuth(session)

  app.post('/api/projects/:id/synctex/forward', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const { file, line, column } = req.body || {}
    if (typeof file !== 'string' || typeof line !== 'number') {
      return res.status(400).json({ error: 'missing file or line' })
    }

    const safeFile = sanitizePath(file)
    if (!safeFile) return res.status(400).json({ error: 'invalid file path' })

    const srcPath = path.join(projectDir(dataDir, project.id), safeFile)
    const { pdfPath, synctexPath } = getPdfPaths(dataDir, project)

    try {
      await fs.access(pdfPath)
      await fs.access(synctexPath)
    } catch {
      return res.status(404).json({ error: 'synctex not found, compile first' })
    }

    const col = typeof column === 'number' ? Math.max(1, Math.floor(column)) : 1
    try {
      const output = await runSyncTex([
        'view',
        '-i',
        `${Math.max(1, Math.floor(line))}:${col}:${srcPath}`,
        '-o',
        pdfPath,
      ])
      const result = parseForward(output)
      if (!result) return res.status(404).json({ error: 'no synctex match' })
      res.json({ ok: true, ...result })
    } catch (err) {
      res.status(500).json({ error: 'synctex failed', message: err.message })
    }
  })

  app.post('/api/projects/:id/synctex/inverse', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const { page, x, y } = req.body || {}
    if (typeof page !== 'number' || typeof x !== 'number' || typeof y !== 'number') {
      return res.status(400).json({ error: 'missing page or coordinates' })
    }

    const { pdfPath, synctexPath } = getPdfPaths(dataDir, project)

    try {
      await fs.access(pdfPath)
      await fs.access(synctexPath)
    } catch {
      return res.status(404).json({ error: 'synctex not found, compile first' })
    }

    try {
      const output = await runSyncTex([
        'edit',
        '-o',
        `${Math.max(1, Math.floor(page))}:${x}:${y}:${pdfPath}`,
      ])
      const result = parseInverse(output, projectDir(dataDir, project.id))
      if (!result) return res.status(404).json({ error: 'no synctex match' })
      res.json({ ok: true, ...result })
    } catch (err) {
      res.status(500).json({ error: 'synctex failed', message: err.message })
    }
  })
}

function getPdfPaths(dataDir, project) {
  const mainFile = project.mainFile || 'main.tex'
  const pdfName = mainFile.replace(/\.tex$/, '.pdf')
  const synctexName = mainFile.replace(/\.tex$/, '.synctex.gz')
  const buildDir = path.join(projectDir(dataDir, project.id), 'build')
  return {
    pdfPath: path.join(buildDir, pdfName),
    synctexPath: path.join(buildDir, synctexName),
  }
}

function sanitizePath(p) {
  if (!p || typeof p !== 'string') return null
  const normalized = path.normalize(p).replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.startsWith('..')) return null
  if (normalized.includes('/../') || normalized === '..') return null
  return normalized
}

function runSyncTex(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('synctex', args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => { stderr += d })

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr || `synctex exited with code ${code}`))
        return
      }
      resolve(stdout)
    })

    proc.on('error', err => reject(err))
  })
}

function parseForward(output) {
  const pageMatch = output.match(/Page:(\d+)/)
  const xMatch = output.match(/\bx:([+-]?[0-9.]+)/)
  const yMatch = output.match(/\by:([+-]?[0-9.]+)/)
  if (!pageMatch || !xMatch || !yMatch) return null
  return {
    page: Number(pageMatch[1]),
    x: Number(xMatch[1]),
    y: Number(yMatch[1]),
  }
}

function parseInverse(output, projectPath) {
  const inputMatch = output.match(/Input:(.+)/)
  const lineMatch = output.match(/Line:(\d+)/)
  const colMatch = output.match(/Column:(\d+)/)
  if (!inputMatch || !lineMatch) return null

  const absPath = inputMatch[1].trim()
  let relPath = path.relative(projectPath, absPath).replace(/\\/g, '/')
  if (!relPath || relPath.startsWith('..')) {
    relPath = absPath
  }

  return {
    file: relPath,
    line: Number(lineMatch[1]),
    column: colMatch ? Number(colMatch[1]) : 1,
  }
}
