import crypto from 'node:crypto'

export async function initSession() {
  const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
  const cookieName = 'aitex_session'
  return { secret, cookieName }
}

export function signToken(secret, payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 86400000 })).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

export function verifyToken(secret, token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  if (sig !== expected) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (payload.exp && payload.exp < Date.now()) return null
    return payload
  } catch { return null }
}

export function getTokenFromReq(req, session) {
  // Cookie
  const cookies = parseCookies(req.headers.cookie)
  let token = cookies[session.cookieName]
  // Bearer header
  if (!token) {
    const auth = req.headers.authorization || ''
    if (auth.toLowerCase().startsWith('bearer ')) token = auth.slice(7).trim()
  }
  return token || ''
}

export function getSessionFromReq(req, session) {
  return verifyToken(session.secret, getTokenFromReq(req, session))
}

export function requireAuth(session) {
  return (req, res, next) => {
    const user = getSessionFromReq(req, session)
    if (!user || !user.username) return res.status(401).json({ error: 'unauthorized' })
    req.user = user
    next()
  }
}

function parseCookies(header) {
  const result = {}
  if (!header) return result
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=')
    if (idx < 0) continue
    const key = pair.slice(0, idx).trim()
    const val = pair.slice(idx + 1).trim()
    result[key] = decodeURIComponent(val)
  }
  return result
}
