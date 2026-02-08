import { authenticate } from '../lib/users.js'
import { signToken, requireAuth, getSessionFromReq } from '../lib/session.js'

export function registerAuthRoutes({ app, dataDir, session }) {
  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {}
    if (!username || !password) return res.status(400).json({ error: 'missing credentials' })

    const user = await authenticate(dataDir, username, password)
    if (!user) return res.status(401).json({ error: 'invalid credentials' })

    const token = signToken(session.secret, { username: user.username, isAdmin: user.isAdmin })
    res.cookie(session.cookieName, token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 7 * 86400000,
    })
    res.json({ ok: true, username: user.username, isAdmin: user.isAdmin, token })
  })

  app.post('/api/logout', (_req, res) => {
    res.clearCookie(session.cookieName)
    res.json({ ok: true })
  })

  app.get('/api/me', (req, res) => {
    const user = getSessionFromReq(req, session)
    if (!user) return res.json({ authenticated: false })
    res.json({ authenticated: true, username: user.username, isAdmin: user.isAdmin })
  })

  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() })
  })
}
