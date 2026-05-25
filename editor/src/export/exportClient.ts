import type { ExportPayload, ExportResult } from "../../../src/shared/types"
import type { Source } from "../sources/sourceModel"
import type { Clip } from "../timeline/clipModel"

function roundSeconds(value: number) {
  return Number(value.toFixed(3))
}

export function createExportPayload(clips: Clip[], sourcesById: Map<string, Source>): ExportPayload {
  return {
    clips: clips.map((clip) => {
      const source = sourcesById.get(clip.sourceId)
      if (!source) {
        throw new Error(`Source not found for clip ${clip.id}.`)
      }

      return {
        file: source.file,
        sourcePath: source.sourcePath,
        sourceStart: roundSeconds(clip.sourceStart),
        sourceEnd: roundSeconds(clip.sourceEnd),
        timelineStart: roundSeconds(clip.timelineStart),
      }
    }),
  }
}

export async function exportPresentation(payload: ExportPayload): Promise<ExportResult> {
  const response = await fetch("/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const body = (await response.json().catch(() => null)) as
    | (Partial<ExportResult> & { error?: string })
    | null

  if (!response.ok) {
    throw new Error(body?.error ?? "Export failed.")
  }

  if (!body?.fileName || !body.outputPath || typeof body.clipCount !== "number") {
    throw new Error("Export response is missing output details.")
  }

  return {
    fileName: body.fileName,
    outputPath: body.outputPath,
    clipCount: body.clipCount,
  }
}

