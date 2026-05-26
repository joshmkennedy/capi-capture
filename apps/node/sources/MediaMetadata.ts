import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import path from "node:path"

type FfprobeFormat = {
  format?: {
    duration?: string
  }
}

export type AudioHealth = {
  hasAudio: boolean
  isSilent: boolean
  maxVolumeDb: number | null
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

export function probeAudioHealth(filePath: string, sampleSeconds = 5): Promise<AudioHealth | null> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-t",
      String(sampleSeconds),
      "-i",
      filePath,
      "-map",
      "0:a:0",
      "-vn",
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", () => resolve(null))
    child.on("close", () => {
      if (stderr.includes("matches no streams") || stderr.includes("Stream map '0:a:0'")) {
        resolve({ hasAudio: false, isSilent: false, maxVolumeDb: null })
        return
      }

      const maxVolumeMatch = stderr.match(/max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf)) dB/)
      if (!maxVolumeMatch) {
        resolve(null)
        return
      }

      const maxVolumeDb = maxVolumeMatch[1] === "-inf" ? Number.NEGATIVE_INFINITY : Number(maxVolumeMatch[1])
      if (!Number.isFinite(maxVolumeDb) && maxVolumeDb !== Number.NEGATIVE_INFINITY) {
        resolve(null)
        return
      }

      resolve({
        hasAudio: true,
        isSilent: maxVolumeDb <= -80,
        maxVolumeDb,
      })
    })
  })
}

export async function createMediaStill(filePath: string, outputPath: string): Promise<boolean> {
  await mkdir(path.dirname(outputPath), { recursive: true })

  return new Promise((resolve) => {
    const child = spawn("ffmpeg", [
      "-y",
      "-ss",
      "0.1",
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-vf",
      "scale=960:-2",
      outputPath,
    ], {
      stdio: ["ignore", "ignore", "ignore"],
    })

    child.on("error", () => resolve(false))
    child.on("close", (code) => resolve(code === 0))
  })
}
