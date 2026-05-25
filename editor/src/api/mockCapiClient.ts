import { getMockSources } from "@/sources/mockSourceProvider"
import type { Source } from "@/sources/sourceModel"
import type { ExportPayload, ExportResult } from "../../../src/shared/types"
import type { CapiClient } from "./capiClientTypes"
import { postJson } from "./http"

export const mockCapiClient: CapiClient = {
  async listSources() {
    return getMockSources()
  },

  async startCapture(): Promise<Source> {
    throw new Error("Capture is only available in a Capi session.")
  },

  async exportPresentation(payload: ExportPayload): Promise<ExportResult> {
    return postJson<ExportResult>("/export", payload, "Export failed.")
  },
}
