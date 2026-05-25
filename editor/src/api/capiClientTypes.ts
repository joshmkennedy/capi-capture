import type { ExportPayload, ExportResult, Source } from "../../../src/shared/types"

export type CapiClient = {
  listSources(): Promise<Source[]>
  startCapture(): Promise<Source>
  exportPresentation(payload: ExportPayload): Promise<ExportResult>
}
