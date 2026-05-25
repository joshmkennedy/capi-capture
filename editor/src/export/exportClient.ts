import type { ExportPayload } from "../../../src/shared/types"
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
