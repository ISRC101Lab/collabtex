import crypto from 'node:crypto'

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, { N: 1 << 14, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
  return {
    alg: 'scrypt',
    salt: salt.toString('hex'),
    key: Buffer.from(key).toString('hex'),
  }
}

export async function verifyPassword(password, record) {
  if (!record || record.alg !== 'scrypt' || !record.salt || !record.key) return false
  const salt = Buffer.from(record.salt, 'hex')
  const expected = Buffer.from(record.key, 'hex')
  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, { N: 1 << 14, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
  try {
    return crypto.timingSafeEqual(expected, Buffer.from(actual))
  } catch {
    return false
  }
}

