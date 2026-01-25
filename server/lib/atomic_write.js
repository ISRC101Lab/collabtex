import fs from 'node:fs/promises'
import path from 'node:path'

export async function atomicWriteFile(filename, content) {
  const dir = path.dirname(filename)
  const base = path.basename(filename)
  const tmp = path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}`)
  await fs.writeFile(tmp, content)
  await fs.rename(tmp, filename)
}

