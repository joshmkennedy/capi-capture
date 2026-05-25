import type { IncomingMessage, ServerResponse } from "node:http"
import { exportPresentation } from "../export/FfmpegExporter"
import type { PlanExportOptions } from "../export/ExportPlanner"
import { isExportPayload } from "../shared/schemas"

const EXPORT_ROUTE = "/export"

function readJsonBody(request: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    let body = ""

    request.setEncoding("utf8")
    request.on("data", (chunk) => {
      body += chunk
      if (body.length > 1_000_000) {
        request.destroy(new Error("Export payload is too large."))
      }
    })
    request.on("end", () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error("Export payload must be valid JSON."))
      }
    })
    request.on("error", reject)
  })
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode
  response.setHeader("Content-Type", "application/json")
  response.end(JSON.stringify(body))
}

export function capiExportMiddleware(root: string, options: PlanExportOptions = {}) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!request.url?.startsWith(EXPORT_ROUTE)) {
      next()
      return
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Use POST /export." })
      return
    }

    try {
      const body = await readJsonBody(request)
      if (!isExportPayload(body)) {
        sendJson(response, 400, { error: "Invalid export payload." })
        return
      }

      const exportResult = await exportPresentation(root, body, options)
      sendJson(response, 200, exportResult)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed."
      sendJson(response, 500, { error: message })
    }
  }
}
