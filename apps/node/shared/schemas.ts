import type { CaptureSettings, ExportPayload, SessionEditorState } from "./types"

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

export function isCaptureSettings(value: unknown): value is CaptureSettings {
  if (!value || typeof value !== "object") {
    return false
  }

  const settings = value as CaptureSettings

  return (
    settings.target === "display" &&
    Number.isInteger(settings.displayId) &&
    settings.displayId > 0 &&
    typeof settings.microphone === "boolean" &&
    typeof settings.showClicks === "boolean"
  )
}

export function isSessionEditorState(value: unknown): value is SessionEditorState {
  if (!value || typeof value !== "object" || !Array.isArray((value as SessionEditorState).clips)) {
    return false
  }

  return (value as SessionEditorState).clips.every((clip) => (
    clip &&
    typeof clip === "object" &&
    typeof clip.id === "string" &&
    clip.id.length > 0 &&
    typeof clip.sourceId === "string" &&
    clip.sourceId.length > 0 &&
    Number.isFinite(clip.sourceStart) &&
    Number.isFinite(clip.sourceEnd) &&
    Number.isFinite(clip.timelineStart) &&
    Number.isFinite(clip.timelineDuration) &&
    clip.sourceStart >= 0 &&
    clip.sourceEnd >= clip.sourceStart &&
    clip.timelineDuration >= 0 &&
    typeof clip.color === "string"
  ))
}
