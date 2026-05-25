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

    return {
      ...clip,
      sourceStart: clamp(clip.sourceStart, 0, Math.max(0, duration - MIN_CLIP_SECONDS)),
      sourceEnd: clamp(clip.sourceEnd, MIN_CLIP_SECONDS, duration),
    }
  })

  return sequenceClips(nextClips)
}

export function moveClipBoundary(
  clips: Clip[],
  clipId: string,
  deltaSeconds: number,
  sourceDurationForClip: (clip: Clip) => number,
) {
  const nextClips = clips.map((clip) => ({ ...clip }))
  const clipIndex = nextClips.findIndex((clip) => clip.id === clipId)
  const previousClip = nextClips[clipIndex - 1]

  if (!previousClip) return sequenceClips(nextClips)

  previousClip.sourceEnd = clamp(
    previousClip.sourceEnd + deltaSeconds,
    previousClip.sourceStart + MIN_CLIP_SECONDS,
    sourceDurationForClip(previousClip),
  )

  return sequenceClips(nextClips)
}

export function trimClipStart(
  clips: Clip[],
  clipId: string,
  deltaSeconds: number,
  sourceDurationForClip: (clip: Clip) => number,
) {
  const nextClips = clips.map((clip) => ({ ...clip }))
  const clipIndex = nextClips.findIndex((clip) => clip.id === clipId)
  const clip = nextClips[clipIndex]
  const previousClip = nextClips[clipIndex - 1]

  if (!clip) return sequenceClips(nextClips)

  const minDelta = Math.max(
    0 - clip.sourceStart,
    previousClip
      ? previousClip.sourceStart + MIN_CLIP_SECONDS - previousClip.sourceEnd
      : Number.NEGATIVE_INFINITY,
  )
  const maxDelta = Math.min(
    clip.sourceEnd - MIN_CLIP_SECONDS - clip.sourceStart,
    previousClip ? sourceDurationForClip(previousClip) - previousClip.sourceEnd : Number.POSITIVE_INFINITY,
  )
  const actualDelta = clamp(deltaSeconds, minDelta, maxDelta)

  clip.sourceStart += actualDelta

  if (previousClip) {
    previousClip.sourceEnd += actualDelta
  }

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

  clip.sourceEnd = clamp(
    clip.sourceEnd + deltaSeconds,
    clip.sourceStart + MIN_CLIP_SECONDS,
    sourceDurationForClip(clip),
  )

  return sequenceClips(nextClips)
}
