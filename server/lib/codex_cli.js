import { spawn } from 'node:child_process'

function clampOutput(text, limit = 200000) {
  const raw = String(text || '')
  if (raw.length <= limit) return raw
  return raw.slice(-limit)
}

export async function runCodexExec({ cwd, prompt, model = '', timeoutMs = 180000 }) {
  return await new Promise((resolve, reject) => {
    if (!cwd) return reject(new Error('missing cwd'))
    if (!prompt) return reject(new Error('missing prompt'))

    const args = ['exec', '--full-auto', '--skip-git-repo-check', '-C', cwd]
    if (model) args.push('-m', model)
    args.push(prompt)

    let stdout = ''
    let stderr = ''
    const proc = spawn('codex', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        // ignore
      }
    }, timeoutMs)

    proc.stdout.on('data', (chunk) => {
      stdout = clampOutput(stdout + chunk.toString(), 400000)
    })
    proc.stderr.on('data', (chunk) => {
      stderr = clampOutput(stderr + chunk.toString(), 200000)
    })

    proc.on('error', (err) => {
      clearTimeout(killTimer)
      reject(err)
    })

    proc.on('close', (code) => {
      clearTimeout(killTimer)
      resolve({ code, stdout, stderr })
    })
  })
}
