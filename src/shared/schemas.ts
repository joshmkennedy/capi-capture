import type { ExportPayload } from "./types"

export const MIN_EXPORT_SECONDS = 0.05

export function isExportPayload(value: unknown): value is ExportPayload {
  if (!value || typeof value !== "object" || !Array.isArray((value as ExportPayload).clips)) {
    return false
  }

  return (value as ExportPayload).clips.every((clip) => {
    const duration = clip.sourceEnd - clip.sourceStart

    return (
      typeof clip.file === "string" &&
      clip.file.length > 0 &&
      (clip.sourcePath === undefined || typeof clip.sourcePath === "string") &&
      Number.isFinite(clip.sourceStart) &&
      Number.isFinite(clip.sourceEnd) &&
      Number.isFinite(clip.timelineStart) &&
      clip.sourceStart >= 0 &&
      duration >= MIN_EXPORT_SECONDS
    )
  })
}

