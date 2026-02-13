import { Server } from '@hocuspocus/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { verifyToken } from './lib/session.js'
import { projectDir } from './lib/paths.js'

export function createCollabServer({ dataDir, session }) {
  const server = Server.configure({
    name: 'aitex-collab',
    quiet: true,

    async onAuthenticate({ token, documentName }) {
      const user = verifyToken(session.secret, token)
      if (!user || !user.username) {
        throw new Error('unauthorized')
      }

      // Check project-level access
      const [projectId] = documentName.split('/')
      if (projectId) {
        const { loadProjects, canAccess } = await import('./lib/projects.js')
        const db = await loadProjects(dataDir)
        const project = db.projects.find(p => p.id === projectId)
        if (!project || !canAccess(project, user.username)) {
          throw new Error('forbidden')
        }
        return { user: { ...user, isOwner: project.owner === user.username } }
      }
      return { user }
    },

    async onLoadDocument({ document, documentName }) {
      // documentName format: "projectId/filePath"
      const [projectId, ...rest] = documentName.split('/')
      const filePath = rest.join('/')
      if (!projectId || !filePath) return

      const dir = projectDir(dataDir, projectId)
      const full = path.join(dir, filePath)

      try {
        const content = await fs.readFile(full, 'utf8')
        const ytext = document.getText('content')
        if (ytext.length === 0) {
          ytext.insert(0, content)
        }
      } catch {
        // File doesn't exist yet — start empty
      }
    },

    async onStoreDocument({ document, documentName }) {
      const [projectId, ...rest] = documentName.split('/')
      const filePath = rest.join('/')
      if (!projectId || !filePath) return

      const dir = projectDir(dataDir, projectId)
      const full = path.join(dir, filePath)

      const ytext = document.getText('content')
      const content = ytext.toString()

      const parent = path.dirname(full)
      await fs.mkdir(parent, { recursive: true })
      await fs.writeFile(full, content, 'utf8')
    },
  })

  return {
    listen: (port) => server.listen(port),
    destroy: () => server.destroy(),
  }
}
