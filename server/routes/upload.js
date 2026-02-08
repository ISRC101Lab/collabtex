import fs from 'node:fs/promises'
import path from 'node:path'
import Busboy from 'busboy'
import { requireAuth } from '../lib/session.js'
import { loadProjects, canAccess } from '../lib/projects.js'
import { projectDir, ensureDir } from '../lib/paths.js'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

function sanitizePath(p) {
  if (!p || typeof p !== 'string') return null
  const normalized = path.normalize(p).replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.startsWith('..')) return null
  if (normalized.includes('/../') || normalized === '..') return null
  return normalized
}

export function registerUploadRoutes({ app, dataDir, session }) {
  const auth = requireAuth(session)

  // Upload files via multipart/form-data
  app.post('/api/projects/:id/upload', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (project.owner !== req.user.username && !req.user.isAdmin) {
      return res.status(403).json({ error: 'only owner can upload files' })
    }

    const projDir = projectDir(dataDir, project.id)
    // Optional target directory from query param
    const targetDir = sanitizePath(req.query.dir || '') || ''

    const uploaded = []
    const errors = []

    try {
      await new Promise((resolve, reject) => {
        const busboy = Busboy({
          headers: req.headers,
          limits: { fileSize: MAX_FILE_SIZE },
        })

        busboy.on('file', (fieldname, stream, info) => {
          const filename = info.filename
          const safeName = sanitizePath(
            targetDir ? `${targetDir}/${filename}` : filename
          )

          if (!safeName) {
            stream.resume()
            errors.push({ file: filename, error: 'invalid path' })
            return
          }

          const fullPath = path.join(projDir, safeName)
          const chunks = []
          let size = 0
          let truncated = false

          stream.on('data', (chunk) => {
            size += chunk.length
            if (size <= MAX_FILE_SIZE) {
              chunks.push(chunk)
            }
          })

          stream.on('limit', () => {
            truncated = true
          })

          stream.on('end', async () => {
            if (truncated) {
              errors.push({ file: safeName, error: 'file too large (max 50MB)' })
              return
            }
            try {
              ensureDir(path.dirname(fullPath))
              await fs.writeFile(fullPath, Buffer.concat(chunks))
              uploaded.push(safeName)
            } catch (err) {
              errors.push({ file: safeName, error: err.message })
            }
          })
        })

        busboy.on('finish', () => {
          // Small delay to let async writes complete
          setTimeout(resolve, 100)
        })

        busboy.on('error', reject)
        req.pipe(busboy)
      })

      res.json({ ok: true, uploaded, errors })
    } catch (err) {
      res.status(500).json({ error: 'upload failed: ' + err.message })
    }
  })
}
