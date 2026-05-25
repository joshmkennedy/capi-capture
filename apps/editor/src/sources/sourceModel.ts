export type { Source } from "../../../node/shared/types"

export function sourceTitle(file: string) {
  return file.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")
}
