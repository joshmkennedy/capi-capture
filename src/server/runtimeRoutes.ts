import { createReadStream } from "node:fs"
import { randomUUID } from "node:crypto"
import { mkdir, stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import os from "node:os"
import path from "node:path"
import { captureOptions } from "../capture/CaptureOptions"
import { readCaptureSettings, writeCaptureSettings } from "../capture/CaptureSettingsStore"
import { startScreenCapture, type ActiveCapture } from "../capture/ScreencaptureAdapter"
import { isCaptureSettings, isSessionEditorState } from "../shared/schemas"
import type { CaptureSettings } from "../shared/types"
import { capiExportMiddleware } from "./exportRoute"
import { SourceRegistry } from "../sources/SourceRegistry"
import type { StoredSession } from "../session/SessionStore"

type ActiveRuntimeSession = Pick<StoredSession, "id" | "sessionDir" | "sourceDir">

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

function sessionViewUrl(sessionId: string) {
  return `/?sessionId=${encodeURIComponent(sessionId)}`
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

async function serveClip(registry: SourceRegistry, request: IncomingMessage, requestUrl: URL, response: ServerResponse) {
  const source = registry.sourceForUrlPath(requestUrl.pathname)
  if (!source) {
    sendJson(response, 404, { error: "Source not found." })
    return
  }

  const clipPath = source.filePath
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

  const result = await capture.result
  const source = await registry.registerSourceWithMetadata(result.filePath)
  sendJson(response, 200, registry.sourceForEditor(source))
}

export function capiRuntimeMiddleware(root: string) {
  const exportMiddleware = capiExportMiddleware(root)
  let activeSession = initialActiveSession()
  const sourceRegistries = new Map<string, SourceRegistry>()
  let activeCapture: Promise<void> | null = null
  let activeScreenCapture: ActiveCapture | null = null

  function registryFor(session: ActiveRuntimeSession) {
    const existingRegistry = sourceRegistries.get(session.id)
    if (existingRegistry) {
      return existingRegistry
    }

    const registry = new SourceRegistry({ sessionId: session.id })
    sourceRegistries.set(session.id, registry)
    return registry
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
      const store = await sessionStore()
      if (!store || !activeSession) {
        sendJson(response, 404, { error: "No active session." })
        return
      }

      try {
        if (request.method === "GET") {
          sendJson(response, 200, store.readEditorState(activeSession.id))
          return
        }

        if (request.method === "PUT") {
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

          store.writeEditorState(activeSession.id, state)
          sendJson(response, 200, state)
          return
        }

        sendJson(response, 405, { error: "Use GET or PUT /session/editor-state." })
      } finally {
        store.close()
      }
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

    if (requestUrl.pathname.startsWith("/clips/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Use GET or HEAD /clips/:file." })
        return
      }

      if (!activeSession) {
        sendJson(response, 404, { error: "No active session." })
        return
      }

      const sourceRegistry = registryFor(activeSession)
      await syncSessionSources(sourceRegistry, activeSession)
      await serveClip(sourceRegistry, request, requestUrl, response)
      return
    }

    if (requestUrl.pathname === "/captures") {
      if (request.method === "DELETE") {
        if (!activeScreenCapture) {
          sendJson(response, 409, { error: "No capture is in progress." })
          return
        }

        activeScreenCapture.stop()
        sendJson(response, 200, { status: "stopping" })
        return
      }

      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Use POST or DELETE /captures." })
        return
      }

      try {
        if (!activeSession) {
          sendJson(response, 409, { error: "No active session." })
          return
        }

        if (activeCapture) {
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
        activeCapture = captureSource(sourceRegistry, activeSession, settings, response, (capture) => {
          activeScreenCapture = capture
        }).finally(() => {
          activeCapture = null
          activeScreenCapture = null
        })
        await activeCapture
      } catch (error) {
        const message = error instanceof Error ? error.message : "Capture failed."
        sendJson(response, 500, { error: message })
      }
      return
    }

    await exportMiddleware(request, response, next)
  }
}
