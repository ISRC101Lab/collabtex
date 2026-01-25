function requireEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`missing env: ${name}`)
  return v
}

function clampText(text, maxChars = 12000) {
  const s = String(text || '')
  if (s.length <= maxChars) return s
  return s.slice(s.length - maxChars)
}

function buildResponsesEndpoint(base) {
  if (!base) return ''
  if (base.includes('/v1/chat/completions')) return base.replace(/\/v1\/chat\/completions.*$/, '/v1/responses')
  if (base.endsWith('/responses')) return base
  if (base.endsWith('/v1')) return `${base}/responses`
  if (base.includes('/v1/')) return base.replace(/\/v1\/.*$/, '/v1/responses')
  return `${base}/v1/responses`
}

function buildChatEndpoint(base) {
  if (!base) return ''
  let trimmed = base.replace(/\/+$/, '')
  if (trimmed.includes('/v1/chat/completions')) return trimmed
  if (trimmed.endsWith('/responses')) trimmed = trimmed.replace(/\/responses$/, '')
  if (trimmed.includes('/v1/responses')) trimmed = trimmed.replace(/\/v1\/responses.*$/, '/v1')
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`
  if (trimmed.includes('/v1/')) return `${trimmed.replace(/\/v1\/.*$/, '/v1')}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

function parseResponsesSse(rawText) {
  if (!rawText) return null
  const lines = String(rawText).split(/\r?\n/)
  let outputText = ''
  let lastResponse = null
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const obj = JSON.parse(payload)
      if (obj && obj.type === 'response.output_text.delta' && typeof obj.delta === 'string') {
        outputText += obj.delta
      }
      if (obj && obj.response) lastResponse = obj.response
    } catch {
      // ignore parse errors in streaming chunks
    }
  }
  if (outputText) return { output_text: outputText }
  if (lastResponse) return { response: lastResponse }
  return null
}

async function chatCompletion({ system, messages, apiKey, baseUrl, model, apiStyle }) {
  const key = apiKey || process.env.OPENAI_API_KEY
  if (!key) throw new Error('AI not configured: set OPENAI_API_KEY or provide apiKey')

  const base = (baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const modelName = model || process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const style = (apiStyle || process.env.AI_API_STYLE || '').toLowerCase()
  const hasResponsesHint = base.includes('/responses')
  const hasChatHint = base.includes('/chat/completions')
  const preferResponses =
    style === 'responses' ? true : style === 'chat' ? false : hasResponsesHint ? true : hasChatHint ? false : false
  const allowFallback = style !== 'responses' && style !== 'chat'

  let resp
  let endpointUsed = ''
  const endpointsTried = []

  const sendResponses = async () => {
    const inputText = [
      `SYSTEM: ${system}`,
      ...(messages || []).map((m) => `${String(m.role || 'user').toUpperCase()}: ${m.content}`),
    ].join('\n\n')
    const endpoint = buildResponsesEndpoint(base)
    endpointUsed = endpoint
    endpointsTried.push(endpoint)
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        input: inputText,
        reasoning: { effort: 'high' },
        text: { format: { type: 'text' } },
        stream: false,
      }),
    })
  }

  const sendChat = async () => {
    const endpoint = buildChatEndpoint(base)
    endpointUsed = endpoint
    endpointsTried.push(endpoint)
    return await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, ...(messages || [])],
      }),
    })
  }

  if (preferResponses) {
    resp = await sendResponses()
    if (!resp.ok && allowFallback && resp.status === 404) resp = await sendChat()
  } else {
    resp = await sendChat()
    if (!resp.ok && allowFallback && resp.status === 404) resp = await sendResponses()
  }

  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    const hint = endpointsTried.length ? ` endpoints=${endpointsTried.join(',')}` : endpointUsed ? ` endpoint=${endpointUsed}` : ''
    throw new Error(`AI request failed: HTTP ${resp.status}${hint} ${t}`)
  }

  const contentType = resp.headers.get('content-type') || ''
  let data = null
  if (contentType.includes('application/json')) {
    data = await resp.json()
  } else {
    const text = await resp.text()
    data = parseResponsesSse(text)
    if (!data) {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }
  }

  const payload = data && data.response ? data.response : data
  const content =
    payload?.output_text ||
    payload?.output?.flatMap((o) => (o && o.content ? o.content : [])).map((c) => c.text || c).filter(Boolean).join('') ||
    payload?.choices?.[0]?.message?.content
  if (!content) throw new Error('AI response missing content')
  return content.trim()
}

export async function aiPolish({ text, instruction = '', mode = 'polish', apiKey, baseUrl, model, apiStyle }) {
  const system = [
    'You are an expert academic editor for LaTeX computer systems papers.',
    'Only use the provided LaTeX content; do not infer from build logs or other files.',
    'Improve clarity, concision, grammar, and flow while preserving technical meaning.',
    'Maintain citation keys, labels, refs, and math notation exactly unless instructed.',
    'Do not add new claims, results, or citations.',
    'Prefer minimal, high-impact edits; keep voice consistent and formal.',
    'Preserve macros, environments, and formatting commands.',
    'If rewriting, keep paragraph structure unless instructed.',
    'Return only the rewritten LaTeX text.',
  ].join(' ')

  const user = [
    `Mode: ${mode}`,
    instruction ? `Instruction: ${instruction}` : '',
    'Text:',
    text,
  ]
    .filter(Boolean)
    .join('\n')

  return await chatCompletion({
    system,
    messages: [{ role: 'user', content: user }],
    apiKey,
    baseUrl,
    model,
    apiStyle,
  })
}

export async function aiCompileFix({
  log,
  diagnostics = [],
  mainFile = '',
  targetFile = '',
  compiler = '',
  files = [],
  apiKey,
  baseUrl,
  model,
  apiStyle,
}) {
  const system = [
    'You are a LaTeX build assistant.',
    'Analyze the compile log and diagnose the root cause.',
    'Return concise, actionable fixes in Chinese.',
    'Structure the answer with Root Cause, Fix Steps, and (if applicable) a minimal LaTeX snippet in a fenced ```latex``` block.',
    'If files are missing or paths are wrong, mention case-sensitivity and relative-path rules.',
    'If the main file seems missing, propose selecting a valid .tex from the project file list.',
    'Do not fabricate files or commands.',
  ].join(' ')

  const user = [
    mainFile ? `Main file: ${mainFile}` : '',
    targetFile ? `Target file: ${targetFile}` : '',
    compiler ? `Compiler: ${compiler}` : '',
    files && files.length ? `Project files: ${files.slice(0, 200).join(', ')}` : '',
    diagnostics && diagnostics.length ? `Diagnostics: ${JSON.stringify(diagnostics)}` : '',
    'Log:',
    String(log || '').slice(-12000),
  ]
    .filter(Boolean)
    .join('\n')

  return await chatCompletion({
    system,
    messages: [{ role: 'user', content: user }],
    apiKey,
    baseUrl,
    model,
    apiStyle,
  })
}

export async function aiCompilePatch({
  log,
  diagnostics = [],
  mainFile = '',
  targetFile = '',
  compiler = '',
  files = [],
  apiKey,
  baseUrl,
  model,
  apiStyle,
}) {
  const system = [
    'You are a LaTeX build assistant that applies fixes by editing files.',
    'Return strictly a JSON object with fields: notes (string) and edits (array).',
    'Each edit must have: path (string), content (string), reason (string).',
    'Only edit files provided in the input.',
    'If no safe fix, return {"notes":"...","edits":[]}.',
    'Do not include markdown fences or extra text outside JSON.',
  ].join(' ')

  const cleaned = Array.isArray(files) ? files.slice(0, 8) : []
  const fileBlocks = cleaned
    .map((f, idx) => {
      const p = String(f && f.path ? f.path : `file_${idx + 1}.tex`)
      const content = clampText(f && f.content ? f.content : '', 60000)
      return `FILE: ${p}\n-----\n${content}\n-----`
    })
    .join('\n\n')

  const user = [
    mainFile ? `Main file: ${mainFile}` : '',
    targetFile ? `Target file: ${targetFile}` : '',
    compiler ? `Compiler: ${compiler}` : '',
    diagnostics && diagnostics.length ? `Diagnostics: ${JSON.stringify(diagnostics)}` : '',
    'Log:',
    String(log || '').slice(-12000),
    '',
    'Files:',
    fileBlocks || '(no files)',
  ]
    .filter(Boolean)
    .join('\n')

  return await chatCompletion({
    system,
    messages: [{ role: 'user', content: user }],
    apiKey,
    baseUrl,
    model,
    apiStyle,
  })
}

export async function aiChat({
  context,
  question,
  history = [],
  filePath = '',
  apiKey,
  baseUrl,
  model,
  apiStyle,
  mode = '',
}) {
  if (!question) throw new Error('missing question')
  const isAgent = String(mode || '').toLowerCase() === 'agent'
  const system = isAgent
    ? [
        'You are an expert paper-revision agent for LaTeX systems papers.',
        'Only use the provided LaTeX content as context; do not invent results.',
        'Check clarity, logic, structure, terminology consistency, and LaTeX hygiene.',
        'Return Markdown with three sections: Issues, Suggestions, Rewrite.',
        'Use bullet points for Issues and Suggestions.',
        'Rewrite must be in a fenced ```latex``` block and contain only the revised LaTeX.',
        'Avoid repeating the original text verbatim in the rewrite.',
        'Be decisive and provide concrete rewrites rather than vague advice.',
        'Keep citations/labels/refs intact unless explicitly instructed.',
        'Respond in Chinese.',
      ].join(' ')
    : [
        'You are a copilot-style writing assistant for LaTeX papers.',
        'Only use the provided LaTeX content as context; ignore any build logs or other files.',
        'Keep LaTeX commands/environments intact unless explicitly requested.',
        'Respond in Chinese with clear, actionable suggestions.',
        'If asked to rewrite, return the revised LaTeX snippet only.',
      ].join(' ')

  const safeHistory = Array.isArray(history)
    ? history
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-6)
    : []

  const trimmed = clampText(context, 12000)
  const contextMsg = [
    filePath ? `File: ${filePath}` : '',
    'LaTeX Context:',
    trimmed,
  ]
    .filter(Boolean)
    .join('\n')

  return await chatCompletion({
    system,
    messages: [
      { role: 'user', content: contextMsg },
      ...safeHistory,
      { role: 'user', content: question },
    ],
    apiKey,
    baseUrl,
    model,
    apiStyle,
  })
}
