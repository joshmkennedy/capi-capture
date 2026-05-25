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

  async getCurrentSession() {
    return getJson<CurrentSessionResponse>("/session", "Could not load the active session.")
  },

  async getSessionEditorState() {
    return getJson<SessionEditorState>("/session/editor-state", "Could not load session editor state.")
  },

  async saveSessionEditorState(state) {
    return putJson<SessionEditorState>(
      "/session/editor-state",
      { state },
      "Could not save session editor state.",
    )
  },

  async listSources() {
    return getJson<Source[]>("/sources", "Could not load sources.")
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

  async startCapture(settings: CaptureSettings) {
    return postJson<Source>("/captures", { settings }, "Capture failed.")
  },

  async stopCapture() {
    await deleteJson("/captures", "Could not stop capture.")
  },

  async exportPresentation(payload: ExportPayload): Promise<ExportResult> {
    return postJson<ExportResult>("/export", payload, "Export failed.")
  },
}
