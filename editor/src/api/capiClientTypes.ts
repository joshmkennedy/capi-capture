import type {
  CaptureOptions,
  CaptureSettings,
  CreateSessionResponse,
  CurrentSessionResponse,
  ExportPayload,
  ExportResult,
  SessionEditorState,
  SessionsResponse,
  Source,
} from "../../../src/shared/types"

export type CapiClient = {
  listSessions(): Promise<SessionsResponse>
  createSession(): Promise<CreateSessionResponse>
  getCurrentSession(): Promise<CurrentSessionResponse>
  getSessionEditorState(): Promise<SessionEditorState>
  saveSessionEditorState(state: SessionEditorState): Promise<SessionEditorState>
  listSources(): Promise<Source[]>
  listCaptureOptions(): Promise<CaptureOptions>
  getCaptureSettings(): Promise<CaptureSettings | null>
  saveCaptureSettings(settings: CaptureSettings): Promise<CaptureSettings>
  startCapture(settings: CaptureSettings): Promise<Source>
  stopCapture(): Promise<void>
  exportPresentation(payload: ExportPayload): Promise<ExportResult>
}
