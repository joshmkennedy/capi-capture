export type ExportClip = {
  file: string
  sourcePath?: string
  sourceStart: number
  sourceEnd: number
  timelineStart: number
}

export type ExportPayload = {
  clips: ExportClip[]
}

export type ExportResult = {
  fileName: string
  outputPath: string
  clipCount: number
}

