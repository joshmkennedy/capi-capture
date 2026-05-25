import { spawn } from "node:child_process"

type FfprobeFormat = {
  format?: {
    duration?: string
  }
}

export function probeMediaDuration(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      filePath,
    ], {
      stdio: ["ignore", "pipe", "ignore"],
    })
    let stdout = ""

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.on("error", () => resolve(null))
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null)
        return
      }

      try {
        const parsed = JSON.parse(stdout) as FfprobeFormat
        const duration = Number(parsed.format?.duration)
        resolve(Number.isFinite(duration) && duration > 0 ? duration : null)
      } catch {
        resolve(null)
      }
    })
  })
}
