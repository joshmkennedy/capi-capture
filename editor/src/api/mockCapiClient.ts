import { getMockSources } from "@/sources/mockSourceProvider"
import type { Source } from "@/sources/sourceModel"
import type {
  CreateSessionResponse,
  DeleteSessionResponse,
  ExportPayload,
  ExportResult,
  SessionEditorState,
} from "../../../src/shared/types"
import type { CapiClient } from "./capiClientTypes"
import { postJson } from "./http"

let mockEditorState: SessionEditorState = { clips: [] }

export const mockCapiClient: CapiClient = {
  async listSessions() {
    return { sessions: [], activeSessionId: null, lastSessionId: null }
  },

  async createSession(): Promise<CreateSessionResponse> {
    throw new Error("Sessions are only available in a Capi runtime.")
  },

  async openSession(): Promise<CreateSessionResponse> {
    throw new Error("Sessions are only available in a Capi runtime.")
  },

  async deleteSession(): Promise<DeleteSessionResponse> {
    throw new Error("Sessions are only available in a Capi runtime.")
  },

  async getCurrentSession() {
    return { session: null }
  },

  async getSessionEditorState() {
    return mockEditorState
  },

  async saveSessionEditorState(state) {
    mockEditorState = state
    return mockEditorState
  },

  async listSources() {
    return getMockSources()
  },

  async listCaptureOptions() {
    return { displays: [{ id: 1, name: "Display 1" }] }
  },

  async getCaptureSettings() {
    return null
  },

  async saveCaptureSettings(settings) {
    return settings
  },

  async startCapture(): Promise<Source> {
    throw new Error("Capture is only available in a Capi session.")
  },

  async stopCapture() {
    throw new Error("Capture is only available in a Capi session.")
  },

  async exportPresentation(payload: ExportPayload): Promise<ExportResult> {
    return postJson<ExportResult>("/export", payload, "Export failed.")
  },
}
