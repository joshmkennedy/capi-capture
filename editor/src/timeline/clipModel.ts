import type { Source } from "../sources/sourceModel"

export type Clip = {
  id: string
  sourceId: string
  sourceStart: number
  sourceEnd: number
  timelineStart: number
  color: string
}

export type ClipWithSource = Clip & {
  source: Source
}

export function clipLength(clip: Pick<Clip, "sourceStart" | "sourceEnd">) {
  return clip.sourceEnd - clip.sourceStart
}

export function timelineEnd(clip: Pick<Clip, "sourceStart" | "sourceEnd" | "timelineStart">) {
  return clip.timelineStart + clipLength(clip)
}

