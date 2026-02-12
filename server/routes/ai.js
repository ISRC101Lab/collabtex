import { requireAuth } from '../lib/session.js'
import { loadProjects, canAccess } from '../lib/projects.js'
import { runAgentStream, isConfigured, getProvider, getAvailableModels } from '../lib/ai-agent.js'

export function registerAiRoutes({ app, dataDir, session }) {
  const auth = requireAuth(session)

  // Chat with AI about a project (SSE streaming)
  app.post('/api/projects/:id/ai/chat', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const { message, history, model } = req.body || {}
    if (!message) return res.status(400).json({ error: 'missing message' })

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const emit = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      await runAgentStream({
        dataDir,
        projectId: project.id,
        projectName: project.name,
        message,
        history: Array.isArray(history) ? history.slice(-20) : [],
        model: model || undefined,
        compiler: project.compiler || 'xelatex',
        emit,
      })
    } catch (err) {
      console.error('AI agent error:', err.message)
      emit('error', { message: err.message })
    } finally {
      res.end()
    }
  })

  // AI autocomplete for LaTeX
  app.post('/api/projects/:id/ai/complete', auth, async (req, res) => {
    const db = await loadProjects(dataDir)
    const project = db.projects.find(p => p.id === req.params.id)
    if (!project) return res.status(404).json({ error: 'project not found' })
    if (!canAccess(project, req.user.username) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const { filePath, cursorOffset, prefix } = req.body || {}
    if (!filePath) return res.status(400).json({ error: 'missing filePath' })

    res.json({
      ok: true,
      completions: [],
      message: 'AI completion not yet configured.',
    })
  })

  // AI status / health + available models
  app.get('/api/ai/status', auth, (_req, res) => {
    res.json({
      configured: isConfigured(),
      provider: getProvider(),
      models: getAvailableModels(),
    })
  })
}
