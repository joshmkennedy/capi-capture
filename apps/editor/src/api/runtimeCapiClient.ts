import type {
  CaptureOptions,
  CaptureSettings,
  CaptureStatus,
  CreateSessionResponse,
  CurrentSessionResponse,
  DeleteSessionResponse,
  ExportPayload,
  ExportResult,
  SessionEditorState,
  SessionsResponse,
  Source,
  StopCaptureResponse,
} from "../../../node/shared/types"
import type { CapiClient } from "./capiClientTypes"
import { deleteJson, getJson, postJson, putJson } from "./http"

type CaptureSettingsResponse = {
  settings: CaptureSettings | null
}

export const runtimeCapiClient: CapiClient = {
  async listSessions() {
    return getJson<SessionsResponse>("/sessions", "Could not load sessions.")
  },

  async createSession() {
    return postJson<CreateSessionResponse>("/sessions", null, "Could not create session.")
  },

  async openSession(sessionId) {
    return postJson<CreateSessionResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/open`,
      null,
      "Could not open session.",
    )
  },

  async deleteSession(sessionId) {
    return deleteJson<DeleteSessionResponse>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      "Could not delete session.",
    )
  },

  async getCurrentSession() {
    return getJson<CurrentSessionResponse>("/session", "Could not load the active session.")
  },

  async getSessionEditorState(sessionId) {
    const url = sessionId
      ? `/sessions/${encodeURIComponent(sessionId)}/editor-state`
      : "/session/editor-state"
    return getJson<SessionEditorState>(url, "Could not load session editor state.")
  },

  async saveSessionEditorState(state, sessionId) {
    const url = sessionId
      ? `/sessions/${encodeURIComponent(sessionId)}/editor-state`
      : "/session/editor-state"
    return putJson<SessionEditorState>(
      url,
      { state },
      "Could not save session editor state.",
    )
  },

  async listSources(sessionId) {
    const url = sessionId ? `/sessions/${encodeURIComponent(sessionId)}/sources` : "/sources"
    return getJson<Source[]>(url, "Could not load sources.")
  },

  async listCaptureOptions() {
    return getJson<CaptureOptions>("/capture-options", "Could not load capture options.")
  },

  async getCaptureSettings() {
    const response = await getJson<CaptureSettingsResponse>(
      "/capture-settings",
      "Could not load capture settings.",
    )
    return response.settings
  },

  async saveCaptureSettings(settings: CaptureSettings) {
    const response = await putJson<CaptureSettingsResponse>(
      "/capture-settings",
      { settings },
      "Could not save capture settings.",
    )
    if (!response.settings) {
      throw new Error("Could not save capture settings.")
    }

    return response.settings
  },

  async getCaptureStatus() {
    return getJson<CaptureStatus>("/captures", "Could not load capture status.")
  },

  async startCapture(settings: CaptureSettings) {
    return postJson<Source>("/captures", { settings }, "Capture failed.")
  },

  async stopCapture() {
    return deleteJson<StopCaptureResponse>("/captures", "Could not stop capture.")
  },

  async exportPresentation(payload: ExportPayload): Promise<ExportResult> {
    return postJson<ExportResult>("/export", payload, "Export failed.")
  },
}
