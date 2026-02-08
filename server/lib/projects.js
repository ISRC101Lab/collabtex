import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { ensureDir, projectDir } from './paths.js'

const PROJECTS_FILE = 'projects.json'

export async function loadProjects(dataDir) {
  const file = path.join(dataDir, PROJECTS_FILE)
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return { projects: [] }
  }
}

export async function saveProjects(dataDir, db) {
  const file = path.join(dataDir, PROJECTS_FILE)
  await fs.writeFile(file, JSON.stringify(db, null, 2), 'utf8')
}

export async function createProject(dataDir, { owner, name, mainFile }) {
  const db = await loadProjects(dataDir)
  const project = {
    id: crypto.randomUUID(),
    name: name || 'Untitled',
    owner,
    collaborators: [],
    mainFile: mainFile || 'main.tex',
    compiler: 'pdflatex',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  db.projects.push(project)
  await saveProjects(dataDir, db)

  // Create project directory with default main.tex
  const dir = projectDir(dataDir, project.id)
  ensureDir(dir)
  const defaultContent = [
    '\\documentclass{article}',
    '\\begin{document}',
    'Hello, Aitex!',
    '\\end{document}',
    '',
  ].join('\n')
  await fs.writeFile(path.join(dir, project.mainFile), defaultContent, 'utf8')

  return project
}

export function canAccess(project, username) {
  if (!project || !username) return false
  if (project.owner === username) return true
  if (project.collaborators?.includes(username)) return true
  return false
}

export async function addCollaborator(dataDir, projectId, username) {
  const db = await loadProjects(dataDir)
  const project = db.projects.find((p) => p.id === projectId)
  if (!project) return null
  if (!project.collaborators) project.collaborators = []
  if (!project.collaborators.includes(username)) {
    project.collaborators.push(username)
    project.updatedAt = new Date().toISOString()
    await saveProjects(dataDir, db)
  }
  return project
}

export async function removeCollaborator(dataDir, projectId, username) {
  const db = await loadProjects(dataDir)
  const project = db.projects.find((p) => p.id === projectId)
  if (!project) return null
  project.collaborators = (project.collaborators || []).filter((c) => c !== username)
  project.updatedAt = new Date().toISOString()
  await saveProjects(dataDir, db)
  return project
}

export async function listTree(dir) {
  const results = []
  const walk = async (d, prefix) => {
    const entries = await fs.readdir(d, { withFileTypes: true })
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue
      if (ent.name === 'build') continue
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name
      if (ent.isDirectory()) {
        results.push(rel + '/')
        await walk(path.join(d, ent.name), rel)
      } else if (ent.isFile()) {
        results.push(rel)
      }
    }
  }
  await walk(dir, '')
  return results.sort()
}
