import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { resolveProjectFilePath, projectPath } from './projects.js'

const jobs = new Map()
const runningByProject = new Map() // projectId -> jobId
const queuedByProject = new Map() // projectId -> jobId
const lastOutcomeByTarget = new Map() // projectId::mainFile -> "success"|"error"
const lastInputsByTarget = new Map() // projectId::mainFile -> { inputs:Set, compiledAt:number }
const lastBibStateByTarget = new Map() // projectId::mainFile -> { auxHash, bibSig, bcfSig }
const queue = []
let activeCount = 0

function cpuCount() {
  if (typeof os.availableParallelism === 'function') return os.availableParallelism()
  return os.cpus().length || 2
}

const CPU_COUNT = Math.max(1, cpuCount())
const MEM_PER_JOB_MB = Math.max(256, Number(process.env.COMPILE_JOB_MEM_MB || 1200))
const CPU_SHARE = Math.max(0.25, Math.min(1, Number(process.env.COMPILE_CPU_SHARE || 0.85)))
const TOTAL_MEM_MB = Math.max(256, Math.floor(os.totalmem() / (1024 * 1024)))
const MAX_BY_MEM = Math.max(1, Math.floor(TOTAL_MEM_MB / MEM_PER_JOB_MB))
const MAX_BY_CPU = Math.max(1, Math.floor(CPU_COUNT * CPU_SHARE))
const MAX_JOBS = Math.max(1, Number(process.env.MAX_COMPILE_JOBS || Math.min(MAX_BY_CPU, MAX_BY_MEM)))
let loggedCapacity = false
const DOCKER_ENABLED = process.env.COMPILE_DOCKER === '1'
const DOCKER_IMAGE = process.env.COMPILE_DOCKER_IMAGE || 'texlive/texlive:latest'
const DOCKER_CPUS = process.env.COMPILE_DOCKER_CPUS || ''
const DOCKER_MEM = process.env.COMPILE_DOCKER_MEM || ''
const DOCKER_PIDS = process.env.COMPILE_DOCKER_PIDS || ''
const DOCKER_TMPFS = process.env.COMPILE_DOCKER_TMPFS || ''

async function fileExists(fp) {
  try {
    await fs.stat(fp)
    return true
  } catch {
    return false
  }
}

async function readText(fp) {
  try {
    return await fs.readFile(fp, 'utf8')
  } catch {
    return ''
  }
}

async function isAuxCorrupted(auxPath) {
  const txt = await readText(auxPath)
  if (!txt) return false
  const lines = txt.trimEnd().split(/\r?\n/).filter(Boolean)
  if (!lines.length) return false
  const last = lines[lines.length - 1].trim()
  const braceCount = (s) => (s.match(/{/g) || []).length - (s.match(/}/g) || []).length
  for (const line of lines) {
    if (line.includes('\\newlabel') || line.includes('\\@writefile')) {
      if (braceCount(line) !== 0) return true
    }
  }
  if (last.includes('\\newlabel') || last.includes('\\@writefile')) {
    if (braceCount(last) !== 0) return true
    if (!last.endsWith('}')) return true
  }
  return false
}

function needsRerun(log) {
  if (!log) return false
  return /Rerun to get cross-references right|Label\(s\) may have changed|There were undefined references|Citation.*undefined|There were undefined citations|There were multiply-defined labels|Package rerunfilecheck Warning/i.test(
    log
  )
}

function hashText(text) {
  let h = 0
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0
  }
  return String(h)
}

function extractBibAuxLines(auxText) {
  const lines = String(auxText || '').split(/\r?\n/)
  return lines.filter((l) => /\\bibdata|\\bibstyle|\\citation/.test(l)).join('\n')
}

async function statSig(fp) {
  try {
    const st = await fs.stat(fp)
    return `${st.size}:${st.mtimeMs}`
  } catch {
    return '0'
  }
}

async function statSigList(paths) {
  const parts = []
  for (const p of paths) {
    const sig = await statSig(p)
    parts.push(`${p}:${sig}`)
  }
  return parts.join('|')
}

async function listBibCandidates(projDir) {
  const out = []
  const skipDir = new Set(['build', '.collabtex-trash', '.git', '.svn'])
  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (skipDir.has(ent.name)) continue
        if (ent.name.startsWith('.')) continue
        await walk(path.join(dir, ent.name))
        continue
      }
      if (!ent.isFile()) continue
      if (!ent.name.toLowerCase().endsWith('.bib')) continue
      out.push(path.join(dir, ent.name))
    }
  }
  await walk(projDir)
  return out
}

async function findLargeTexFiles(projDir, thresholdBytes = 5 * 1024 * 1024) {
  const out = []
  const skipDir = new Set(['build', '.collabtex-trash', '.collabtex-history', '.git', '.svn'])
  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (skipDir.has(ent.name) || ent.name.startsWith('.')) continue
        await walk(path.join(dir, ent.name))
        continue
      }
      if (!ent.isFile()) continue
      if (!ent.name.toLowerCase().endsWith('.tex')) continue
      const abs = path.join(dir, ent.name)
      try {
        const st = await fs.stat(abs)
        if (st.size >= thresholdBytes) {
          out.push({ file: abs, size: st.size })
        }
      } catch {
        // ignore
      }
    }
  }
  await walk(projDir)
  out.sort((a, b) => b.size - a.size)
  return out
}

function parseBibFiles(auxText, projDir, baseDir = projDir) {
  const match = String(auxText || '').match(/\\bibdata\{([^}]+)\}/)
  if (!match) return []
  const names = match[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const files = []
  for (const name of names) {
    const bibName = name.endsWith('.bib') ? name : `${name}.bib`
    if (path.isAbsolute(bibName)) {
      files.push(bibName)
      continue
    }
    const absBase = path.resolve(baseDir, bibName)
    files.push(absBase)
    if (baseDir !== projDir) {
      files.push(path.resolve(projDir, bibName))
    }
  }
  return Array.from(new Set(files))
}

async function readFlsInputs(flsPath, projDir, baseDir = projDir) {
  const txt = await readText(flsPath)
  if (!txt) return new Set()
  const inputs = new Set()
  const lines = txt.split(/\r?\n/)
  for (const line of lines) {
    if (!line.startsWith('INPUT ')) continue
    const raw = line.slice(6).trim()
    if (!raw) continue
    const abs = path.isAbsolute(raw) ? raw : path.resolve(baseDir, raw)
    if (!(abs === projDir || abs.startsWith(projDir + path.sep))) continue
    const rel = path.relative(projDir, abs).replaceAll('\\', '/')
    inputs.add(rel)
  }
  return inputs
}

async function inputsChangedSince(inputs, projDir, sinceMs) {
  if (!sinceMs) return true
  for (const rel of inputs) {
    const abs = path.resolve(projDir, rel)
    try {
      const st = await fs.stat(abs)
      if (st.mtimeMs > sinceMs) return true
    } catch {
      return true
    }
  }
  return false
}

export function getJob(id) {
  return jobs.get(id) || null
}

export function subscribeJob(id, fn) {
  const job = getJob(id)
  if (!job) return () => {}
  job.subscribers.add(fn)
  return () => job.subscribers.delete(fn)
}

function emit(job, evt) {
  for (const fn of job.subscribers) {
    try {
      fn(evt)
    } catch {
      // ignore subscriber errors
    }
  }
}

function newId() {
  return `job_${Math.random().toString(16).slice(2)}_${Date.now()}`
}

function targetKey(projectId, mainFile) {
  return `${projectId}::${mainFile}`
}

function trimLog(job) {
  if (job.log.length > 2_000_000) job.log = job.log.slice(-2_000_000)
}

function appendLog(job, chunk) {
  job.log += chunk
  trimLog(job)
  emit(job, { type: 'append', chunk })
}

function normalizeLogForDiagnostics(log) {
  let txt = String(log || '').replace(/\r/g, '')
  // Join wrapped absolute/relative paths before ":<line>:" markers.
  txt = txt.replace(
    /([/\\][^\n]{0,240})\n([^\n]*\.(?:tex|bib|sty|cls|bst|bbx|cbx|dbx|png|pdf|jpg|jpeg|svg|eps):\d+:)/gi,
    '$1$2'
  )
  // Join wrapped LaTeX error lines.
  txt = txt.replace(/(LaTeX Error:[^\n]{0,120})\n([a-z].{0,120})/g, '$1 $2')
  return txt
}

function cleanDiagnosticFile(file, projDir) {
  let fp = String(file || '').trim()
  if (!fp) return fp
  const dashPrefix = fp.match(/^-[0-9a-f]{6,}\/(.+)/i)
  if (dashPrefix) fp = dashPrefix[1]
  const slashFp = fp.replaceAll('\\', '/')
  const marker = '/collabtex-data/projects/'
  const idx = slashFp.lastIndexOf(marker)
  if (idx !== -1) {
    const rest = slashFp.slice(idx + marker.length)
    const parts = rest.split('/')
    if (parts.length > 1) fp = parts.slice(1).join('/')
  }
  if (projDir && path.isAbsolute(fp)) {
    const rel = path.relative(projDir, fp).replaceAll('\\', '/')
    if (!rel.startsWith('..')) fp = rel
  }
  return fp.replace(/^\.?\//, '')
}

function extractDiagnostics(log, projDir = null) {
  const out = []
  const normalized = normalizeLogForDiagnostics(log)
  const lines = normalized.split(/\r?\n/)
  const fileLine = /^(.+?):(\d+):\s+(.*)$/
  const bangLine = /^!\s*(.+)$/
  const missingFile = /^! LaTeX Error: File `([^`]+)' not found\./

  let lastFile = null
  let lastLine = null

  const isErrorMessage = (msg) => {
    if (!msg) return false
    const lower = msg.toLowerCase()
    if (lower.includes('warning') || lower.includes('info')) return false
    if (lower.includes('file ended while scanning use of')) return true
    return /error|undefined|missing|extra|fatal|emergency|runaway|misplaced|illegal|sorry|not allowed|cannot|can\'t/i.test(msg)
  }

  for (const line of lines) {
    let m = line.match(fileLine)
    if (m) {
      const file = cleanDiagnosticFile(m[1], projDir)
      const lineNo = Number(m[2])
      const msg = String(m[3] || '').trim()
      lastFile = file
      lastLine = lineNo
      if (isErrorMessage(msg)) {
        out.push({ file, line: lineNo, message: msg })
        if (/File ended while scanning use of \\citation/i.test(msg)) {
          out.push({
            file,
            line: lineNo,
            message: 'Likely missing a closing "}" in a \\cite{...} near this line.',
          })
        }
        if (/File ended while scanning use of \\@newl@bel/i.test(msg)) {
          out.push({
            file,
            line: lineNo,
            message: 'Aux/label file may be corrupted. Try “Clean Rebuild” or delete build/*.aux.',
          })
        }
      }
      continue
    }
    m = line.match(missingFile)
    if (m) {
      out.push({ file: cleanDiagnosticFile(m[1], projDir), line: 1, message: 'Missing file/package' })
      continue
    }
    m = line.match(bangLine)
    if (m && lastFile) {
      const msg = String(m[1] || '').trim()
      if (isErrorMessage(msg)) out.push({ file: lastFile, line: lastLine || 1, message: msg })
      continue
    }
  }

  // de-dupe (same file/line/message)
  const seen = new Set()
  return out.filter((d) => {
    const k = `${d.file}:${d.line}:${d.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

async function startNext() {
  if (activeCount >= MAX_JOBS) return
  const next = queue.shift()
  if (!next) return
  await runJob(next)
}

async function finishJob(job, projectId, code, statusOverride = null, projDir = null, outDir = null, baseDir = null) {
  const key = targetKey(projectId, job.mainFile)
  job.exitCode = code
  job.finishedAt = new Date().toISOString()
  job.status = statusOverride || (code === 0 ? 'success' : 'error')
  job.durationMs = job.startedAt ? Math.max(0, Date.now() - Date.parse(job.startedAt)) : 0
  job.diagnostics = extractDiagnostics(job.log, projDir)
  runningByProject.delete(projectId)
  lastOutcomeByTarget.set(key, job.status)
  if (job.status === 'success' && projDir && outDir) {
    try {
      const flsPath = path.join(outDir, `${path.basename(job.mainFile, path.extname(job.mainFile))}.fls`)
      const inputs = await readFlsInputs(flsPath, projDir, baseDir || projDir)
      if (inputs.size) {
        lastInputsByTarget.set(key, { inputs, compiledAt: Date.now() })
      }
    } catch {
      // ignore
    }
  }
  emit(job, { type: 'done', job: publicJob(job) })
  activeCount = Math.max(0, activeCount - 1)
  await startNext()
}

async function runJob({ dataDir, clean, job }) {
  activeCount += 1
  runningByProject.set(job.projectId, job.id)
  queuedByProject.delete(job.projectId)

  job.status = 'running'
  job.startedAt = new Date().toISOString()
  job.queueMs = Math.max(0, Date.parse(job.startedAt) - Date.parse(job.requestedAt))
  emit(job, { type: 'status', job: publicJob(job) })

  const projDir = projectPath(dataDir, job.projectId)
  const mainAbs = resolveProjectFilePath(dataDir, job.projectId, job.mainFile)
  const outDir = path.join(projDir, 'build')
  const baseDir = path.dirname(mainAbs)
  const key = targetKey(job.projectId, job.mainFile)

  try {
    if (clean) {
      try {
        await fs.rm(outDir, { recursive: true, force: true })
      } catch {
        // ignore best-effort cleanup
      }
    }
    await fs.mkdir(outDir, { recursive: true })

  const removeGeneratedInDir = async (dir, stemName) => {
    try {
      await fs.rm(path.join(dir, `${stemName}.aux`), { force: true })
      await fs.rm(path.join(dir, `${stemName}.out`), { force: true })
      await fs.rm(path.join(dir, `${stemName}.toc`), { force: true })
      await fs.rm(path.join(dir, `${stemName}.bbl`), { force: true })
      await fs.rm(path.join(dir, `${stemName}.blg`), { force: true })
    } catch {
      // ignore
    }
  }

  // Guard against corrupted aux from previous failed runs.
  try {
    const auxStem = path.basename(mainAbs, path.extname(mainAbs))
    const auxPath = path.join(outDir, `${auxStem}.aux`)
    if (await isAuxCorrupted(auxPath)) {
      appendLog(job, '[fix] detected corrupted aux; cleaning aux/out/bbl and retrying\n')
      await removeGeneratedInDir(outDir, auxStem)
      await removeGeneratedInDir(baseDir, auxStem)
    }
  } catch {
    // ignore
  }

  try {
    await fs.stat(mainAbs)
  } catch {
    appendLog(job, `Main file not found: ${job.mainFile}\n`)
    job.diagnostics = [{ file: job.mainFile, line: 1, message: 'Main file not found' }]
    await finishJob(job, job.projectId, 2, 'error', projDir, outDir, baseDir)
    return job
  }

  const stem = path.basename(mainAbs, path.extname(mainAbs))
  const lastOutcome = lastOutcomeByTarget.get(key)
  const forceClean = clean || lastOutcome === 'error'
  if (forceClean) {
    // latexmk caches state in *.fdb_latexmk / *.fls. When a previous run fails (e.g. bibtex),
    // it can report "Nothing to do" while still exiting non-zero. Clean caches in those cases.
    try {
      await fs.rm(path.join(outDir, `${stem}.fdb_latexmk`), { force: true })
      await fs.rm(path.join(outDir, `${stem}.fls`), { force: true })
      await fs.rm(path.join(outDir, `${stem}.aux`), { force: true })
      await fs.rm(path.join(outDir, `${stem}.out`), { force: true })
      await fs.rm(path.join(outDir, `${stem}.toc`), { force: true })
      await fs.rm(path.join(outDir, `${stem}.bbl`), { force: true })
      await fs.rm(path.join(outDir, `${stem}.blg`), { force: true })
    } catch {
      // ignore best-effort cleanup
    }
  }

  appendLog(job, `[compile] mode=${job.mode} engine=${job.compiler}\n`)

  try {
    const largeTex = await findLargeTexFiles(projDir)
    if (largeTex.length) {
      const top = largeTex.slice(0, 3)
      appendLog(
        job,
        `[preflight] large .tex files detected:\n` +
          top
            .map((x) => {
              const rel = path.relative(projDir, x.file).replaceAll('\\', '/')
              const mb = (x.size / (1024 * 1024)).toFixed(1)
              return `  - ${rel} (${mb}MB)`
            })
            .join('\n') +
          `\n`
      )
    }
  } catch {
    // ignore
  }

  const timeoutMs = Number(process.env.COMPILE_TIMEOUT_MS || 180000)
  const latexCmd = job.compiler || 'pdflatex'
  const startMs = Date.now()
  const deadline = startMs + timeoutMs

  const latexArgs = [
    '-recorder',
    '-interaction=nonstopmode',
    '-halt-on-error',
    '-file-line-error',
    '-synctex=1',
    '-no-shell-escape',
    `-output-directory=${path.relative(baseDir, outDir) || '.'}`,
    path.relative(baseDir, mainAbs),
  ]

  const runProcess = async (cmd, args, cwd, envOverrides = {}) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      appendLog(job, `\n[timeout] compile exceeded ${timeoutMs}ms\n`)
      return { code: -1, output: '', timedOut: true }
    }

    return await new Promise((resolve) => {
      let done = false
      let output = ''
      const finish = (payload) => {
        if (done) return
        done = true
        resolve(payload)
      }

      let child
      try {
        const env = { ...process.env, ...envOverrides }
        const useDocker =
          DOCKER_ENABLED && cwd && projDir && (cwd === projDir || cwd.startsWith(projDir + path.sep))
        if (useDocker) {
          const relCwd = path.relative(projDir, cwd).replaceAll('\\', '/')
          const workDir = relCwd ? `/work/${relCwd}` : '/work'
          const dockerArgs = [
            'run',
            '--rm',
            '--network=none',
            '--security-opt',
            'no-new-privileges',
            '-v',
            `${projDir}:/work`,
            '-w',
            workDir,
          ]
          if (DOCKER_CPUS) dockerArgs.push(`--cpus=${DOCKER_CPUS}`)
          if (DOCKER_MEM) dockerArgs.push(`--memory=${DOCKER_MEM}`)
          if (DOCKER_PIDS) dockerArgs.push(`--pids-limit=${DOCKER_PIDS}`)
          if (DOCKER_TMPFS) dockerArgs.push(`--tmpfs=/tmp:rw,size=${DOCKER_TMPFS}`)
          for (const [k, v] of Object.entries(envOverrides || {})) {
            if (v === undefined) continue
            dockerArgs.push('-e', `${k}=${v}`)
          }
          dockerArgs.push(DOCKER_IMAGE, cmd, ...args)
          appendLog(job, `[docker] ${cmd} ${args.join(' ')}\n`)
          child = spawn('docker', dockerArgs, { cwd: projDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
        } else {
          child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
        }
      } catch (e) {
        appendLog(job, `\n[spawn error] ${e?.message || String(e)}\n`)
        return finish({ code: -1, output, error: e })
      }

      const onData = (chunk) => {
        const s = chunk.toString('utf8')
        output += s
        appendLog(job, s)
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)

      const timer = setTimeout(() => {
        appendLog(job, `\n[timeout] compile exceeded ${timeoutMs}ms, killing ${cmd}\n`)
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
      }, remaining)

      child.on('error', (err) => {
        clearTimeout(timer)
        appendLog(job, `\n[spawn error] ${err?.message || String(err)}\n`)
        finish({ code: -1, output, error: err })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        finish({ code: code ?? -1, output })
      })
    })
  }

  const addSearchPath = (name, dir) => {
    const sep = path.delimiter
    const prev = process.env[name] || ''
    const merged = prev ? `${dir}${sep}${prev}` : `${dir}${sep}`
    return merged
  }

  const texInputs = [baseDir, projDir]
    .filter(Boolean)
    .map((d) => (d.endsWith(path.sep) ? `${d}//` : `${d}//`))
    .join(path.delimiter)
  const texEnv = {
    TEXINPUTS: addSearchPath('TEXINPUTS', texInputs),
  }

  const runLatexPass = async (label) => {
    appendLog(job, `[pass ${label}] ${latexCmd}\n`)
    return await runProcess(latexCmd, latexArgs, baseDir, texEnv)
  }

  if (job.mode === 'quick') {
    const r = await runLatexPass('quick')
    await finishJob(job, job.projectId, r.code ?? -1, null, projDir, outDir, baseDir)
    return job
  }

  // Smart multi-pass: 1-3 latex runs + optional bibtex/biber.
  let pass1 = await runLatexPass('1')
  if (pass1.code !== 0) {
    const outText = String(pass1.output || '')
    if (/File ended while scanning use of \\citation|File ended while scanning use of \\@newl@bel|Runaway argument\?/i.test(outText)) {
      appendLog(job, '[fix] detected runaway aux/citation; cleaning aux and retrying\n')
      try {
        await removeGeneratedInDir(outDir, stem)
        await removeGeneratedInDir(baseDir, stem)
      } catch {
        // ignore cleanup errors
      }
      pass1 = await runLatexPass('1R')
    }
    if (pass1.code !== 0) {
      await finishJob(job, job.projectId, pass1.code ?? -1, 'error', projDir, outDir, baseDir)
      return job
    }
  }

  const auxPath = path.join(outDir, `${stem}.aux`)
  const bcfPath = path.join(outDir, `${stem}.bcf`)
  const bblPath = path.join(outDir, `${stem}.bbl`)
  let ranBib = false

  const aux = await readText(auxPath)
  const auxHash = hashText(extractBibAuxLines(aux))
  const bibFiles = aux ? parseBibFiles(aux, projDir, baseDir) : []
  if (bibFiles.length && process.env.AUTO_BIB_FIX !== '0') {
    const missing = []
    for (const bf of bibFiles) {
      if (!(await fileExists(bf))) missing.push(bf)
    }
    if (missing.length === 1) {
      const candidates = await listBibCandidates(projDir)
      if (candidates.length === 1) {
        try {
          await fs.mkdir(path.dirname(missing[0]), { recursive: true })
          await fs.copyFile(candidates[0], missing[0])
          appendLog(
            job,
            `[bib] missing ${path.basename(missing[0])}; copied ${path.basename(candidates[0])}\n`
          )
        } catch {
          // ignore copy failures
        }
      } else if (missing.length) {
        appendLog(job, `[bib] missing ${path.basename(missing[0])}; multiple .bib files found, skip auto-fix\n`)
      }
    }
  }
  const bibSig = bibFiles.length ? await statSigList(bibFiles) : '0'
  const bcfSig = await statSig(bcfPath)
  const prevBib = lastBibStateByTarget.get(key) || {}

  const recursiveDir = projDir.endsWith(path.sep) ? `${projDir}//` : `${projDir}//`
  const bibEnv = {
    BIBINPUTS: addSearchPath('BIBINPUTS', recursiveDir),
    BSTINPUTS: addSearchPath('BSTINPUTS', recursiveDir),
    BIBTEXINPUTS: addSearchPath('BIBTEXINPUTS', recursiveDir),
  }

  if (await fileExists(bcfPath)) {
    const needBiber = bcfSig !== prevBib.bcfSig || bibSig !== prevBib.bibSig
    if (needBiber) {
      appendLog(job, `[biber] ${stem}\n`)
      const biberRun = await runProcess('biber', [stem], outDir, bibEnv)
      ranBib = true
      if (biberRun.code !== 0) {
        await finishJob(job, job.projectId, biberRun.code ?? -1, 'error', projDir, outDir, baseDir)
        return job
      }
    }
  } else if (aux && /\\bibdata|\\citation|\\bibstyle/.test(aux)) {
    const hasBbl = await fileExists(bblPath)
    const needBibtex = auxHash !== prevBib.auxHash || bibSig !== prevBib.bibSig || !hasBbl
    if (needBibtex) {
      appendLog(job, `[bibtex] ${stem}\n`)
      const bibRun = await runProcess('bibtex', [stem], outDir, bibEnv)
      ranBib = true
      if (bibRun.code !== 0) {
        await finishJob(job, job.projectId, bibRun.code ?? -1, 'error', projDir, outDir, baseDir)
        return job
      }
    }
  }

  lastBibStateByTarget.set(key, { auxHash, bibSig, bcfSig })

  let rerun = ranBib || needsRerun(pass1.output)
  if (rerun) {
    const pass2 = await runLatexPass('2')
    if (pass2.code !== 0) {
      await finishJob(job, job.projectId, pass2.code ?? -1, 'error', projDir, outDir, baseDir)
      return job
    }
    rerun = needsRerun(pass2.output)
  }

  if (rerun) {
    const pass3 = await runLatexPass('3')
    if (pass3.code !== 0) {
      await finishJob(job, job.projectId, pass3.code ?? -1, 'error', projDir, outDir, baseDir)
      return job
    }
  }

    await finishJob(job, job.projectId, 0, null, projDir, outDir, baseDir)
    return job
  } catch (e) {
    appendLog(job, `\n[error] ${e?.message || String(e)}\n`)
    if (job.status !== 'success' && job.status !== 'error') {
      try {
        await finishJob(job, job.projectId, -1, 'error', projDir, outDir, baseDir)
      } catch {
        // ignore double-finish errors
      }
    }
    return job
  }
}

export async function startCompile({
  dataDir,
  projectId,
  mainFile,
  compiler = 'pdflatex',
  clean = false,
  mode = 'full',
  origin = 'manual',
} = {}) {
  if (!loggedCapacity) {
    loggedCapacity = true
    console.log(
      `[compile] capacity cpu=${CPU_COUNT} mem=${TOTAL_MEM_MB}MB maxJobs=${MAX_JOBS} (memPerJob=${MEM_PER_JOB_MB}MB, cpuShare=${CPU_SHARE})`
    )
  }
  const existing = runningByProject.get(projectId) || queuedByProject.get(projectId)
  if (existing) {
    const j = getJob(existing)
    if (j && (j.status === 'running' || j.status === 'queued')) return j
    runningByProject.delete(projectId)
    queuedByProject.delete(projectId)
  }

  const id = newId()
  const requestedAt = new Date().toISOString()
  const job = {
    id,
    projectId,
    mainFile,
    compiler,
    mode,
    origin,
    status: 'queued', // queued|running|success|error
    requestedAt,
    startedAt: null,
    finishedAt: null,
    queueMs: 0,
    durationMs: 0,
    exitCode: null,
    log: '',
    diagnostics: [],
    subscribers: new Set(),
  }
  jobs.set(id, job)

  const key = targetKey(projectId, mainFile)
  if (origin === 'auto' && !clean && mode === 'quick' && lastOutcomeByTarget.get(key) === 'success') {
    const meta = lastInputsByTarget.get(key)
    if (meta && meta.inputs && meta.inputs.size > 0) {
      const projDir = projectPath(dataDir, projectId)
      const changed = await inputsChangedSince(meta.inputs, projDir, meta.compiledAt)
      if (!changed) {
        job.status = 'success'
        job.startedAt = requestedAt
        job.finishedAt = new Date().toISOString()
        job.durationMs = 0
        job.log = '[skip] no input changes since last compile\n'
        job.diagnostics = []
        emit(job, { type: 'done', job: publicJob(job) })
        return job
      }
    }
  }

  if (activeCount >= MAX_JOBS) {
    job.status = 'queued'
    job.log = '[queued] waiting for compiler slot...\n'
    queuedByProject.set(projectId, id)
    queue.push({ dataDir, clean, job })
    return job
  }

  await runJob({ dataDir, clean, job })
  return job
}

export function publicJob(job) {
  return {
    id: job.id,
    projectId: job.projectId,
    mainFile: job.mainFile,
    compiler: job.compiler,
    mode: job.mode,
    origin: job.origin,
    status: job.status,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    queueMs: job.queueMs,
    durationMs: job.durationMs,
    exitCode: job.exitCode,
    log: job.log,
    diagnostics: job.diagnostics,
  }
}

export function getCompileOverview({ limit = 20 } = {}) {
  const running = []
  for (const jobId of runningByProject.values()) {
    const job = jobs.get(jobId)
    if (job) running.push(publicJob(job))
  }
  const queued = []
  for (const item of queue) {
    if (item && item.job) queued.push(publicJob(item.job))
  }
  const all = Array.from(jobs.values())
  all.sort((a, b) => Date.parse(b.requestedAt || 0) - Date.parse(a.requestedAt || 0))
  const recent = all.slice(0, Math.max(5, limit)).map(publicJob)

  return {
    capacity: {
      cpuCount: CPU_COUNT,
      totalMemMB: TOTAL_MEM_MB,
      memPerJobMB: MEM_PER_JOB_MB,
      cpuShare: CPU_SHARE,
      maxJobs: MAX_JOBS,
    },
    usage: {
      activeCount,
      queueLength: queue.length,
      runningCount: running.length,
      queuedCount: queued.length,
    },
    system: {
      loadavg: os.loadavg(),
      uptimeSec: os.uptime(),
      freeMemMB: Math.floor(os.freemem() / (1024 * 1024)),
    },
    running,
    queued,
    recent,
  }
}
