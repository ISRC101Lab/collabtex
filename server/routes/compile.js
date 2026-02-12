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
    ? ['-pdf', '-interaction=nonstopmode', `-output-directory=${buildDir}`, mainFile]
    : ['-interaction=nonstopmode', `-output-directory=${buildDir}`, mainFile]

  // For non-latexmk compilers, run twice to resolve references
  const passes = compiler === 'latexmk' ? 1 : 2

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let passesCompleted = 0

    function runPass() {
      const proc = spawn(compiler, args, {
        cwd: srcDir,
        timeout: 60_000,
        env: { ...process.env, TEXMFOUTPUT: buildDir },
      })

      proc.stdout.on('data', d => { stdout += d })
      proc.stderr.on('data', d => { stderr += d })

      proc.on('close', code => {
        passesCompleted++
        if (passesCompleted < passes && code === 0) {
          // Run another pass for references
          runPass()
          return
        }
        const pdfName = mainFile.replace(/\.tex$/, '.pdf')
        const pdfExists = fsSync.existsSync(path.join(buildDir, pdfName))
        const fullLog = stdout + '\n' + stderr

        // Analyze log for common issues and provide helpful diagnostics
        const diagnostics = analyzeCompileLog(fullLog, compiler, srcDir, mainFile)

        resolve({
          ok: code === 0 && pdfExists,
          code,
          pdfExists,
          stdout: stdout.slice(-4000),
          stderr: stderr.slice(-2000),
          diagnostics,
        })
      })

      proc.on('error', err => reject(err))
    }

    runPass()
  })
}

/**
 * Analyze compile log for common issues and return helpful diagnostics.
 */
function analyzeCompileLog(log, compiler, srcDir, mainFile) {
  const hints = []

  // Read main .tex source to detect CJK content
  let texSource = ''
  try {
    texSource = fsSync.readFileSync(path.join(srcDir, mainFile), 'utf8')
  } catch { /* ignore */ }

  const hasCjkPackage = /\\usepackage.*\{ctex\}|\\usepackage.*\{xeCJK\}|\\usepackage.*\{CJKutf8\}/i.test(texSource)
  const hasCjkChars = /[\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\u{2a700}-\u{2b73f}\u3000-\u303f\uff00-\uffef]/u.test(texSource)
  const hasFontError = /Font .+ not found|mktexpk: don't know how to create bitmap font/i.test(log)
  const hasNoPages = /No pages of output/i.test(log)
  const isPdflatex = compiler === 'pdflatex'

  // CJK content + pdflatex => suggest xelatex
  if (isPdflatex && (hasCjkPackage || hasCjkChars) && (hasFontError || hasNoPages)) {
    hints.push({
      type: 'compiler_mismatch',
      severity: 'error',
      message: hasCjkPackage
        ? `Your document uses a CJK package (ctex/xeCJK) which requires XeLaTeX or LuaLaTeX. Current compiler is pdfLaTeX. Switch to XeLaTeX to compile correctly.`
        : `Your document contains Chinese/CJK characters but is compiled with pdfLaTeX, which has limited CJK support. Switch to XeLaTeX for proper CJK rendering.`,
      suggestion: 'xelatex',
    })
  }

  // CJK chars detected without CJK package
  if (hasCjkChars && !hasCjkPackage && (hasFontError || hasNoPages)) {
    hints.push({
      type: 'missing_cjk_package',
      severity: 'warning',
      message: `Chinese/CJK characters detected but no CJK support package found. Add \\usepackage[UTF8]{ctex} and compile with XeLaTeX.`,
      suggestion: 'xelatex',
    })
  }

  // Generic font not found
  if (hasFontError && !hasCjkPackage && !hasCjkChars) {
    const fontMatch = log.match(/Font (.+?) (?:at \d+)? ?not found/i)
    hints.push({
      type: 'font_missing',
      severity: 'error',
      message: fontMatch
        ? `Font "${fontMatch[1].trim()}" not found. Try a different compiler (XeLaTeX) or install the required font package.`
        : `A required font is missing. Try switching to XeLaTeX or installing the font package.`,
    })
  }

  // No pages of output without CJK issues
  if (hasNoPages && hints.length === 0) {
    hints.push({
      type: 'no_output',
      severity: 'error',
      message: `No pages of output. The document may be empty or have a structural error (e.g., \\end{document} before content).`,
    })
  }

  return hints
}
