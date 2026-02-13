import { authenticate } from '../lib/users.js'
import { signToken, requireAuth, getSessionFromReq } from '../lib/session.js'

export function registerAuthRoutes({ app, dataDir, session }) {
  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: 'missing credentials' })

    const user = await authenticate(dataDir, username, password)
    if (!user) return res.status(401).json({ error: 'invalid credentials' })

    const token = signToken(session.secret, { username: user.username, isAdmin: user.isAdmin })
    // Token returned in body only — no cookie, so tabs stay isolated
    res.json({ ok: true, username: user.username, isAdmin: user.isAdmin, token })
  })

  app.post('/api/logout', (_req, res) => {
    // Clear legacy cookie if present
    res.clearCookie(session.cookieName)
    res.json({ ok: true })
  })

  app.get('/api/me', (req, res) => {
    const user = getSessionFromReq(req, session)
    if (!user) return res.json({ authenticated: false })
    // Re-issue token so new tabs can store it in sessionStorage
    const token = signToken(session.secret, { username: user.username, isAdmin: user.isAdmin })
    res.json({ authenticated: true, username: user.username, isAdmin: user.isAdmin, token })
  })

  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() })
  })
}
