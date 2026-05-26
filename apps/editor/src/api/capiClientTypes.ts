import type {
  CaptureOptions,
  CaptureSettings,
  CaptureStatus,
  CreateSessionResponse,
  CurrentSessionResponse,
  DeleteSessionResponse,
  DeleteSourceResponse,
  ExportPayload,
  ExportResult,
  SessionEditorState,
  SessionsResponse,
  Source,
  StopCaptureResponse,
} from "../../../node/shared/types"

export type CapiClient = {
  listSessions(): Promise<SessionsResponse>
  createSession(): Promise<CreateSessionResponse>
  openSession(sessionId: string): Promise<CreateSessionResponse>
  deleteSession(sessionId: string): Promise<DeleteSessionResponse>
  deleteSource(sourceId: string, sessionId?: string | null): Promise<DeleteSourceResponse>
  getCurrentSession(): Promise<CurrentSessionResponse>
  getSessionEditorState(sessionId?: string | null): Promise<SessionEditorState>
  saveSessionEditorState(state: SessionEditorState, sessionId?: string | null): Promise<SessionEditorState>
  listSources(sessionId?: string | null): Promise<Source[]>
  listCaptureOptions(): Promise<CaptureOptions>
  getCaptureSettings(): Promise<CaptureSettings | null>
  saveCaptureSettings(settings: CaptureSettings): Promise<CaptureSettings>
  getCaptureStatus(): Promise<CaptureStatus>
  startCapture(settings: CaptureSettings): Promise<Source>
  stopCapture(): Promise<StopCaptureResponse>
  exportPresentation(payload: ExportPayload): Promise<ExportResult>
}
