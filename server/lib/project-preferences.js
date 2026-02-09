import fs from 'node:fs/promises'
import path from 'node:path'

const PREFS_FILE = 'project-list-preferences.json'

const DEFAULT_PREFS = {
  scope: 'owned',
  sort: 'updated_desc',
  view: 'list',
}

const ALLOWED_SCOPE = new Set(['all', 'owned', 'shared'])
const ALLOWED_SORT = new Set(['updated_desc', 'updated_asc', 'name_asc', 'name_desc'])
const ALLOWED_VIEW = new Set(['list', 'card'])

async function loadPrefsDb(dataDir) {
  const file = path.join(dataDir, PREFS_FILE)
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return { byUser: {} }
  }
}

async function savePrefsDb(dataDir, db) {
  const file = path.join(dataDir, PREFS_FILE)
  await fs.writeFile(file, JSON.stringify(db, null, 2), 'utf8')
}

function normalizePrefs(prefs) {
  const merged = { ...DEFAULT_PREFS, ...(prefs || {}) }

  // backward compatibility: old value "compact" => new value "card"
  if (merged.view === 'compact') merged.view = 'card'

  if (!ALLOWED_SCOPE.has(merged.scope)) merged.scope = DEFAULT_PREFS.scope
  if (!ALLOWED_SORT.has(merged.sort)) merged.sort = DEFAULT_PREFS.sort
  if (!ALLOWED_VIEW.has(merged.view)) merged.view = DEFAULT_PREFS.view
  return merged
}

export async function getProjectListPreferences(dataDir, username) {
  const db = await loadPrefsDb(dataDir)
  return normalizePrefs(db.byUser?.[username])
}

export async function updateProjectListPreferences(dataDir, username, updates) {
  const db = await loadPrefsDb(dataDir)
  const current = normalizePrefs(db.byUser?.[username])
  const next = normalizePrefs({ ...current, ...(updates || {}) })
  db.byUser[username] = {
    ...next,
    updatedAt: new Date().toISOString(),
  }
  await savePrefsDb(dataDir, db)
  return next
}
