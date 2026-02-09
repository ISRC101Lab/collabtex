import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDataDir } from './lib/paths.js'
import { initSession } from './lib/session.js'
import { ensureDefaultUsers } from './lib/users.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerFileRoutes } from './routes/files.js'
import { registerCompileRoutes } from './routes/compile.js'
import { registerAiRoutes } from './routes/ai.js'
import { registerUploadRoutes } from './routes/upload.js'
import { registerDownloadRoutes } from './routes/download.js'
import { registerSearchRoutes } from './routes/search.js'
import { registerImportRoutes } from './routes/import.js'
import { createCollabServer } from './collab.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const WEB_PORT = Number(process.env.WEB_PORT || 4092)
const WS_PORT = Number(process.env.WS_PORT || 4093)
const HOST = process.env.HOST || '0.0.0.0'

async function main() {
  const dataDir = ensureDataDir()
  const session = await initSession()
  await ensureDefaultUsers(dataDir)

  const app = express()
  app.set('etag', false)
  app.use(express.json({ limit: '20mb' }))

  // No-cache for API responses
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store')
    }
    next()
  })

  // Register API routes
  const ctx = { app, dataDir, session }
  registerAuthRoutes(ctx)
  registerProjectRoutes(ctx)
  registerFileRoutes(ctx)
  registerCompileRoutes(ctx)
  registerAiRoutes(ctx)
  registerUploadRoutes(ctx)
  registerDownloadRoutes(ctx)
  registerSearchRoutes(ctx)
  registerImportRoutes(ctx)

  // Serve frontend
  const distDir = path.resolve(__dirname, '../client/dist')
  app.use(express.static(distDir, { index: false, etag: false }))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })

  // Start collab server
  const collab = createCollabServer({ dataDir, session })
  await collab.listen(WS_PORT)

  app.listen(WEB_PORT, HOST, () => {
    console.log(`Aitex web:  http://127.0.0.1:${WEB_PORT}`)
    console.log(`Aitex ws:   ws://127.0.0.1:${WS_PORT}`)
    console.log(`Data dir:   ${dataDir}`)
  })
}

main().catch(e => { console.error(e); process.exit(1) })
