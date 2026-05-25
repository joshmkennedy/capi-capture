import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { SessionEditorState, SessionSummary } from "../shared/types"

type SessionRow = {
  id: string
  session_dir: string
  source_dir: string
  created_at: string
  updated_at: string
  last_opened_at: string
}

type GlobalStateRow = {
  value: string
}

export type StoredSession = {
  id: string
  sessionDir: string
  sourceDir: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export type CreateSessionInput = {
  id: string
  sessionDir: string
  sourceDir: string
  now?: string
}

export class SessionStore {
  private readonly database: DatabaseSync

  constructor(readonly databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true })
    this.database = new DatabaseSync(databasePath)
    this.database.exec("PRAGMA journal_mode = WAL")
    this.database.exec("PRAGMA foreign_keys = ON")
    this.migrate()
  }

  createSession(input: CreateSessionInput): StoredSession {
    const now = input.now ?? new Date().toISOString()
    this.database.prepare(`
      INSERT INTO sessions (id, session_dir, source_dir, created_at, updated_at, last_opened_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(input.id, input.sessionDir, input.sourceDir, now, now, now)

    return this.sessionById(input.id) as StoredSession
  }

  listSessions(): SessionSummary[] {
    const rows = this.database.prepare(`
      SELECT id, session_dir, source_dir, created_at, updated_at, last_opened_at
      FROM sessions
      ORDER BY last_opened_at DESC, created_at DESC
    `).all() as SessionRow[]

    return rows.map((row) => ({
      id: row.id,
      sessionDir: row.session_dir,
      sourceDir: row.source_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: row.last_opened_at,
    }))
  }

  sessionById(sessionId: string): StoredSession | null {
    const row = this.database.prepare(`
      SELECT id, session_dir, source_dir, created_at, updated_at, last_opened_at
      FROM sessions
      WHERE id = ?
    `).get(sessionId) as SessionRow | undefined

    if (!row) {
      return null
    }

    return {
      id: row.id,
      sessionDir: row.session_dir,
      sourceDir: row.source_dir,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastOpenedAt: row.last_opened_at,
    }
  }

  markSessionOpened(sessionId: string, now = new Date().toISOString()) {
    this.database.prepare(`
      UPDATE sessions
      SET last_opened_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, sessionId)
    this.setGlobalState("last_session_id", sessionId)
  }

  deleteSession(sessionId: string) {
    this.database.prepare(`
      DELETE FROM sessions
      WHERE id = ?
    `).run(sessionId)
  }

  lastSessionId() {
    return this.globalState("last_session_id")
  }

  readEditorState(sessionId: string): SessionEditorState {
    const row = this.database.prepare(`
      SELECT clips_json
      FROM session_editor_states
      WHERE session_id = ?
    `).get(sessionId) as { clips_json: string } | undefined

    if (!row) {
      return { clips: [] }
    }

    return { clips: JSON.parse(row.clips_json) as SessionEditorState["clips"] }
  }

  writeEditorState(sessionId: string, state: SessionEditorState, now = new Date().toISOString()) {
    this.database.prepare(`
      INSERT INTO session_editor_states (session_id, clips_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        clips_json = excluded.clips_json,
        updated_at = excluded.updated_at
    `).run(sessionId, JSON.stringify(state.clips), now)

    this.database.prepare(`
      UPDATE sessions
      SET updated_at = ?
      WHERE id = ?
    `).run(now, sessionId)
  }

  sessionForSourcePath(urlPath: string) {
    const match = urlPath.match(/^\/sessions\/([^/]+)\/clips\/([^/]+)$/)
    if (!match) {
      return null
    }

    const [, encodedSessionId, encodedFile] = match
    const sessionId = decodeURIComponent(encodedSessionId)
    const file = path.basename(decodeURIComponent(encodedFile))
    const session = this.sessionById(sessionId)

    return session ? { session, file } : null
  }

  close() {
    this.database.close()
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        session_dir TEXT NOT NULL,
        source_dir TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_editor_states (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        clips_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS global_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  }

  private globalState(key: string) {
    const row = this.database.prepare(`
      SELECT value
      FROM global_state
      WHERE key = ?
    `).get(key) as GlobalStateRow | undefined

    return row?.value ?? null
  }

  private setGlobalState(key: string, value: string) {
    this.database.prepare(`
      INSERT INTO global_state (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value)
  }
}
