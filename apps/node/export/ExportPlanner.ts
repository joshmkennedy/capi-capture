import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { ExportClip, ExportPayload } from "../shared/types"

export type PlannedExportClip = ExportClip & {
  resolvedSourcePath: string
  duration: number
}

export type ExportPlan = {
  clips: PlannedExportClip[]
  outputName: string
  outputPath: string
}

export type ExportSourceResolver = (clip: ExportClip) => string | null | undefined

export type PlanExportOptions = {
  resolveSourcePath?: ExportSourceResolver
}

function sourceCandidates(root: string, clip: ExportClip) {
  const captureDir = process.env.CAPI_CAPTURE_DIR
  const safeFile = path.basename(clip.file)
  const candidates = [
    captureDir ? path.join(captureDir, safeFile) : null,
    path.join(root, "mock-sources", safeFile),
  ]

  if (clip.sourcePath) {
    const sourcePath = clip.sourcePath.replace(/^\/+/, "")
    candidates.unshift(path.join(root, sourcePath))
  }

  return candidates.filter((candidate): candidate is string => Boolean(candidate))
}

function resolveSourcePath(root: string, clip: ExportClip, resolver?: ExportSourceResolver) {
  const resolvedSourcePath = resolver?.(clip)
  if (resolvedSourcePath && existsSync(resolvedSourcePath)) {
    return resolvedSourcePath
  }

  const sourcePath = sourceCandidates(root, clip).find((candidate) => existsSync(candidate))

  if (!sourcePath) {
    throw new Error(`Source not found for ${clip.file}.`)
  }

  return sourcePath
}

function downloadsPath(fileName: string) {
  return path.join(os.homedir(), "Downloads", fileName)
}

function timestampForFileName() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

export function planExport(root: string, payload: ExportPayload, options: PlanExportOptions = {}): ExportPlan {
  const clips = [...payload.clips].sort((a, b) => a.timelineStart - b.timelineStart)
  if (clips.length === 0) {
    throw new Error("Export needs at least one clip.")
  }

  const outputName = `Capi Presentation ${timestampForFileName()}.mp4`

  return {
    clips: clips.map((clip) => ({
      ...clip,
      resolvedSourcePath: resolveSourcePath(root, clip, options.resolveSourcePath),
      duration: clip.sourceEnd - clip.sourceStart,
    })),
    outputName,
    outputPath: downloadsPath(outputName),
  }
}
