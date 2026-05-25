import type {
  CaptureOptions,
  CaptureSettings,
  ExportPayload,
  ExportResult,
  Source,
} from "../../../src/shared/types"

export type CapiClient = {
  listSources(): Promise<Source[]>
  listCaptureOptions(): Promise<CaptureOptions>
  getCaptureSettings(): Promise<CaptureSettings | null>
  saveCaptureSettings(settings: CaptureSettings): Promise<CaptureSettings>
  startCapture(settings: CaptureSettings): Promise<Source>
  stopCapture(): Promise<void>
  exportPresentation(payload: ExportPayload): Promise<ExportResult>
}
