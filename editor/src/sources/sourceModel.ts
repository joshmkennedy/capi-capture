export type { Source } from "../../../src/shared/types"

export function sourceTitle(file: string) {
  return file.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")
}
