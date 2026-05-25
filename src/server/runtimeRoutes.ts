import { spawn } from "node:child_process"
import { createReadStream } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import { capiExportMiddleware } from "./exportRoute"
import type { Source } from "../shared/types"

const FALLBACK_SOURCE_DURATION = 12

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode
  response.setHeader("Content-Type", "application/json")
  response.end(JSON.stringify(body))
}

function sourceTitle(file: string) {
  return file.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")
}

function sessionCaptureDir() {
  return process.env.CAPI_CAPTURE_DIR
}

function sourceFromFile(file: string): Source {
  const id = file.replace(/\.[^.]+$/, "")
  const sourcePath = `/clips/${encodeURIComponent(file)}`

  return {
    id,
    title: sourceTitle(file),
    file,
    path: sourcePath,
    sourcePath,
    duration: FALLBACK_SOURCE_DURATION,
  }
}

async function listSessionSources() {
  const captureDir = sessionCaptureDir()
  if (!captureDir) {
    return []
  }

  const files = await readdir(captureDir).catch(() => [])

  return files
    .filter((file) => file.toLowerCase().endsWith(".mov"))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map(sourceFromFile)
}

async function serveClip(requestUrl: URL, response: ServerResponse) {
  const captureDir = sessionCaptureDir()
  if (!captureDir) {
    sendJson(response, 404, { error: "No active capture directory." })
    return
  }

  const encodedFile = requestUrl.pathname.slice("/clips/".length)
  const file = path.basename(decodeURIComponent(encodedFile))
  const clipPath = path.join(captureDir, file)
  const clipStat = await stat(clipPath).catch(() => null)

  if (!clipStat?.isFile() || !file.toLowerCase().endsWith(".mov")) {
    sendJson(response, 404, { error: "Source not found." })
    return
  }

  response.statusCode = 200
  response.setHeader("Content-Type", "video/quicktime")
  response.setHeader("Content-Length", String(clipStat.size))
  createReadStream(clipPath).pipe(response)
}

function runScreencapture(outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("screencapture", ["-i", "-U", "-Jvideo", "-v", "-g", outputPath], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr.trim() || `screencapture exited with code ${code}.`))
    })
  })
}

async function captureSource(response: ServerResponse) {
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
  await runScreencapture(path.join(captureDir, file))
  sendJson(response, 200, sourceFromFile(file))
}

export function capiRuntimeMiddleware(root: string) {
  const exportMiddleware = capiExportMiddleware(root)

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

      sendJson(response, 200, await listSessionSources())
      return
    }

    if (requestUrl.pathname.startsWith("/clips/")) {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Use GET /clips/:file." })
        return
      }

      await serveClip(requestUrl, response)
      return
    }

    if (requestUrl.pathname === "/captures") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Use POST /captures." })
        return
      }

      try {
        await captureSource(response)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Capture failed."
        sendJson(response, 500, { error: message })
      }
      return
    }

    await exportMiddleware(request, response, next)
  }
}
