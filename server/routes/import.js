import fs from 'node:fs/promises'
import path from 'node:path'
import unzipper from 'unzipper'
import { requireAuth } from '../lib/session.js'
import { createProject, loadProjects, saveProjects } from '../lib/projects.js'
import { ensureDir, projectDir } from '../lib/paths.js'

function sanitizePath(input) {
  if (!input || typeof input !== 'string') return null
  const normalized = path.normalize(input).replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.startsWith('..')) return null
  if (normalized.includes('/../') || normalized === '..') return null
  return normalized
}

async function importZip(projectId, dataDir, buffer) {
  const targetDir = projectDir(dataDir, projectId)
  ensureDir(targetDir)
  const dir = await unzipper.Open.buffer(buffer)
  const written = []

  for (const entry of dir.files) {
    const safePath = sanitizePath(entry.path)
    if (!safePath) continue
    if (safePath.startsWith('__MACOSX')) continue

    const fullPath = path.join(targetDir, safePath)
    if (!fullPath.startsWith(targetDir)) continue

    if (entry.type === 'Directory') {
      ensureDir(fullPath)
      continue
    }

    ensureDir(path.dirname(fullPath))
    const content = await entry.buffer()
    await fs.writeFile(fullPath, content)
    written.push(safePath)
  }

  return written
}

async function importJsonSnapshot(projectId, dataDir, text) {
  const targetDir = projectDir(dataDir, projectId)
  ensureDir(targetDir)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const files = parsed?.files && typeof parsed.files === 'object' ? parsed.files : null
  if (!files) return []

  const written = []
  for (const [rawPath, value] of Object.entries(files)) {
    const safePath = sanitizePath(rawPath)
    if (!safePath) continue
    if (typeof value !== 'string') continue
    const fullPath = path.join(targetDir, safePath)
    if (!fullPath.startsWith(targetDir)) continue
    ensureDir(path.dirname(fullPath))
    await fs.writeFile(fullPath, value, 'utf8')
    written.push(safePath)
  }
  return written
}

export function registerImportRoutes({ app, dataDir, session }) {
  const auth = requireAuth(session)

  app.post('/api/projects/import', auth, async (req, res) => {
    try {
      const { name, sourceType, fileName, contentBase64 } = req.body || {}
      if (!contentBase64 || typeof contentBase64 !== 'string') {
        return res.status(400).json({ error: 'missing import payload' })
      }

      const importName = (name && String(name).trim()) || 'Imported Project'
      const project = await createProject(dataDir, {
        owner: req.user.username,
        name: importName,
        mainFile: 'main.tex',
      })

      const buffer = Buffer.from(contentBase64, 'base64')
      let importedFiles = []

      if (sourceType === 'zip' || String(fileName || '').toLowerCase().endsWith('.zip')) {
        importedFiles = await importZip(project.id, dataDir, buffer)
      } else {
        importedFiles = await importJsonSnapshot(project.id, dataDir, buffer.toString('utf8'))
      }

      // If imported content includes any .tex file, use first one as main
      const firstTex = importedFiles.find((p) => p.toLowerCase().endsWith('.tex'))
      if (firstTex) {
        const db = await loadProjects(dataDir)
        const target = db.projects.find((p) => p.id === project.id)
        if (target) {
          target.mainFile = firstTex
          target.updatedAt = new Date().toISOString()
          await saveProjects(dataDir, db)
        }
      }

      const db = await loadProjects(dataDir)
      const finalProject = db.projects.find((p) => p.id === project.id) || project
      res.json({ ok: true, project: finalProject, importedCount: importedFiles.length })
    } catch (error) {
      res.status(500).json({ error: `import failed: ${error.message}` })
    }
  })
}

