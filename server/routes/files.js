import fs from 'node:fs/promises'
import path from 'node:path'
import { requireAuth } from '../lib/session.js'
import { loadProjects, canAccess } from '../lib/projects.js'
import { projectDir, ensureDir } from '../lib/paths.js'

export function registerFileRoutes({ app, dataDir, session }) {
  const auth = requireAuth(session)

  // Read file
  app.get('/api/projects/:id/files/*', auth, async (req, res) => {
    const filePath = req.params[0]
    if (!filePath) return res.status(400).json({ error: 'missing path' })

    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const safePath = sanitizePath(filePath)
    if (!safePath) return res.status(400).json({ error: 'invalid path' })

    const full = path.join(projectDir(dataDir, project.id), safePath)
    try {
      const content = await fs.readFile(full, 'utf8')
      res.json({ path: safePath, content })
    } catch {
      res.status(404).json({ error: 'file not found' })
    }
  })

  // Write file
  app.put('/api/projects/:id/files/*', auth, async (req, res) => {
    const filePath = req.params[0]
    if (!filePath) return res.status(400).json({ error: 'missing path' })

    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const safePath = sanitizePath(filePath)
    if (!safePath) return res.status(400).json({ error: 'invalid path' })

    const { content } = req.body || {}
    if (typeof content !== 'string') return res.status(400).json({ error: 'missing content' })

    const full = path.join(projectDir(dataDir, project.id), safePath)

    // Collaborators can only edit existing files, not create new ones
    if (project.owner !== req.user.username && !req.user.isAdmin) {
      try { await fs.access(full) } catch {
        return res.status(403).json({ error: 'only owner can create new files' })
      }
    }

    ensureDir(path.dirname(full))
    await fs.writeFile(full, content, 'utf8')
    res.json({ ok: true, path: safePath })
  })

  // Delete file (owner only)
  app.delete('/api/projects/:id/files/*', auth, async (req, res) => {
    const filePath = req.params[0]
    if (!filePath) return res.status(400).json({ error: 'missing path' })

    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (project.owner !== req.user.username && !req.user.isAdmin) {
      return res.status(403).json({ error: 'only owner can delete files' })
    }

    const safePath = sanitizePath(filePath)
    if (!safePath) return res.status(400).json({ error: 'invalid path' })

    const full = path.join(projectDir(dataDir, project.id), safePath)
    try {
      const stat = await fs.stat(full)
      if (stat.isDirectory()) {
        await fs.rm(full, { recursive: true })
      } else {
        await fs.unlink(full)
      }
      res.json({ ok: true })
    } catch {
      res.status(404).json({ error: 'file not found' })
    }
  })

  // Create folder (owner only)
  app.post('/api/projects/:id/mkdir', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (project.owner !== req.user.username && !req.user.isAdmin) {
      return res.status(403).json({ error: 'only owner can create folders' })
    }

    const { folderPath } = req.body || {}
    const safePath = sanitizePath(folderPath)
    if (!safePath) return res.status(400).json({ error: 'invalid path' })

    const full = path.join(projectDir(dataDir, project.id), safePath)
    await fs.mkdir(full, { recursive: true })
    res.json({ ok: true, path: safePath })
  })

  // Rename / move file (owner only)
  app.post('/api/projects/:id/rename', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (project.owner !== req.user.username && !req.user.isAdmin) {
      return res.status(403).json({ error: 'only owner can rename files' })
    }

    const { from, to } = req.body || {}
    const safeFrom = sanitizePath(from)
    const safeTo = sanitizePath(to)
    if (!safeFrom || !safeTo) return res.status(400).json({ error: 'invalid paths' })

    const dir = projectDir(dataDir, project.id)
    const srcFull = path.join(dir, safeFrom)
    const dstFull = path.join(dir, safeTo)

    ensureDir(path.dirname(dstFull))
    await fs.rename(srcFull, dstFull)
    res.json({ ok: true, from: safeFrom, to: safeTo })
  })
}

function sanitizePath(p) {
  if (!p || typeof p !== 'string') return null
  const normalized = path.normalize(p).replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.startsWith('..')) return null
  if (normalized.includes('/../') || normalized === '..') return null
  return normalized
}
