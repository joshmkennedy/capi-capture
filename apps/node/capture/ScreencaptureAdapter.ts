import { spawn } from "node:child_process"
import { rm, stat } from "node:fs/promises"
import type { CaptureSettings } from "../shared/types"

export type CaptureResult = {
  filePath: string
}

export type ActiveCapture = {
  result: Promise<CaptureResult>
  stop: () => void
}

function screencaptureArgs(outputPath: string, settings: CaptureSettings) {
  const args = ["-x", "-v", "-D", String(settings.displayId)]

  if (settings.microphone) {
    args.push("-g")
  }

  if (settings.showClicks) {
    args.push("-k")
  }

  args.push(outputPath)
  return args
}

export function startScreenCapture(
  outputPath: string,
  settings: CaptureSettings,
): ActiveCapture {
  const child = spawn("screencapture", screencaptureArgs(outputPath, settings), {
    stdio: ["pipe", "ignore", "pipe"],
  })
  let stderr = ""

  const result = new Promise<CaptureResult>((resolve, reject) => {
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", async (code) => {
      try {
        const outputStat = await stat(outputPath).catch(() => null)
        if (outputStat?.isFile() && outputStat.size > 0) {
          resolve({ filePath: outputPath })
          return
        }

        if (code !== 0) {
          throw new Error(stderr.trim() || `screencapture exited with code ${code}.`)
        } else {
          throw new Error("Capture did not create a playable source.")
        }
      } catch (error) {
        await rm(outputPath, { force: true }).catch(() => undefined)
        reject(error)
      }
    })
  })

  return {
    result,
    stop() {
      if (child.stdin.writable) {
        child.stdin.end("q")
        return
      }

      child.kill("SIGINT")
    },
  }
}
