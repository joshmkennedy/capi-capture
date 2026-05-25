export type Source = {
  id: string
  title: string
  file: string
  path: string
  sourcePath: string
  duration: number
}

export function sourceTitle(file: string) {
  return file.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")
}

