import fs from 'node:fs'
import path from 'node:path'
import { requireAuth } from '../lib/session.js'
import { loadProjects, canAccess } from '../lib/projects.js'
import { projectDir } from '../lib/paths.js'

const TEXT_EXTS = new Set([
  '.tex', '.bib', '.sty', '.cls', '.txt', '.md',
  '.cfg', '.def', '.dtx', '.ins', '.ltx',
])

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return TEXT_EXTS.has(ext)
}

function walkDir(dir, base = '') {
  const results = []
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
  catch { return results }

  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      // Skip hidden dirs and output dirs
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      results.push(...walkDir(path.join(dir, entry.name), rel))
    } else if (isTextFile(entry.name)) {
      results.push({ abs: path.join(dir, entry.name), rel })
    }
  }
  return results
}

export function registerSearchRoutes({ app, dataDir, session }) {
  const auth = requireAuth(session)

  app.get('/api/projects/:id/search', auth, async (req, res) => {
    const q = (req.query.q || '').trim()
    if (!q) return res.json({ results: [] })

    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const projDir = projectDir(dataDir, project.id)
    if (!fs.existsSync(projDir)) {
      return res.json({ results: [] })
    }

    const files = walkDir(projDir)
    const results = []
    const MAX_RESULTS = 200
    const qLower = q.toLowerCase()

    for (const file of files) {
      if (results.length >= MAX_RESULTS) break

      let content
      try { content = fs.readFileSync(file.abs, 'utf-8') }
      catch { continue }

      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (results.length >= MAX_RESULTS) break

        const col = lines[i].toLowerCase().indexOf(qLower)
        if (col === -1) continue

        results.push({
          file: file.rel,
          line: i + 1,
          column: col + 1,
          context: lines[i].substring(
            Math.max(0, col - 40),
            Math.min(lines[i].length, col + q.length + 40),
          ),
        })
      }
    }

    res.json({ results })
  })
}
