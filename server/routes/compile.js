import { spawn } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { requireAuth } from '../lib/session.js'
import { loadProjects, canAccess } from '../lib/projects.js'
import { projectDir, ensureDir } from '../lib/paths.js'

export function registerCompileRoutes({ app, dataDir, session }) {
  const auth = requireAuth(session)

  // Compile project
  app.post('/api/projects/:id/compile', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const compiler = req.body?.compiler || project.compiler || 'pdflatex'
    const mainFile = req.body?.mainFile || project.mainFile || 'main.tex'
    const dir = projectDir(dataDir, project.id)
    const buildDir = path.join(dir, 'build')
    ensureDir(buildDir)

    try {
      const result = await runLatex(compiler, mainFile, dir, buildDir)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: 'compile failed', message: err.message })
    }
  })

  // Get compiled PDF
  app.get('/api/projects/:id/pdf', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const mainFile = project.mainFile || 'main.tex'
    const pdfName = mainFile.replace(/\.tex$/, '.pdf')
    const buildDir = path.join(projectDir(dataDir, project.id), 'build')
    const pdfPath = path.join(buildDir, pdfName)

    try {
      await fs.access(pdfPath)
      res.setHeader('Content-Type', 'application/pdf')
      res.sendFile(pdfPath)
    } catch {
      res.status(404).json({ error: 'pdf not found, compile first' })
    }
  })

  // Get compile log
  app.get('/api/projects/:id/compile/log', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const mainFile = project.mainFile || 'main.tex'
    const logName = mainFile.replace(/\.tex$/, '.log')
    const buildDir = path.join(projectDir(dataDir, project.id), 'build')
    const logPath = path.join(buildDir, logName)

    try {
      const content = await fs.readFile(logPath, 'utf8')
      res.json({ log: content })
    } catch {
      res.status(404).json({ error: 'log not found' })
    }
  })
}

const ALLOWED_COMPILERS = ['pdflatex', 'xelatex', 'lualatex', 'latexmk']

function runLatex(compiler, mainFile, srcDir, buildDir) {
  if (!ALLOWED_COMPILERS.includes(compiler)) {
    return Promise.reject(new Error(`unsupported compiler: ${compiler}`))
  }

  const args = compiler === 'latexmk'
    ? ['-pdf', '-synctex=1', '-interaction=nonstopmode', `-output-directory=${buildDir}`, mainFile]
    : ['-synctex=1', '-interaction=nonstopmode', `-output-directory=${buildDir}`, mainFile]

  return new Promise((resolve, reject) => {
    const proc = spawn(compiler, args, {
      cwd: srcDir,
      timeout: 60_000,
      env: { ...process.env, TEXMFOUTPUT: buildDir },
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => { stderr += d })

    proc.on('close', code => {
      const pdfName = mainFile.replace(/\.tex$/, '.pdf')
      const pdfExists = fsSync.existsSync(path.join(buildDir, pdfName))
      resolve({
        ok: code === 0 && pdfExists,
        code,
        pdfExists,
        stdout: stdout.slice(-4000),
        stderr: stderr.slice(-2000),
      })
    })

    proc.on('error', err => reject(err))
  })
}
