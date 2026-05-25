import type {
  CaptureOptions,
  CaptureSettings,
  CreateSessionResponse,
  CurrentSessionResponse,
  DeleteSessionResponse,
  ExportPayload,
  ExportResult,
  SessionEditorState,
  SessionsResponse,
  Source,
} from "../../../node/shared/types"

export type CapiClient = {
  listSessions(): Promise<SessionsResponse>
  createSession(): Promise<CreateSessionResponse>
  openSession(sessionId: string): Promise<CreateSessionResponse>
  deleteSession(sessionId: string): Promise<DeleteSessionResponse>
  getCurrentSession(): Promise<CurrentSessionResponse>
  getSessionEditorState(sessionId?: string | null): Promise<SessionEditorState>
  saveSessionEditorState(state: SessionEditorState, sessionId?: string | null): Promise<SessionEditorState>
  listSources(): Promise<Source[]>
  listCaptureOptions(): Promise<CaptureOptions>
  getCaptureSettings(): Promise<CaptureSettings | null>
  saveCaptureSettings(settings: CaptureSettings): Promise<CaptureSettings>
  startCapture(settings: CaptureSettings): Promise<Source>
  stopCapture(): Promise<void>
  exportPresentation(payload: ExportPayload): Promise<ExportResult>
}
