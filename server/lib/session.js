import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from './atomic_write.js'
import { ensureDir, resolveDataDir } from './paths.js'

const COOKIE_NAME = 'ct_session'

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

function b64urlDecode(str) {
  const padLen = (4 - (str.length % 4)) % 4
  const padded = str.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(padLen)
  return Buffer.from(padded, 'base64')
}

async function loadOrCreateSecret(dataDir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET
  const p = path.join(dataDir, 'session_secret.txt')
  try {
    return (await fs.readFile(p, 'utf8')).trim()
  } catch {
    const secret = b64url(crypto.randomBytes(32))
    await ensureDir(dataDir)
    await atomicWriteFile(p, secret + '\n')
    return secret
  }
}

export async function initSession() {
  const dataDir = resolveDataDir()
  const secret = await loadOrCreateSecret(dataDir)
  return {
    cookieName: COOKIE_NAME,
    secret,
  }
}

export function signSession(secret, payloadObj) {
  const payload = b64url(Buffer.from(JSON.stringify(payloadObj), 'utf8'))
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest())
  return `${payload}.${sig}`
}

export function verifySession(secret, token) {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payload, sig] = parts
  const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest())
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }
  try {
    const obj = JSON.parse(b64urlDecode(payload).toString('utf8'))
    if (typeof obj !== 'object' || obj === null) return null
    if (obj.exp && Date.now() > obj.exp) return null
    return obj
  } catch {
    return null
  }
}

export function setSessionCookie(res, cookieName, token) {
  // HTTP-only cookie; in intranet we keep it simple (no TLS assumed).
  const attrs = [
    `${cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ]
  res.setHeader('Set-Cookie', attrs.join('; '))
}

export function clearSessionCookie(res, cookieName) {
  res.setHeader('Set-Cookie', `${cookieName}=; Path=/; Max-Age=0`)
}

