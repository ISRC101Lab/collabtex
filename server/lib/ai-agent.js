import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { projectDir, ensureDir } from './paths.js'
import { listTree } from './projects.js'

// ── File tree TTL cache ─────────────────────────────────────────────
const _fileTreeCache = new Map() // dir -> { tree, expires }
const FILE_TREE_TTL = 30_000

async function getCachedFileTree(dir) {
  const cached = _fileTreeCache.get(dir)
  if (cached && cached.expires > Date.now()) {
    return cached.tree
  }
  const tree = await listTree(dir)
  _fileTreeCache.set(dir, { tree, expires: Date.now() + FILE_TREE_TTL })
  return tree
}

function invalidateFileTreeCache(dir) {
  _fileTreeCache.delete(dir)
}

// ── Config ──────────────────────────────────────────────────────────

const AI_BASE_URL = process.env.AI_BASE_URL || 'https://llmapi.blsc.cn/v1'
const AI_API_KEY = process.env.AI_API_KEY || 'sk-V2hxOCNJF8RmDs0Gq9i49w'
const AI_MODEL = process.env.AI_MODEL || 'Qwen3-VL-235B-A22B-Instruct'

const AVAILABLE_MODELS = [
  'Qwen3-VL-235B-A22B-Instruct',
  'Qwen3-VL-235B-A22B-Thinking',
  'Qwen3-VL-30B-A3B-Instruct',
  'Qwen3-VL-30B-A3B-Thinking',
]

// ── Tool definitions (OpenAI function-calling format) ───────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List all files in the current LaTeX project.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the full content of a file in the project.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path, e.g. "main.tex"' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file with the given content. Parent directories are created automatically.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace a specific substring in a file. Use this for targeted edits instead of rewriting the whole file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
          old_text: { type: 'string', description: 'Exact text to find and replace' },
          new_text: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file from the project.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path to delete' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_file',
      description: 'Rename or move a file within the project.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Current relative file path' },
          to: { type: 'string', description: 'New relative file path' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compile_project',
      description: 'Compile the LaTeX project and return the result. Use this when the user asks you to compile, build, or generate PDF.',
      parameters: {
        type: 'object',
        properties: {
          compiler: {
            type: 'string',
            enum: ['pdflatex', 'xelatex', 'lualatex', 'latexmk'],
            description: 'LaTeX compiler to use. If omitted, the user\'s currently selected compiler will be used automatically. Only specify if the user explicitly asks for a different compiler.',
          },
          main_file: {
            type: 'string',
            description: 'Main .tex file to compile. Default: main.tex',
          },
        },
        required: [],
      },
    },
  },
]

// ── System prompt ───────────────────────────────────────────────────

function buildSystemPrompt(projectName, fileList, compiler, isOwner) {
  const filesSection = fileList && fileList.length > 0
    ? `\n## Current Project Files\n\n${fileList.map(f => `- ${f}`).join('\n')}\n`
    : ''

  // Infer language context from compiler choice
  let compilerHint = ''
  if (compiler === 'xelatex' || compiler === 'lualatex') {
    compilerHint = `
## Language & Compiler Context

The user has selected **${compiler}** as their compiler, which supports Unicode/CJK natively.
This strongly suggests the user is working on a **Chinese or multilingual** document.
- Default to writing content in **Chinese** unless the user explicitly writes in English.
- Use CJK-compatible packages (ctex, xeCJK) when needed.
- When compiling, always use **${compiler}**.`
  } else if (compiler === 'pdflatex') {
    compilerHint = `
## Language & Compiler Context

The user has selected **pdflatex** as their compiler, which does NOT support CJK/Unicode natively.
This strongly suggests the user is working on an **English-only** document.
- **NEVER** insert Chinese characters, Japanese, Korean, or other CJK text into the document.
- **NEVER** add CJK packages (ctex, xeCJK, CJKutf8) — they are incompatible with pdflatex.
- If the user needs CJK support, advise them to switch to xelatex or lualatex first.
- When compiling, always use **pdflatex**.`
  } else if (compiler === 'latexmk') {
    compilerHint = `
## Language & Compiler Context

The user has selected **latexmk** as their compiler (auto-detection mode).
- Follow the content language already present in the document.
- If the document uses CJK packages, write in the corresponding language.
- If the document is English-only, do NOT introduce CJK characters.`
  }

  const role = isOwner ? 'owner' : 'collaborator'
  const permissionSection = isOwner
    ? `## Your Permissions (Owner)

You have **full access** to all project operations:
- **list_files** — See all files in the project
- **read_file(path)** — Read a file's content
- **write_file(path, content)** — Create new files or fully rewrite existing files
- **edit_file(path, old_text, new_text)** — Targeted find-and-replace edit
- **delete_file(path)** — Delete a file
- **rename_file(from, to)** — Rename or move a file
- **compile_project(compiler, main_file)** — Compile LaTeX to PDF`
    : `## Your Permissions (Collaborator)

You are assisting a **collaborator** (not the project owner). Your permissions are **limited**:
- **list_files** — See all files in the project ✅
- **read_file(path)** — Read a file's content ✅
- **edit_file(path, old_text, new_text)** — Edit existing files ✅
- **write_file(path, content)** — **Only rewrite existing files** ✅ (creating new files is BLOCKED)
- **compile_project(compiler, main_file)** — Compile LaTeX to PDF ✅
- **delete_file(path)** — ❌ **NOT ALLOWED** (owner only)
- **rename_file(from, to)** — ❌ **NOT ALLOWED** (owner only)

**IMPORTANT:** Do NOT attempt to create new files, delete files, or rename files. These operations will fail. If the task requires creating or deleting files, tell the user to ask the project owner to do it, or to perform the operation themselves in the file tree.
When using write_file, only use it on files that already exist — never to create a new file path.`

  return `You are Aitex AI — an expert LaTeX writing assistant embedded in a collaborative LaTeX editor called Aitex.

Project: "${projectName}"
User role: ${role}
Compiler: ${compiler || 'pdflatex'}
${filesSection}${compilerHint}
${permissionSection}

## CRITICAL: Always Use Tools — Never Just Show Code

**ABSOLUTE RULE:** When the user asks you to write, edit, fix, add, translate, or modify ANY content, you MUST use the tools (write_file, edit_file, etc.) to apply the changes directly. NEVER just display code/LaTeX in your response and ask the user to copy it. Your response text should only contain brief explanations of what you did — the actual work must be done through tool calls.

❌ WRONG: "Here is the updated content: \`\`\`latex ... \`\`\`"
✅ RIGHT: Call edit_file or write_file to apply the change, then say "I've updated sections/intro.tex with the new paragraph."

If you catch yourself about to write a code block containing a proposed change, STOP — use a tool instead.

## Core Principles

1. **Read first, then act immediately.** When you receive a task, read_file on the relevant files to understand the current content. Then immediately use edit_file or write_file to make the changes. Do this in a single response — do not split into "let me read" and "now let me edit" across multiple turns.

2. **edit_file for small changes, write_file for large changes.** Use edit_file when changing a few lines. If edit_file fails (old_text not found), immediately retry with write_file to rewrite the entire file — do NOT give up and describe the change in text.

3. **Always read before editing.** Before modifying any file, read it first with read_file so you know the exact current content. The edit_file tool requires EXACT string matching — copy the old_text character-for-character from the read_file output.

4. **Compile with the user's compiler.** When compiling, do NOT specify the compiler parameter — it will automatically use the user's selected compiler (**${compiler || 'pdflatex'}**). Only override if the user explicitly asks you to use a different compiler.

5. **Handle multi-step tasks autonomously.** If a task requires multiple operations (e.g., "translate this file to Chinese"), break it down and execute all steps in one go: read the file, edit/rewrite it, then compile. Don't stop halfway.

6. **Self-recover from errors.** If edit_file returns "old_text not found", do NOT describe the change in text. Instead: re-read the file with read_file, then retry with corrected old_text, or use write_file to rewrite the whole file.

## Common Task Patterns

**Translation:** Read the file → rewrite with write_file using translated content (preserving all LaTeX commands, \\cite{}, \\ref{}, \\label{}, environments) → compile.

**Adding content:** Read the target file → use edit_file to insert new content at the right location → compile.

**Fixing errors:** Read the file → identify the issue → use edit_file to fix → compile to verify.

**Restructuring (owner only):** List files to understand project structure → read relevant files → create/edit/delete as needed → compile. If you are a collaborator, only edit existing files and suggest structural changes to the owner.

**Creating new sections/chapters (owner only):** Read main file to understand structure → create new .tex file if needed → add \\input{} or \\include{} to main file → compile. If you are a collaborator, suggest the new file structure to the owner instead of creating files.

## Important Rules

- When the user provides file content via @filename context blocks, use that content directly — no need to read_file again. But STILL use tools to apply changes.
- Respond in the same language the user writes in.
- Be concise in explanations. Focus on what you changed and why.
- If compilation fails, read the log, diagnose the error, fix it, and recompile.
- For large files, prefer write_file to rewrite the whole file rather than many fragile edit_file calls.
- NEVER output LaTeX source code in your response as a substitute for using tools. The user cannot copy-paste from the chat — you must apply changes directly.`
}

// ── Path safety ─────────────────────────────────────────────────────

function safePath(p) {
  if (!p || typeof p !== 'string') return null
  const normalized = path.normalize(p).replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.startsWith('..')) return null
  if (normalized.includes('/../') || normalized === '..') return null
  return normalized
}

// ── Tool execution ──────────────────────────────────────────────────

async function executeTool(name, args, dir, userCompiler, isOwner = true) {
  const fileChanges = []

  switch (name) {
    case 'list_files': {
      const tree = await listTree(dir)
      _fileTreeCache.set(dir, { tree, expires: Date.now() + FILE_TREE_TTL })
      return { result: JSON.stringify(tree), fileChanges }
    }

    case 'read_file': {
      const sp = safePath(args.path)
      if (!sp) return { result: 'Error: invalid path', fileChanges }
      try {
        const content = await fs.readFile(path.join(dir, sp), 'utf8')
        return { result: content, fileChanges }
      } catch {
        return { result: `Error: file "${sp}" not found`, fileChanges }
      }
    }

    case 'write_file': {
      const sp = safePath(args.path)
      if (!sp) return { result: 'Error: invalid path', fileChanges }
      const full = path.join(dir, sp)
      // Read old content for diff
      let oldContent = null
      try { oldContent = await fs.readFile(full, 'utf8') } catch { /* new file */ }
      // Collaborators can only edit existing files, not create new ones
      if (oldContent === null && !isOwner) {
        return { result: 'Error: only the project owner can create new files', fileChanges }
      }
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, args.content, 'utf8')
      fileChanges.push({
        action: oldContent === null ? 'create' : 'write',
        path: sp,
        oldContent,
        newContent: args.content,
      })
      invalidateFileTreeCache(dir)
      return { result: `File "${sp}" written successfully.`, fileChanges }
    }

    case 'edit_file': {
      const sp = safePath(args.path)
      if (!sp) return { result: 'Error: invalid path', fileChanges }
      const full = path.join(dir, sp)
      try {
        const oldContent = await fs.readFile(full, 'utf8')
        if (!oldContent.includes(args.old_text)) {
          return { result: `Error: old_text not found in "${sp}". The exact text you specified does not exist in the file. Please re-read the file with read_file to see its current content, then either retry edit_file with the correct old_text, or use write_file to rewrite the entire file.`, fileChanges }
        }
        const newContent = oldContent.replace(args.old_text, args.new_text)
        await fs.writeFile(full, newContent, 'utf8')
        fileChanges.push({
          action: 'edit',
          path: sp,
          oldContent,
          newContent,
        })
        invalidateFileTreeCache(dir)
        return { result: `File "${sp}" edited successfully.`, fileChanges }
      } catch {
        return { result: `Error: file "${sp}" not found`, fileChanges }
      }
    }

    case 'delete_file': {
      if (!isOwner) return { result: 'Error: only the project owner can delete files', fileChanges }
      const sp = safePath(args.path)
      if (!sp) return { result: 'Error: invalid path', fileChanges }
      try {
        const oldContent = await fs.readFile(path.join(dir, sp), 'utf8')
        await fs.unlink(path.join(dir, sp))
        fileChanges.push({ action: 'delete', path: sp, oldContent, newContent: null })
        invalidateFileTreeCache(dir)
        return { result: `File "${sp}" deleted.`, fileChanges }
      } catch {
        return { result: `Error: file "${sp}" not found`, fileChanges }
      }
    }

    case 'rename_file': {
      if (!isOwner) return { result: 'Error: only the project owner can rename/move files', fileChanges }
      const from = safePath(args.from)
      const to = safePath(args.to)
      if (!from || !to) return { result: 'Error: invalid path', fileChanges }
      try {
        const oldContent = await fs.readFile(path.join(dir, from), 'utf8')
        const destFull = path.join(dir, to)
        await fs.mkdir(path.dirname(destFull), { recursive: true })
        await fs.rename(path.join(dir, from), destFull)
        fileChanges.push({ action: 'rename', path: to, oldPath: from, oldContent, newContent: oldContent })
        invalidateFileTreeCache(dir)
        return { result: `Renamed "${from}" → "${to}".`, fileChanges }
      } catch {
        return { result: `Error: file "${from}" not found`, fileChanges }
      }
    }

    case 'compile_project': {
      const compiler = args.compiler || userCompiler || 'pdflatex'
      const mainFile = args.main_file || 'main.tex'
      const allowed = ['pdflatex', 'xelatex', 'lualatex', 'latexmk']
      if (!allowed.includes(compiler)) {
        return { result: `Error: unsupported compiler "${compiler}"`, fileChanges }
      }
      const buildDir = path.join(dir, 'build')
      ensureDir(buildDir)
      try {
        const res = await runCompile(compiler, mainFile, dir, buildDir)
        return { result: JSON.stringify(res), fileChanges }
      } catch (err) {
        return { result: `Compile error: ${err.message}`, fileChanges }
      }
    }

    default:
      return { result: `Unknown tool: ${name}`, fileChanges }
  }
}

// ── Compile helper ─────────────────────────────────────────────────

function runCompile(compiler, mainFile, srcDir, buildDir) {
  const args = compiler === 'latexmk'
    ? ['-pdf', '-interaction=nonstopmode', `-output-directory=${buildDir}`, mainFile]
    : ['-interaction=nonstopmode', `-output-directory=${buildDir}`, mainFile]

  return new Promise((resolve, reject) => {
    const proc = spawn(compiler, args, {
      cwd: srcDir,
      timeout: 60_000,
      env: { ...process.env, TEXMFOUTPUT: buildDir },
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', d => { stdout += d })
    proc.stderr.on('data', d => { stderr += d })

    proc.on('close', code => {
      const pdfName = mainFile.replace(/\.tex$/, '.pdf')
      const pdfExists = fsSync.existsSync(path.join(buildDir, pdfName))
      resolve({
        ok: code === 0 && pdfExists,
        code,
        pdfExists,
        compiler,
        stdout: stdout.slice(-3000),
        stderr: stderr.slice(-1500),
      })
    })

    proc.on('error', err => reject(err))
  })
}

// ── Call Qwen API ───────────────────────────────────────────────────

async function callLLM(messages, useTools = true) {
  const body = {
    model: AI_MODEL,
    messages,
    temperature: 0.3,
    max_tokens: 16384,
  }
  if (useTools) {
    body.tools = TOOLS
    body.tool_choice = 'auto'
  }

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LLM API error ${res.status}: ${text.slice(0, 500)}`)
  }

  return res.json()
}

// ── Streaming LLM call ─────────────────────────────────────────────

async function callLLMStream(messages, model, useTools = true) {
  const body = {
    model: model || AI_MODEL,
    messages,
    temperature: 0.3,
    max_tokens: 16384,
    stream: true,
  }
  if (useTools) {
    body.tools = TOOLS
    body.tool_choice = 'auto'
  }

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LLM API error ${res.status}: ${text.slice(0, 500)}`)
  }

  return res.body
}

// ── Parse SSE stream from LLM into a complete message ──────────────

async function consumeStream(stream, onContentDelta) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Accumulated message
  let content = ''
  const toolCallsMap = new Map() // index -> { id, name, arguments }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      let parsed
      try { parsed = JSON.parse(data) } catch { continue }

      const delta = parsed.choices?.[0]?.delta
      if (!delta) continue

      // Content delta
      if (delta.content) {
        content += delta.content
        if (onContentDelta) onContentDelta(delta.content)
      }

      // Tool call deltas
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, {
              id: tc.id || '',
              name: tc.function?.name || '',
              arguments: '',
            })
          }
          const entry = toolCallsMap.get(idx)
          if (tc.id) entry.id = tc.id
          if (tc.function?.name) entry.name = tc.function.name
          if (tc.function?.arguments) entry.arguments += tc.function.arguments
        }
      }
    }
  }

  // Convert tool calls map to array
  const toolCalls = [...toolCallsMap.values()].map(tc => ({
    id: tc.id,
    type: 'function',
    function: { name: tc.name, arguments: tc.arguments },
  }))

  return { content, toolCalls }
}

// ── Agent loop ──────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 12

export async function runAgent({ dataDir, projectId, projectName, message, history, compiler, isOwner }) {
  const dir = projectDir(dataDir, projectId)
  const allFileChanges = []
  const toolCalls = []

  // Auto-fetch file list for context injection
  let fileList = []
  try { fileList = await getCachedFileTree(dir) } catch { /* ignore */ }

  // Build messages
  const messages = [
    { role: 'system', content: buildSystemPrompt(projectName, fileList, compiler, isOwner) },
    ...history,
    { role: 'user', content: message },
  ]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await callLLM(messages)
    const choice = completion.choices?.[0]
    if (!choice) throw new Error('No response from LLM')

    const assistantMsg = choice.message
    messages.push(assistantMsg)

    // If no tool calls, we're done
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      return {
        reply: assistantMsg.content || '',
        fileChanges: allFileChanges,
        toolCalls,
      }
    }

    // Execute each tool call
    for (const tc of assistantMsg.tool_calls) {
      let args = {}
      try {
        args = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments || {}
      } catch { /* parse error — empty args */ }

      const { result, fileChanges } = await executeTool(tc.function.name, args, dir, compiler, isOwner)
      allFileChanges.push(...fileChanges)
      toolCalls.push({ name: tc.function.name, args, result: result.slice(0, 200) })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }
  }

  // If we exhausted rounds, return what we have
  return {
    reply: 'I performed several operations but reached the maximum number of steps. Please check the results.',
    fileChanges: allFileChanges,
    toolCalls,
  }
}

// ── Streaming agent loop ────────────────────────────────────────────
// emit(event, data) sends SSE events to the client

export async function runAgentStream({ dataDir, projectId, projectName, message, history, model, compiler, isOwner, emit }) {
  const dir = projectDir(dataDir, projectId)
  const chosenModel = (model && AVAILABLE_MODELS.includes(model)) ? model : AI_MODEL
  const isThinkingModel = chosenModel.includes('Thinking')

  // Auto-fetch file list for context injection
  let fileList = []
  try { fileList = await getCachedFileTree(dir) } catch { /* ignore */ }

  const messages = [
    { role: 'system', content: buildSystemPrompt(projectName, fileList, compiler, isOwner) },
    ...history,
    { role: 'user', content: message },
  ]

  emit('status', { model: chosenModel, round: 0 })

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    emit('thinking', { round: round + 1 })

    // Stream the LLM response
    const stream = await callLLMStream(messages, chosenModel, true)
    let contentBuffer = ''
    let inThinking = false
    let thinkingBuffer = ''

    const { content, toolCalls } = await consumeStream(stream, (delta) => {
      contentBuffer += delta

      // For thinking models, extract <think> blocks using state tracking
      if (isThinkingModel) {
        if (!inThinking && contentBuffer.includes('<think>')) {
          inThinking = true
          // Only emit the portion of this delta that falls after <think>
          const tagPos = contentBuffer.indexOf('<think>')
          thinkingBuffer = contentBuffer.slice(tagPos + 7)
          if (thinkingBuffer) emit('thinking_content', { content: thinkingBuffer })
          return
        }
        if (inThinking) {
          if (contentBuffer.includes('</think>')) {
            // Thinking block closed — emit the final full thinking text
            const openIdx = contentBuffer.indexOf('<think>') + 7
            const closeIdx = contentBuffer.indexOf('</think>')
            const fullThinking = contentBuffer.slice(openIdx, closeIdx)
            emit('thinking_done', { content: fullThinking })
            inThinking = false
            const afterThink = contentBuffer.slice(closeIdx + 8).trim()
            if (afterThink) emit('content', { content: afterThink })
            // Reset buffer to only post-think content
            contentBuffer = afterThink
          } else {
            // Still inside <think> — emit only the new delta
            thinkingBuffer += delta
            emit('thinking_content', { content: delta })
          }
          return
        }
      }

      emit('content', { content: delta })
    })

    // Build assistant message for conversation history
    const assistantMsg = { role: 'assistant', content: content || null }
    if (toolCalls.length > 0) {
      assistantMsg.tool_calls = toolCalls
    }
    messages.push(assistantMsg)

    // No tool calls — we're done
    if (toolCalls.length === 0) {
      // Strip <think>...</think> tags from the final reply
      const cleanReply = isThinkingModel
        ? (content || '').replace(/^<think>[\s\S]*?<\/think>\s*/, '')
        : content
      emit('done', { reply: cleanReply })
      return
    }

    // Execute each tool call
    for (const tc of toolCalls) {
      let args = {}
      try {
        args = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments || {}
      } catch { /* parse error */ }

      emit('tool_call', { name: tc.function.name, args })

      const { result, fileChanges } = await executeTool(tc.function.name, args, dir, compiler, isOwner)

      emit('tool_result', {
        name: tc.function.name,
        result: result.slice(0, 200),
      })

      // Emit file changes individually
      for (const fc of fileChanges) {
        emit('file_change', fc)
      }

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      })
    }
  }

  // Exhausted rounds
  emit('done', {
    reply: 'I performed several operations but reached the maximum number of steps. Please check the results.',
  })
}

export function isConfigured() {
  return !!(AI_API_KEY)
}

export function getProvider() {
  return AI_MODEL
}

export function getAvailableModels() {
  return AVAILABLE_MODELS
}
