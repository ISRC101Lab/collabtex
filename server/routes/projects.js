import { requireAuth } from '../lib/session.js'
import { loadProjects, saveProjects, createProject, canAccess, addCollaborator, removeCollaborator, listTree } from '../lib/projects.js'
import { projectDir } from '../lib/paths.js'

export function registerProjectRoutes({ app, dataDir, session }) {
  const auth = requireAuth(session)

  // List projects
  app.get('/api/projects', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const visible = db.projects.filter(p => canAccess(p, req.user.username) || req.user.isAdmin)
    res.json({ projects: visible })
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
