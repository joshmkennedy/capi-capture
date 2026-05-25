import { spawn } from "node:child_process"
import type { CaptureDisplay, CaptureOptions } from "../shared/types"

type SystemProfilerDisplay = {
  _name?: string
  "_spdisplays_display-product-name"?: string
  "_spdisplays_display-resolution"?: string
  spdisplays_main?: string
}

type SystemProfilerGpu = {
  spdisplays_ndrvs?: SystemProfilerDisplay[]
}

type SystemProfilerDisplays = {
  SPDisplaysDataType?: SystemProfilerGpu[]
}

function systemProfilerDisplays() {
  return new Promise<SystemProfilerDisplays>((resolve, reject) => {
    const child = spawn("system_profiler", ["SPDisplaysDataType", "-json"], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve(JSON.parse(stdout) as SystemProfilerDisplays)
        return
      }

      reject(new Error(stderr.trim() || `system_profiler exited with code ${code}.`))
    })
  })
}

function displayName(display: SystemProfilerDisplay, index: number) {
  const baseName = display["_spdisplays_display-product-name"] ?? display._name ?? `Display ${index}`
  const resolution = display["_spdisplays_display-resolution"]
  const main = display.spdisplays_main === "spdisplays_yes" ? "Main" : null
  const details = [main, resolution].filter(Boolean)

  return details.length > 0 ? `${baseName} (${details.join(", ")})` : baseName
}

export async function captureOptions(): Promise<CaptureOptions> {
  if (process.platform !== "darwin") {
    return { displays: [] }
  }

  const profile = await systemProfilerDisplays()
  const displays = (profile.SPDisplaysDataType ?? [])
    .flatMap((gpu) => gpu.spdisplays_ndrvs ?? [])
    .map<CaptureDisplay>((display, index) => ({
      id: index + 1,
      name: displayName(display, index + 1),
    }))

  return {
    displays: displays.length > 0 ? displays : [{ id: 1, name: "Display 1" }],
  }
}
