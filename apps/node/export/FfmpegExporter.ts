import { spawn } from "node:child_process"
import path from "node:path"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import { planExport, type PlanExportOptions } from "./ExportPlanner"
import type { ExportPayload, ExportResult } from "../shared/types"

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] })
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

      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}.`))
    })
  })
}

function concatFileLine(filePath: string) {
  return `file '${filePath.replaceAll("'", "'\\''")}'`
}

export async function exportPresentation(
  root: string,
  payload: ExportPayload,
  options: PlanExportOptions = {},
): Promise<ExportResult> {
  const exportPlan = planExport(root, payload, options)
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "capi-export-"))

  try {
    const trimmedPaths: string[] = []

    for (const [index, clip] of exportPlan.clips.entries()) {
      const trimmedPath = path.join(tempDir, `clip-${index}.mp4`)

      await runFfmpeg([
        "-y",
        "-ss",
        clip.sourceStart.toFixed(3),
        "-i",
        clip.resolvedSourcePath,
        "-t",
        clip.duration.toFixed(3),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30,setsar=1,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        trimmedPath,
      ])

      trimmedPaths.push(trimmedPath)
    }

    const concatListPath = path.join(tempDir, "concat.txt")
    const concatList = trimmedPaths.map(concatFileLine).join("\n")

    await writeFile(concatListPath, `${concatList}\n`, "utf8")
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-c",
      "copy",
      exportPlan.outputPath,
    ])

    return {
      fileName: exportPlan.outputName,
      outputPath: exportPlan.outputPath,
      clipCount: exportPlan.clips.length,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
