import type { Source } from "../sources/sourceModel"

export type Clip = {
  id: string
  sourceId: string
  sourceStart: number
  sourceEnd: number
  timelineStart: number
  timelineDuration: number
  color: string
}

export type ClipWithSource = Clip & {
  source: Source
}

export function sourceWindowLength(clip: Pick<Clip, "sourceStart" | "sourceEnd">) {
  return clip.sourceEnd - clip.sourceStart
}

export function clipLength(clip: Pick<Clip, "timelineDuration">) {
  return clip.timelineDuration
}

export function timelineEnd(clip: Pick<Clip, "timelineDuration" | "timelineStart">) {
  return clip.timelineStart + clipLength(clip)
}
