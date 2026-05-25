import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import { captureOptions } from "../capture/CaptureOptions"
import { readCaptureSettings, writeCaptureSettings } from "../capture/CaptureSettingsStore"
import { startScreenCapture, type ActiveCapture } from "../capture/ScreencaptureAdapter"
import { isCaptureSettings } from "../shared/schemas"
import type { CaptureSettings } from "../shared/types"
import { capiExportMiddleware } from "./exportRoute"
import { SourceRegistry } from "../sources/SourceRegistry"

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode
  response.setHeader("Content-Type", "application/json")
  response.end(JSON.stringify(body))
}

function sessionCaptureDir() {
  return process.env.CAPI_CAPTURE_DIR
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

async function syncSessionSources(registry: SourceRegistry) {
  const captureDir = sessionCaptureDir()
  if (!captureDir) {
    return
  }

  await registry.registerSourcesInDirectory(captureDir)
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
  const captureDir = sessionCaptureDir()
  if (!captureDir) {
    sendJson(response, 404, { error: "No active capture directory." })
    return
  }

  await syncSessionSources(registry)

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

async function captureSource(
  registry: SourceRegistry,
  settings: CaptureSettings,
  response: ServerResponse,
  onActiveCapture: (capture: ActiveCapture) => void,
) {
  const captureDir = sessionCaptureDir()
  if (!captureDir) {
    sendJson(response, 500, { error: "No active capture directory." })
    return
  }

  if (process.platform !== "darwin") {
    sendJson(response, 501, { error: "Capture is only available on macOS." })
    return
  }

  const file = `${Date.now()}.mov`
  const filePath = path.join(captureDir, file)
  const capture = startScreenCapture(filePath, settings)
  onActiveCapture(capture)

  const result = await capture.result
  const source = await registry.registerSourceWithMetadata(result.filePath)
  sendJson(response, 200, registry.sourceForEditor(source))
}

export function capiRuntimeMiddleware(root: string) {
  const exportMiddleware = capiExportMiddleware(root)
  const sourceRegistry = new SourceRegistry()
  let activeCapture: Promise<void> | null = null
  let activeScreenCapture: ActiveCapture | null = null

  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!request.url) {
      next()
      return
    }

    const requestUrl = new URL(request.url, "http://localhost")

    if (requestUrl.pathname === "/sources") {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Use GET /sources." })
        return
      }

      await syncSessionSources(sourceRegistry)
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

    if (requestUrl.pathname.startsWith("/clips/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Use GET or HEAD /clips/:file." })
        return
      }

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

        activeCapture = captureSource(sourceRegistry, settings, response, (capture) => {
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
