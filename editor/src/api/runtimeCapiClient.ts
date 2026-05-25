import type { ExportPayload, ExportResult, Source } from "../../../src/shared/types"
import type { CapiClient } from "./capiClientTypes"
import { getJson, postJson } from "./http"

export const runtimeCapiClient: CapiClient = {
  async listSources() {
    return getJson<Source[]>("/sources", "Could not load sources.")
  },

  async startCapture() {
    return postJson<Source>("/captures", {}, "Capture failed.")
  },

  async exportPresentation(payload: ExportPayload): Promise<ExportResult> {
    return postJson<ExportResult>("/export", payload, "Export failed.")
  },
}
