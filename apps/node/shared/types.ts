export type Source = {
  id: string
  title: string
  file: string
  path: string
  sourcePath: string
  duration: number
}

export type Clip = {
  id: string
  sourceId: string
  sourceStart: number
  sourceEnd: number
  timelineStart: number
  timelineDuration: number
  color: string
}

export type SessionEditorState = {
  clips: Clip[]
}

export type SessionSummary = {
  id: string
  sessionDir: string
  sourceDir: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export type SessionsResponse = {
  sessions: SessionSummary[]
  activeSessionId: string | null
  lastSessionId: string | null
}

export type CurrentSessionResponse = {
  session: SessionSummary | null
}

export type CreateSessionResponse = {
  session: SessionSummary
  url: string
}

export type DeleteSessionResponse = {
  sessionId: string
}

export type DeleteSourceResponse = {
  sourceId: string
}

export type CaptureSettings = {
  target: "display"
  displayId: number
  microphone: boolean
  showClicks: boolean
}

export type CaptureDisplay = {
  id: number
  name: string
}

export type CaptureOptions = {
  displays: CaptureDisplay[]
}

export type CaptureStatus = {
  status: "idle" | "capturing"
}

export type StopCaptureResponse = {
  status: "stopping" | "stopped"
  sessionId: string | null
  url: string | null
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
