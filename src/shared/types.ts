export type Source = {
  id: string
  title: string
  file: string
  path: string
  sourcePath: string
  duration: number
}

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
