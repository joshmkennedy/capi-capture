import { spawn } from "node:child_process"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
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

async function syncSessionSources(registry: SourceRegistry) {
  const captureDir = sessionCaptureDir()
  if (!captureDir) {
    return
  }

  await registry.registerSourcesInDirectory(captureDir)
}

async function serveClip(registry: SourceRegistry, requestUrl: URL, response: ServerResponse) {
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

async function captureSource(registry: SourceRegistry, response: ServerResponse) {
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
  await runScreencapture(filePath)
  sendJson(response, 200, registry.sourceForEditor(registry.registerSource(filePath)))
}

export function capiRuntimeMiddleware(root: string) {
  const exportMiddleware = capiExportMiddleware(root)
  const sourceRegistry = new SourceRegistry()

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

    if (requestUrl.pathname.startsWith("/clips/")) {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Use GET /clips/:file." })
        return
      }

      await serveClip(sourceRegistry, requestUrl, response)
      return
    }

    if (requestUrl.pathname === "/captures") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Use POST /captures." })
        return
      }

      try {
        await captureSource(sourceRegistry, response)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Capture failed."
        sendJson(response, 500, { error: message })
      }
      return
    }

    await exportMiddleware(request, response, next)
  }
}
