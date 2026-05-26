import { createReadStream, existsSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, rm, stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import os from "node:os"
import path from "node:path"
import { captureOptions } from "../capture/CaptureOptions"
import { readCaptureSettings, writeCaptureSettings } from "../capture/CaptureSettingsStore"
import { startScreenCapture, type ActiveCapture } from "../capture/ScreencaptureAdapter"
import { isCaptureSettings, isSessionEditorState } from "../shared/schemas"
import type { CaptureSettings, SessionEditorState } from "../shared/types"
import { capiExportMiddleware } from "./exportRoute"
import { SourceRegistry } from "../sources/SourceRegistry"
import { createMediaStill } from "../sources/MediaMetadata"
import type { StoredSession } from "../session/SessionStore"
import { writeRuntimeStatus } from "../status/RuntimeStatus"

type ActiveRuntimeSession = Pick<StoredSession, "id" | "sessionDir" | "sourceDir">
const SESSION_THUMBNAIL_FILE = "session-still.jpg"

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode
  response.setHeader("Content-Type", "application/json")
  response.end(JSON.stringify(body))
}

function sessionDirFor(sessionId: string) {
  return path.join(os.tmpdir(), "capi", "sessions", sessionId)
}

function initialActiveSession(): ActiveRuntimeSession | null {
  const id = process.env.CAPI_SESSION_ID
  const sessionDir = process.env.CAPI_SESSION_DIR
  const sourceDir = process.env.CAPI_SOURCE_DIR ?? process.env.CAPI_CAPTURE_DIR

  return id && sessionDir && sourceDir ? { id, sessionDir, sourceDir } : null
}

function sourceDirFor(sessionId: string) {
  return path.join(sessionDirFor(sessionId), "sources")
}

function sessionThumbnailPath(session: ActiveRuntimeSession) {
  return path.join(session.sessionDir, SESSION_THUMBNAIL_FILE)
}

function sessionViewUrl(sessionId: string) {
  return `/app/sessions/${encodeURIComponent(sessionId)}`
}

function sessionImageSvg(sessionId: string) {
  const hash = createHash("sha256").update(sessionId).digest("hex")
  const liftA = Number.parseInt(hash.slice(0, 2), 16) % 46
  const liftB = Number.parseInt(hash.slice(2, 4), 16) % 34
  const offset = Number.parseInt(hash.slice(4, 6), 16) % 32
  const shortId = sessionId.slice(0, 8)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" role="img" aria-label="Session ${shortId}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#050816"/>
      <stop offset="0.58" stop-color="#070c1f"/>
      <stop offset="1" stop-color="#020511"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ff5a1f"/>
      <stop offset="0.35" stop-color="#ff2d7a"/>
      <stop offset="0.68" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#2563eb"/>
    </linearGradient>
    <radialGradient id="glowA" cx="18%" cy="10%" r="48%">
      <stop offset="0" stop-color="#ff2d7a" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#ff2d7a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="86%" cy="18%" r="46%">
      <stop offset="0" stop-color="#2563eb" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#2563eb" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="960" height="540" fill="url(#bg)"/>
  <rect width="960" height="540" fill="url(#glowA)"/>
  <rect width="960" height="540" fill="url(#glowB)"/>
  <rect x="48" y="56" width="864" height="428" rx="28" fill="rgba(8,14,31,0.72)" stroke="rgba(151,164,211,0.18)" stroke-width="2"/>
  <path d="M96 ${358 - offset} C206 ${248 - liftA} 318 ${432 - liftB} 450 ${286 - offset} C584 ${142 + liftB} 704 ${334 - liftA} 864 ${196 + offset} L864 484 L96 484 Z" fill="url(#brand)" opacity="0.84"/>
  <path d="M96 ${394 - offset} C226 ${280 - liftB} 330 ${454 - liftA} 468 ${326 - offset} C620 ${188 + liftA} 724 ${372 - liftB} 864 ${250 + offset}" fill="none" stroke="rgba(248,250,252,0.46)" stroke-width="10" stroke-linecap="round"/>
  <g fill="rgba(248,250,252,0.88)" font-family="Inter, ui-sans-serif, system-ui" font-weight="700">
    <text x="96" y="132" font-size="34">Capi Session</text>
    <text x="96" y="176" font-size="22" opacity="0.72">${shortId}</text>
  </g>
</svg>`
}

async function firstSessionSourcePath(session: ActiveRuntimeSession) {
  const files = await readdir(session.sourceDir).catch(() => [])
  const file = files
    .filter((candidate) => candidate.toLowerCase().endsWith(".mov"))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0]

  return file ? path.join(session.sourceDir, file) : null
}

async function sessionStillPath(session: ActiveRuntimeSession) {
  const firstSourcePath = await firstSessionSourcePath(session)
  if (!firstSourcePath) {
    return null
  }

  const thumbnailPath = sessionThumbnailPath(session)
  if (!existsSync(thumbnailPath)) {
    await createMediaStill(firstSourcePath, thumbnailPath)
  }

  const thumbnailStat = await stat(thumbnailPath).catch(() => null)
  return thumbnailStat?.isFile() ? thumbnailPath : null
}

async function sessionStore() {
  const databasePath = process.env.CAPI_DATABASE_PATH
  if (!databasePath) {
    return null
  }

  const { SessionStore } = await import("../session/SessionStore")
  return new SessionStore(databasePath)
}

async function readJsonBody(request: IncomingMessage) {
  let body = ""

  for await (const chunk of request) {
    body += chunk.toString()
  }

  if (!body.trim()) {
    return null
  }

  return JSON.parse(body) as unknown
}

async function syncSessionSources(registry: SourceRegistry, session: ActiveRuntimeSession) {
  await registry.registerSourcesInDirectory(session.sourceDir)
}

async function sendSessionSources(
  response: ServerResponse,
  sessionId: string,
  registryFor: (session: ActiveRuntimeSession) => SourceRegistry,
) {
  const store = await sessionStore()
  if (!store) {
    sendJson(response, 500, { error: "No Capi session store is available." })
    return
  }

  try {
    const session = store.sessionById(sessionId)
    if (!session) {
      sendJson(response, 404, { error: "Session not found." })
      return
    }

    const sourceRegistry = registryFor(session)
    await syncSessionSources(sourceRegistry, session)
    sendJson(response, 200, sourceRegistry.listSources())
  } finally {
    store.close()
  }
}

async function handleEditorStateRequest(
  request: IncomingMessage,
  response: ServerResponse,
  sessionId: string,
) {
  const store = await sessionStore()
  if (!store) {
    sendJson(response, 500, { error: "No Capi session store is available." })
    return
  }

  try {
    const session = store.sessionById(sessionId)
    if (!session) {
      sendJson(response, 404, { error: "Session not found." })
      return
    }

    if (request.method === "GET") {
      sendJson(response, 200, store.readEditorState(session.id))
      return
    }

    if (request.method === "PUT" || request.method === "POST") {
      const body = await readJsonBody(request).catch(() => undefined)
      if (body === undefined) {
        sendJson(response, 400, { error: "Session editor state must be valid JSON." })
        return
      }

      const state = body && typeof body === "object" && "state" in body
        ? (body as { state?: unknown }).state
        : body

      if (!isSessionEditorState(state)) {
        sendJson(response, 400, { error: "Session editor state is required." })
        return
      }

      store.writeEditorState(session.id, state)
      sendJson(response, 200, state)
      return
    }

    sendJson(response, 405, { error: "Use GET, PUT, or POST /sessions/:sessionId/editor-state." })
  } finally {
    store.close()
  }
}

function removeSourceFromEditorState(state: SessionEditorState, sourceId: string): SessionEditorState {
  let timelineStart = 0
  const clips = state.clips
    .filter((clip) => clip.sourceId !== sourceId)
    .sort((left, right) => left.timelineStart - right.timelineStart)
    .map((clip) => {
      const nextClip = { ...clip, timelineStart }
      timelineStart += clip.timelineDuration
      return nextClip
    })

  return { clips }
}

function parseRangeHeader(rangeHeader: string | undefined, size: number) {
  const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null

  const [, startValue, endValue] = match
  if (!startValue && !endValue) return null

  if (!startValue) {
    const suffixLength = Number(endValue)
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null

    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    }
  }

  const start = Number(startValue)
  const end = endValue ? Number(endValue) : size - 1

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null
  }

  return {
    start,
    end: Math.min(end, size - 1),
  }
}

async function serveSessionClip(request: IncomingMessage, requestUrl: URL, response: ServerResponse) {
  const store = await sessionStore()
  const source = store?.sessionForSourcePath(requestUrl.pathname)
  store?.close()

  if (!source) {
    sendJson(response, 404, { error: "Source not found." })
    return
  }

  const clipPath = path.join(source.session.sourceDir, source.file)
  const clipStat = await stat(clipPath).catch(() => null)

  if (!clipStat?.isFile() || !source.file.toLowerCase().endsWith(".mov")) {
    sendJson(response, 404, { error: "Source not found." })
    return
  }

  response.setHeader("Content-Type", "video/quicktime")
  response.setHeader("Accept-Ranges", "bytes")

  const range = parseRangeHeader(request.headers.range, clipStat.size)
  if (request.headers.range && !range) {
    response.statusCode = 416
    response.setHeader("Content-Range", `bytes */${clipStat.size}`)
    response.end()
    return
  }

  if (range) {
    response.statusCode = 206
    response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${clipStat.size}`)
    response.setHeader("Content-Length", String(range.end - range.start + 1))

    if (request.method === "HEAD") {
      response.end()
      return
    }

    createReadStream(clipPath, range).pipe(response)
    return
  }

  response.statusCode = 200
  response.setHeader("Content-Length", String(clipStat.size))

  if (request.method === "HEAD") {
    response.end()
    return
  }

  createReadStream(clipPath).pipe(response)
}

async function captureSource(
  registry: SourceRegistry,
  session: ActiveRuntimeSession,
  settings: CaptureSettings,
  response: ServerResponse,
  onActiveCapture: (capture: ActiveCapture) => void,
) {
  if (process.platform !== "darwin") {
    sendJson(response, 501, { error: "Capture is only available on macOS." })
    return
  }

  const file = `${Date.now()}.mov`
  const filePath = path.join(session.sourceDir, file)
  const capture = startScreenCapture(filePath, settings)
  onActiveCapture(capture)
  await writeRuntimeStatus({
    state: "recording",
    sessionId: session.id,
    message: "Recording.",
  })

  const result = await capture.result
  const source = await registry.registerSourceWithMetadata(result.filePath)
  await writeRuntimeStatus({
    state: "idle",
    sessionId: session.id,
    message: "Recording saved.",
  })
  sendJson(response, 200, registry.sourceForEditor(source))
}

export function capiRuntimeMiddleware(root: string) {
  let activeSession = initialActiveSession()
  const sourceRegistries = new Map<string, SourceRegistry>()
  let activeCapture: Promise<void> | null = null
  let activeScreenCapture: ActiveCapture | null = null
  let activeCaptureSession: ActiveRuntimeSession | null = null

  const exportMiddleware = capiExportMiddleware(root, {
    resolveSourcePath(clip) {
      const sessionClipMatch = clip.sourcePath?.match(/^\/sessions\/([^/]+)\/clips\/([^/]+)$/)
      if (sessionClipMatch) {
        const [, encodedSessionId, encodedFile] = sessionClipMatch
        const sessionId = decodeURIComponent(encodedSessionId)
        const sessionSourceDir = sessionId === activeSession?.id ? activeSession.sourceDir : sourceDirFor(sessionId)
        const sourcePath = path.join(sessionSourceDir, path.basename(decodeURIComponent(encodedFile)))
        if (existsSync(sourcePath)) {
          return sourcePath
        }

        throw new Error(`Source not found for ${clip.file}.`)
      }

      if (!activeSession) {
        return null
      }

      return path.join(activeSession.sourceDir, path.basename(clip.file))
    },
  })

  function registryFor(session: ActiveRuntimeSession) {
    const existingRegistry = sourceRegistries.get(session.id)
    if (existingRegistry) {
      return existingRegistry
    }

    const registry = new SourceRegistry({
      sessionId: session.id,
      thumbnailPath: sessionThumbnailPath(session),
    })
    sourceRegistries.set(session.id, registry)
    return registry
  }

  function captureInProgress() {
    return activeCapture !== null || activeScreenCapture !== null
  }

  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!request.url) {
      next()
      return
    }

    const requestUrl = new URL(request.url, "http://localhost")

    if (requestUrl.pathname === "/sessions") {
      if (request.method !== "GET" && request.method !== "POST") {
        sendJson(response, 405, { error: "Use GET or POST /sessions." })
        return
      }

      const store = await sessionStore()
      if (!store) {
        if (request.method === "POST") {
          sendJson(response, 500, { error: "No Capi session store is available." })
          return
        }

        sendJson(response, 200, { sessions: [], activeSessionId: null, lastSessionId: null })
        return
      }

      try {
        if (request.method === "POST") {
          if (captureInProgress()) {
            sendJson(response, 409, { error: "Stop the active capture before changing sessions." })
            return
          }

          const sessionId = randomUUID()
          const sessionDir = sessionDirFor(sessionId)
          const sourceDir = sourceDirFor(sessionId)
          const session = store.createSession({ id: sessionId, sessionDir, sourceDir })
          await mkdir(sourceDir, { recursive: true })
          store.markSessionOpened(session.id)
          activeSession = session
          sendJson(response, 201, { session, url: sessionViewUrl(session.id) })
          return
        }

        sendJson(response, 200, {
          sessions: store.listSessions(),
          activeSessionId: activeSession?.id ?? null,
          lastSessionId: store.lastSessionId(),
        })
      } finally {
        store.close()
      }
      return
    }

    const openSessionMatch = requestUrl.pathname.match(/^\/sessions\/([^/]+)\/open$/)
    if (openSessionMatch) {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Use POST /sessions/:sessionId/open." })
        return
      }

      const store = await sessionStore()
      if (!store) {
        sendJson(response, 500, { error: "No Capi session store is available." })
        return
      }

      try {
        const sessionId = decodeURIComponent(openSessionMatch[1])
        const session = store.sessionById(sessionId)
        if (!session) {
          sendJson(response, 404, { error: "Session not found." })
          return
        }

        if (session.id !== activeSession?.id && captureInProgress()) {
          sendJson(response, 200, { session, url: sessionViewUrl(session.id) })
          return
        }

        await mkdir(session.sourceDir, { recursive: true })
        activeSession = session
        store.markSessionOpened(session.id)
        sendJson(response, 200, { session: store.sessionById(session.id) ?? session, url: sessionViewUrl(session.id) })
      } finally {
        store.close()
      }
      return
    }

    const sessionEditorStateMatch = requestUrl.pathname.match(/^\/sessions\/([^/]+)\/editor-state$/)
    if (sessionEditorStateMatch) {
      await handleEditorStateRequest(request, response, decodeURIComponent(sessionEditorStateMatch[1]))
      return
    }

    const sessionSourcesMatch = requestUrl.pathname.match(/^\/sessions\/([^/]+)\/sources$/)
    if (sessionSourcesMatch) {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Use GET /sessions/:sessionId/sources." })
        return
      }

      await sendSessionSources(response, decodeURIComponent(sessionSourcesMatch[1]), registryFor)
      return
    }

    const deleteSessionSourceMatch = requestUrl.pathname.match(/^\/sessions\/([^/]+)\/sources\/([^/]+)$/)
    if (deleteSessionSourceMatch) {
      if (request.method !== "DELETE") {
        sendJson(response, 405, { error: "Use DELETE /sessions/:sessionId/sources/:sourceId." })
        return
      }

      const store = await sessionStore()
      if (!store) {
        sendJson(response, 500, { error: "No Capi session store is available." })
        return
      }

      try {
        const sessionId = decodeURIComponent(deleteSessionSourceMatch[1])
        const sourceId = decodeURIComponent(deleteSessionSourceMatch[2])
        const session = store.sessionById(sessionId)
        if (!session) {
          sendJson(response, 404, { error: "Session not found." })
          return
        }

        if (activeSession?.id === session.id && captureInProgress()) {
          sendJson(response, 409, { error: "Stop the active capture before deleting a source." })
          return
        }

        const sourceRegistry = registryFor(session)
        await syncSessionSources(sourceRegistry, session)
        const deleted = await sourceRegistry.deleteSource(sourceId)
        if (!deleted) {
          sendJson(response, 404, { error: "Source not found." })
          return
        }

        store.writeEditorState(
          session.id,
          removeSourceFromEditorState(store.readEditorState(session.id), sourceId),
        )
        sendJson(response, 200, { sourceId })
      } finally {
        store.close()
      }
      return
    }

    const deleteSessionMatch = requestUrl.pathname.match(/^\/sessions\/([^/]+)$/)
    if (deleteSessionMatch) {
      if (request.method !== "DELETE") {
        sendJson(response, 405, { error: "Use DELETE /sessions/:sessionId." })
        return
      }

      const store = await sessionStore()
      if (!store) {
        sendJson(response, 500, { error: "No Capi session store is available." })
        return
      }

      try {
        const sessionId = decodeURIComponent(deleteSessionMatch[1])
        const session = store.sessionById(sessionId)
        if (!session) {
          sendJson(response, 404, { error: "Session not found." })
          return
        }

        if (activeSession?.id === session.id && captureInProgress()) {
          sendJson(response, 409, { error: "Stop the active capture before deleting this session." })
          return
        }

        store.deleteSession(session.id)
        sourceRegistries.delete(session.id)
        if (activeSession?.id === session.id) {
          activeSession = null
        }
        await rm(session.sessionDir, { recursive: true, force: true })
        sendJson(response, 200, { sessionId: session.id })
      } finally {
        store.close()
      }
      return
    }

    const sessionImageMatch = requestUrl.pathname.match(/^\/sessions\/([^/]+)\/image$/)
    if (sessionImageMatch) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Use GET or HEAD /sessions/:sessionId/image." })
        return
      }

      const sessionId = decodeURIComponent(sessionImageMatch[1])
      const store = await sessionStore()
      const session = store?.sessionById(sessionId) ?? {
        id: sessionId,
        sessionDir: sessionDirFor(sessionId),
        sourceDir: sourceDirFor(sessionId),
      }
      store?.close()
      const stillPath = await sessionStillPath(session)

      response.statusCode = 200
      response.setHeader("Cache-Control", "no-cache")
      if (request.method === "HEAD") {
        response.setHeader("Content-Type", stillPath ? "image/jpeg" : "image/svg+xml")
        response.end()
        return
      }

      if (stillPath) {
        const stillStat = await stat(stillPath)
        response.setHeader("Content-Type", "image/jpeg")
        response.setHeader("Content-Length", String(stillStat.size))
        createReadStream(stillPath).pipe(response)
        return
      }

      response.setHeader("Content-Type", "image/svg+xml")
      response.end(sessionImageSvg(sessionId))
      return
    }

    if (requestUrl.pathname === "/session") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Use GET /session." })
        return
      }

      const store = await sessionStore()
      if (!store || !activeSession) {
        sendJson(response, 200, { session: null })
        return
      }

      try {
        sendJson(response, 200, { session: store.sessionById(activeSession.id) })
      } finally {
        store.close()
      }
      return
    }

    if (requestUrl.pathname === "/session/editor-state") {
      if (!activeSession) {
        sendJson(response, 404, { error: "No active session." })
        return
      }

      await handleEditorStateRequest(request, response, activeSession.id)
      return
    }

    if (requestUrl.pathname === "/sources") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Use GET /sources." })
        return
      }

      if (!activeSession) {
        sendJson(response, 200, [])
        return
      }

      const sourceRegistry = registryFor(activeSession)
      await syncSessionSources(sourceRegistry, activeSession)
      sendJson(response, 200, sourceRegistry.listSources())
      return
    }

    if (requestUrl.pathname === "/capture-options") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Use GET /capture-options." })
        return
      }

      try {
        sendJson(response, 200, await captureOptions())
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not load capture options."
        sendJson(response, 500, { error: message })
      }
      return
    }

    if (requestUrl.pathname === "/capture-settings") {
      try {
        if (request.method === "GET") {
          sendJson(response, 200, { settings: await readCaptureSettings() })
          return
        }

        if (request.method === "PUT") {
          const body = await readJsonBody(request).catch(() => undefined)
          if (body === undefined) {
            sendJson(response, 400, { error: "Capture settings must be valid JSON." })
            return
          }

          const settings = body && typeof body === "object" && "settings" in body
            ? (body as { settings?: unknown }).settings
            : null

          if (!isCaptureSettings(settings)) {
            sendJson(response, 400, { error: "Capture settings are required." })
            return
          }

          await writeCaptureSettings(settings)
          sendJson(response, 200, { settings })
          return
        }

        sendJson(response, 405, { error: "Use GET or PUT /capture-settings." })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not update capture settings."
        sendJson(response, 500, { error: message })
      }
      return
    }

    if (requestUrl.pathname.startsWith("/sessions/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Use GET or HEAD /sessions/:sessionId/clips/:file." })
        return
      }

      await serveSessionClip(request, requestUrl, response)
      return
    }

    if (requestUrl.pathname === "/captures") {
      if (request.method === "GET") {
        sendJson(response, 200, {
          status: captureInProgress() ? "capturing" : "idle",
        })
        return
      }

      if (request.method === "DELETE") {
        if (!activeScreenCapture) {
          sendJson(response, 409, { error: "No capture is in progress." })
          return
        }

        const captureSession = activeCaptureSession ?? activeSession
        void writeRuntimeStatus({
          state: "stopping",
          sessionId: captureSession?.id ?? null,
          message: "Stopping recording.",
        })
        activeScreenCapture.stop()
        sendJson(response, 200, {
          status: "stopping",
          sessionId: captureSession?.id ?? null,
          url: captureSession ? sessionViewUrl(captureSession.id) : null,
        })
        return
      }

      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Use GET, POST, or DELETE /captures." })
        return
      }

      try {
        if (!activeSession) {
          sendJson(response, 409, { error: "No active session." })
          return
        }

        if (captureInProgress()) {
          sendJson(response, 409, { error: "A capture is already in progress." })
          return
        }

        const body = await readJsonBody(request).catch(() => undefined)
        if (body === undefined) {
          sendJson(response, 400, { error: "Capture settings must be valid JSON." })
          return
        }

        const settings = body && typeof body === "object" && "settings" in body
          ? (body as { settings?: unknown }).settings
          : null

        if (!isCaptureSettings(settings)) {
          sendJson(response, 400, { error: "Capture settings are required." })
          return
        }

        const sourceRegistry = registryFor(activeSession)
        activeCaptureSession = activeSession
        activeCapture = captureSource(sourceRegistry, activeSession, settings, response, (capture) => {
          activeScreenCapture = capture
        }).finally(() => {
          activeCapture = null
          activeScreenCapture = null
          activeCaptureSession = null
        })
        await activeCapture
      } catch (error) {
        const message = error instanceof Error ? error.message : "Capture failed."
        await writeRuntimeStatus({
          state: "error",
          sessionId: activeSession?.id ?? null,
          message,
        })
        sendJson(response, 500, { error: message })
      }
      return
    }

    await exportMiddleware(request, response, next)
  }
}
