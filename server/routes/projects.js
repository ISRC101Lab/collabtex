import { requireAuth } from '../lib/session.js'
import { loadProjects, saveProjects, createProject, canAccess, addCollaborator, removeCollaborator, listTree } from '../lib/projects.js'
import { projectDir } from '../lib/paths.js'
import { getProjectListPreferences, updateProjectListPreferences } from '../lib/project-preferences.js'

function applyScope(projects, username, isAdmin, scope) {
  if (scope === 'owned') {
    return projects.filter((p) => p.owner === username || isAdmin)
  }
  if (scope === 'shared') {
    return projects.filter((p) => p.owner !== username && canAccess(p, username))
  }
  return projects
}

function applyQuery(projects, query) {
  if (!query) return projects
  const q = String(query).trim().toLowerCase()
  if (!q) return projects
  return projects.filter((p) => {
    return (
      p.name?.toLowerCase().includes(q) ||
      p.owner?.toLowerCase().includes(q) ||
      p.mainFile?.toLowerCase().includes(q)
    )
  })
}

function applySort(projects, sort) {
  const next = [...projects]
  if (sort === 'updated_asc') {
    return next.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
  }
  if (sort === 'name_asc') {
    return next.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  }
  if (sort === 'name_desc') {
    return next.sort((a, b) => String(b.name).localeCompare(String(a.name)))
  }
  return next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export function registerProjectRoutes({ app, dataDir, session }) {
  const auth = requireAuth(session)

  // List projects
  app.get('/api/projects', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const base = db.projects.filter(p => canAccess(p, req.user.username) || req.user.isAdmin)
    const prefs = await getProjectListPreferences(dataDir, req.user.username)
    const scope = req.query.scope ? String(req.query.scope) : prefs.scope
    const sort = req.query.sort ? String(req.query.sort) : prefs.sort
    const q = req.query.q ? String(req.query.q) : ''
    const scoped = applyScope(base, req.user.username, req.user.isAdmin, scope)
    const queried = applyQuery(scoped, q)
    const sorted = applySort(queried, sort)
    res.json({ projects: sorted, prefs: { ...prefs, scope, sort } })
  })

  // Project list preferences
  app.get('/api/projects/preferences', auth, async (req, res) => {
    const prefs = await getProjectListPreferences(dataDir, req.user.username)
    res.json({ prefs })
  })

  app.post('/api/projects/preferences', auth, async (req, res) => {
    const { scope, sort, view } = req.body || {}
    const prefs = await updateProjectListPreferences(dataDir, req.user.username, { scope, sort, view })
    res.json({ ok: true, prefs })
  })

  // Create project
  app.post('/api/projects', auth, async (req, res) => {
    const { name, mainFile } = req.body || {}
    const project = await createProject(dataDir, { owner: req.user.username, name, mainFile })
    res.json({ project })
  })

  // Get project file tree
  app.get('/api/projects/:id/tree', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }
    const dir = projectDir(dataDir, project.id)
    const tree = await listTree(dir).catch(() => [])
    res.json({ tree, mainFile: project.mainFile, compiler: project.compiler })
  })

  // Delete project
  app.delete('/api/projects/:id', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const idx = db.projects.findIndex(p => p.id === req.params.id)
    if (idx < 0) return res.status(404).json({ error: 'not found' })
    const project = db.projects[idx]
    if (project.owner !== req.user.username && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }
    db.projects.splice(idx, 1)
    await saveProjects(dataDir, db)
    res.json({ ok: true })
  })

  // Update project metadata
  app.post('/api/projects/:id/meta', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }
    const { name, compiler, mainFile } = req.body || {}
    if (name) project.name = name
    if (compiler) project.compiler = compiler
    if (mainFile) project.mainFile = mainFile
    project.updatedAt = new Date().toISOString()
    await saveProjects(dataDir, db)
    res.json({ ok: true, project })
  })

  // Get collaborators
  app.get('/api/projects/:id/collaborators', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }
    res.json({ owner: project.owner, collaborators: project.collaborators || [] })
  })

  // Add collaborator
  app.post('/api/projects/:id/collaborators', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'not found' })
    if (project.owner !== req.user.username && !req.user.isAdmin) {
      return res.status(403).json({ error: 'only owner can add collaborators' })
    }
    const { username } = req.body || {}
    if (!username) return res.status(400).json({ error: 'username required' })
    const updated = await addCollaborator(dataDir, project.id, username)
    res.json({ ok: true, collaborators: updated.collaborators })
  })

  // Remove collaborator
  app.delete('/api/projects/:id/collaborators/:username', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'not found' })
    if (project.owner !== req.user.username && !req.user.isAdmin) {
      return res.status(403).json({ error: 'only owner can remove collaborators' })
    }
    const updated = await removeCollaborator(dataDir, project.id, req.params.username)
    res.json({ ok: true, collaborators: updated.collaborators })
  })
}
