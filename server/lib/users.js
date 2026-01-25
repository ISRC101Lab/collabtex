import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveDataDir, ensureDir } from './paths.js'
import { atomicWriteFile } from './atomic_write.js'
import { hashPassword, verifyPassword } from './passwords.js'

function usersPath(dataDir) {
  return path.join(dataDir, 'users.json')
}

export async function loadUsers(dataDir) {
  const p = usersPath(dataDir)
  try {
    const raw = await fs.readFile(p, 'utf8')
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') throw new Error('bad users.json')
    if (!Array.isArray(obj.users)) obj.users = []
    return obj
  } catch {
    return { users: [] }
  }
}

export async function saveUsers(dataDir, obj) {
  await ensureDir(dataDir)
  await atomicWriteFile(usersPath(dataDir), JSON.stringify(obj, null, 2) + '\n')
}

export async function ensureDefaultUsers(dataDir) {
  const initPassword = process.env.INIT_PASSWORD || 'ChangeMe!2026'
  const existing = await loadUsers(dataDir)
  if (existing.users.length > 0) return existing

  const mk = async (username, isAdmin = false) => ({
    username,
    isAdmin,
    password: await hashPassword(initPassword),
    createdAt: new Date().toISOString(),
  })

  const users = [await mk('admin', true)]
  for (let i = 1; i <= 9; i++) {
    users.push(await mk(`user${String(i).padStart(2, '0')}`, false))
  }

  const obj = { users }
  await saveUsers(dataDir, obj)
  return obj
}

export function findUser(usersObj, username) {
  return usersObj.users.find((u) => u.username === username) || null
}

export async function authenticate(usersObj, username, password) {
  const user = findUser(usersObj, username)
  if (!user) return null
  const ok = await verifyPassword(password, user.password)
  return ok ? user : null
}

