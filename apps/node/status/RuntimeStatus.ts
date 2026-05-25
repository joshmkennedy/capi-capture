import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

export type RuntimeStatusState = "idle" | "starting" | "recording" | "stopping" | "error"

export type RuntimeStatus = {
  state: RuntimeStatusState
  sessionId: string | null
  message: string
  updatedAt: string
}

const statusPath = process.env.CAPI_STATUS_FILE ?? "/tmp/capi/status.json"

export async function writeRuntimeStatus(status: Omit<RuntimeStatus, "updatedAt">) {
  await mkdir(path.dirname(statusPath), { recursive: true })
  await writeFile(statusPath, `${JSON.stringify({
    ...status,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`)
}
