import archiver from 'archiver'
import path from 'node:path'
import fs from 'node:fs'
import { requireAuth } from '../lib/session.js'
import { loadProjects, canAccess } from '../lib/projects.js'
import { projectDir } from '../lib/paths.js'

export function registerDownloadRoutes({ app, dataDir, session }) {
  const auth = requireAuth(session)

  // Download entire project as zip
  app.get('/api/projects/:id/download', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const projDir = projectDir(dataDir, project.id)
    if (!fs.existsSync(projDir)) {
      return res.status(404).json({ error: 'project directory not found' })
    }

    const safeName = project.name.replace(/[^a-zA-Z0-9_\-. ]/g, '_')
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', (err) => {
      res.status(500).end()
    })
    archive.pipe(res)
    archive.directory(projDir, false)
    await archive.finalize()
  })
}
