import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const USERS_FILE = 'users.json'

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return { salt, hash }
}

function verifyPassword(password, salt, hash) {
  const result = crypto.scryptSync(password, salt, 64).toString('hex')
  return result === hash
}

async function loadUsers(dataDir) {
  const file = path.join(dataDir, USERS_FILE)
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return { users: [] }
  }
}

async function saveUsers(dataDir, db) {
  const file = path.join(dataDir, USERS_FILE)
  await fs.writeFile(file, JSON.stringify(db, null, 2), 'utf8')
}

export async function ensureDefaultUsers(dataDir) {
  const db = await loadUsers(dataDir)
  if (db.users.length > 0) return db

  const initPwd = process.env.INIT_PASSWORD || 'ChangeMe!2026'
  const defaults = ['admin', ...Array.from({ length: 9 }, (_, i) => `user0${i + 1}`)]

  for (const username of defaults) {
    const { salt, hash } = hashPassword(initPwd)
    db.users.push({
      username,
      salt,
      hash,
      isAdmin: username === 'admin',
      createdAt: new Date().toISOString(),
    })
  }

  await saveUsers(dataDir, db)
  console.log(`Created default users: ${defaults.join(', ')} (password: ${initPwd})`)
  return db
}

export async function authenticate(dataDir, username, password) {
  const db = await loadUsers(dataDir)
  const user = db.users.find(u => u.username === username)
  if (!user) return null
  if (!verifyPassword(password, user.salt, user.hash)) return null
  return { username: user.username, isAdmin: user.isAdmin }
}

export async function findUser(dataDir, username) {
  const db = await loadUsers(dataDir)
  return db.users.find(u => u.username === username) || null
}
