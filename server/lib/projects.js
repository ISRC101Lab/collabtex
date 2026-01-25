import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { atomicWriteFile } from './atomic_write.js'
import { ensureDir, resolveDataDir, safeJoin } from './paths.js'

const DEFAULT_MAIN_TEMPLATE = [
  '\\documentclass{article}',
  '\\begin{document}',
  'Hello, CollabTeX!',
  '\\end{document}',
  '',
].join('\n')

function isDefaultTemplate(text) {
  const tpl = DEFAULT_MAIN_TEMPLATE.replace(/\s+/g, '')
  const norm = String(text || '').replace(/\s+/g, '')
  if (!norm) return false
  if (norm.length % tpl.length !== 0) return false
  return norm === tpl.repeat(norm.length / tpl.length)
}

async function safeTrash(rootDir, absPath, trashRoot) {
  const rel = path.relative(rootDir, absPath).replaceAll('\\', '/')
  const dst = path.join(trashRoot, rel)
  await ensureDir(path.dirname(dst))
  try {
    await fs.rename(absPath, dst)
    return true
  } catch {
    try {
      const buf = await fs.readFile(absPath)
      await fs.writeFile(dst, buf)
      await fs.rm(absPath, { force: true })
      return true
    } catch {
      return false
    }
  }
}

async function walkDirs(rootDir, onFile, onDir, skipDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  for (const ent of entries) {
    const abs = path.join(rootDir, ent.name)
    if (skipDir && ent.isDirectory() && skipDir(ent.name, abs)) continue
    if (ent.isDirectory()) {
      await walkDirs(abs, onFile, onDir, skipDir)
      if (onDir) await onDir(abs)
    } else if (ent.isFile()) {
      if (onFile) await onFile(abs)
    }
  }
}

export async function cleanupProject(rootDir, mainFile, { force = false } = {}) {
  const autoCleanup = process.env.AUTO_CLEANUP === '0' ? false : true
  if (!autoCleanup) return { cleaned: false }

  const markPath = path.join(rootDir, '.collabtex-cleaned')
  if (!force) {
    try {
      await fs.stat(markPath)
      return { cleaned: false }
    } catch {
      // continue
    }
  }

  const trashRoot = path.join(
    rootDir,
    '.collabtex-trash',
    new Date().toISOString().replace(/[:.]/g, '-')
  )
  const cleaned = { trashed: [], removedDirs: 0 }

  const baseDir = mainFile ? path.resolve(rootDir, path.dirname(mainFile)) : rootDir
  const rootMain = path.join(rootDir, 'main.tex')
  if (mainFile && mainFile !== 'main.tex') {
    try {
      const txt = await fs.readFile(rootMain, 'utf8')
      if (isDefaultTemplate(txt)) {
        const ok = await safeTrash(rootDir, rootMain, trashRoot)
        if (ok) cleaned.trashed.push('main.tex')
      }
    } catch {
      // ignore if not present
    }
  }

  const autoCleanEmpty = process.env.AUTO_CLEAN_EMPTY === '0' ? false : true
  if (autoCleanEmpty) {
    await walkDirs(
      rootDir,
      async (abs) => {
        try {
          const st = await fs.stat(abs)
          if (st.size !== 0) return
          const rel = path.relative(rootDir, abs)
          if (!rel) return
          if (abs === rootMain) return
          if (baseDir && abs.startsWith(baseDir + path.sep)) return
          const ok = await safeTrash(rootDir, abs, trashRoot)
          if (ok) cleaned.trashed.push(rel.replaceAll('\\', '/'))
        } catch {
          // ignore
        }
      },
      async (abs) => {
        if (abs === rootDir) return
        try {
          const entries = await fs.readdir(abs)
          if (entries.length === 0) {
            await fs.rmdir(abs)
            cleaned.removedDirs += 1
          }
        } catch {
          // ignore
        }
      },
      (name) => name === 'build' || name.startsWith('.')
    )
  }

  try {
    await fs.writeFile(
      markPath,
      JSON.stringify({ cleanedAt: new Date().toISOString(), ...cleaned }, null, 2) + '\n',
      'utf8'
    )
  } catch {
    // ignore
  }

  return { cleaned: true, ...cleaned }
}

function projectsPath(dataDir) {
  return path.join(dataDir, 'projects.json')
}

function projectsDir(dataDir) {
  return path.join(dataDir, 'projects')
}

export async function loadProjects(dataDir) {
  const p = projectsPath(dataDir)
  try {
    const raw = await fs.readFile(p, 'utf8')
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') throw new Error('bad projects.json')
    if (!Array.isArray(obj.projects)) obj.projects = []
    // Backward-compatible defaults.
    for (const pr of obj.projects) {
      if (!pr || typeof pr !== 'object') continue
      if (!Array.isArray(pr.collaborators)) pr.collaborators = []
      if (!pr.mainFile) pr.mainFile = 'main.tex'
      if (!pr.compiler) pr.compiler = 'pdflatex'
      if (!Array.isArray(pr.tags)) pr.tags = []
      if (!pr.category) pr.category = ''
    }
    return obj
  } catch {
    return { projects: [] }
  }
}

export async function saveProjects(dataDir, obj) {
  await ensureDir(dataDir)
  await atomicWriteFile(projectsPath(dataDir), JSON.stringify(obj, null, 2) + '\n')
}

export function canAccessProject(project, username) {
  // In intranet deployments you may want "everyone can access every project".
  if (process.env.OPEN_ACCESS === '1') return true
  return project.owner === username || (project.collaborators || []).includes(username)
}

export async function createProject(dataDir, { owner, name, mainFile = 'main.tex' }) {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const project = {
    id,
    name: name || `Project ${id.slice(0, 8)}`,
    owner,
    collaborators: [],
    mainFile,
    compiler: 'pdflatex',
    category: '',
    tags: [],
    createdAt: now,
    updatedAt: now,
  }

  const projDir = path.join(projectsDir(dataDir), id)
  await ensureDir(projDir)

  // Ensure main file exists.
  const mainPath = safeJoin(projDir, mainFile)
  await ensureDir(path.dirname(mainPath))
  try {
    await fs.stat(mainPath)
  } catch {
    await fs.writeFile(mainPath, DEFAULT_MAIN_TEMPLATE)
  }

  const db = await loadProjects(dataDir)
  db.projects.push(project)
  await saveProjects(dataDir, db)
  return project
}

export function projectPath(dataDir, projectId) {
  return path.join(projectsDir(dataDir), projectId)
}

export function resolveProjectFilePath(dataDir, projectId, relPath) {
  const root = projectPath(dataDir, projectId)
  return safeJoin(root, relPath)
}

export async function listProjectTree(rootDir) {
  const out = []
  const skipExts = new Set([
    '.aux',
    '.log',
    '.out',
    '.toc',
    '.lof',
    '.lot',
    '.bbl',
    '.blg',
    '.bcf',
    '.run.xml',
    '.fdb_latexmk',
    '.fls',
    '.synctex',
    '.idx',
    '.ilg',
    '.ind',
    '.gls',
    '.glo',
    '.glg',
    '.acn',
    '.acr',
    '.alg',
    '.loa',
    '.lol',
    '.nav',
    '.snm',
    '.vrb',
    '.xdv',
  ])
  const shouldSkipFile = (name) => {
    const lower = name.toLowerCase()
    if (lower.endsWith('.synctex.gz')) return true
    const ext = path.extname(lower)
    if (!ext) return false
    return skipExts.has(ext)
  }
  async function walk(rel) {
    const abs = path.join(rootDir, rel)
    const entries = await fs.readdir(abs, { withFileTypes: true })
    for (const e of entries) {
      if (e.name === 'build') continue
      if (e.name.startsWith('.')) continue
      const childRel = path.join(rel, e.name)
      if (e.isDirectory()) await walk(childRel)
      else if (!shouldSkipFile(e.name)) out.push(childRel.replaceAll('\\', '/'))
    }
  }
  await walk('')
  out.sort()
  return out
}
