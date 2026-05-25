import { sourceTitle, type Source } from "./sourceModel"

const FALLBACK_DURATIONS = [16, 22, 12, 9]

const mockSourceUrls = import.meta.glob("../../mock-sources/*.mov", {
  eager: true,
  import: "default",
  query: "?url",
}) as Record<string, string>

export function getMockSources(): Source[] {
  return Object.entries(mockSourceUrls)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([sourcePath, path], index) => {
      const file = sourcePath.split("/").pop() ?? `clip-${index + 1}.mov`

      return {
        id: `source-${index + 1}`,
        title: sourceTitle(file),
        file,
        path,
        sourcePath: sourcePath.replace("../../", "/"),
        duration: FALLBACK_DURATIONS[index] ?? 12,
      }
    })
}

