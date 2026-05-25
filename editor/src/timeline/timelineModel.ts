import type { Clip } from "./clipModel"
import { clipLength, timelineEnd } from "./clipModel"

export const MIN_CLIP_SECONDS = 0.5

export type DragState = {
  clipId: string
  mode: "move" | "trim-start" | "trim-end"
  startX: number
  initialClips: Clip[]
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function seconds(value: number) {
  return `${value.toFixed(1)}s`
}

export function sortClips(clips: Clip[]) {
  return [...clips].sort((a, b) => a.timelineStart - b.timelineStart)
}

export function findClipAtTime<T extends Clip>(clips: T[], time: number) {
  return clips.find((clip) => time >= clip.timelineStart && time < timelineEnd(clip))
}

export function findNextClip<T extends Clip>(clips: T[], time: number) {
  return clips.find((clip) => clip.timelineStart >= time)
}

export function sequenceClips<T extends Clip>(clips: T[]) {
  let cursor = 0

  return clips.map((clip) => {
    const nextClip = { ...clip, timelineStart: cursor }
    cursor += clipLength(clip)
    return nextClip
  })
}

export function applyClipDuration(clips: Clip[], clipId: string, duration: number) {
  const nextClips = clips.map((clip) => {
    if (clip.id !== clipId || !Number.isFinite(duration) || duration <= 0) {
      return { ...clip }
    }

    const sourceStart = clamp(clip.sourceStart, 0, Math.max(0, duration - MIN_CLIP_SECONDS))
    const sourceEnd = clamp(
      clip.sourceEnd,
      sourceStart + MIN_CLIP_SECONDS,
      duration,
    )

    return {
      ...clip,
      sourceStart,
      sourceEnd,
      timelineDuration: sourceEnd - sourceStart,
    }
  })

  return sequenceClips(nextClips)
}

export function panClipSourceWindow(
  clips: Clip[],
  clipId: string,
  deltaSeconds: number,
  sourceDurationForClip: (clip: Clip) => number,
) {
  const nextClips = clips.map((clip) => ({ ...clip }))
  const clip = nextClips.find((item) => item.id === clipId)

  if (!clip) return sequenceClips(nextClips)

  const actualDelta = clamp(deltaSeconds, 0 - clip.sourceStart, sourceDurationForClip(clip) - clip.sourceEnd)
  clip.sourceStart += actualDelta
  clip.sourceEnd += actualDelta

  return sequenceClips(nextClips)
}

export function trimClipStart(
  clips: Clip[],
  clipId: string,
  deltaSeconds: number,
) {
  const nextClips = clips.map((clip) => ({ ...clip }))
  const clip = nextClips.find((item) => item.id === clipId)

  if (!clip) return sequenceClips(nextClips)

  const minDelta = 0 - clip.sourceStart
  const maxDelta = clip.timelineDuration - MIN_CLIP_SECONDS
  const actualDelta = clamp(deltaSeconds, minDelta, maxDelta)

  clip.sourceStart += actualDelta
  clip.timelineDuration -= actualDelta

  return sequenceClips(nextClips)
}

export function trimClipEnd(
  clips: Clip[],
  clipId: string,
  deltaSeconds: number,
  sourceDurationForClip: (clip: Clip) => number,
) {
  const nextClips = clips.map((clip) => ({ ...clip }))
  const clip = nextClips.find((item) => item.id === clipId)

  if (!clip) return sequenceClips(nextClips)

  const actualDelta = clamp(
    deltaSeconds,
    MIN_CLIP_SECONDS - clip.timelineDuration,
    sourceDurationForClip(clip) - clip.sourceEnd,
  )
  clip.sourceEnd += actualDelta
  clip.timelineDuration += actualDelta

  return sequenceClips(nextClips)
}
