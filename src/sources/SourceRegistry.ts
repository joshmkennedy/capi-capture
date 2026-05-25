import { readdir } from "node:fs/promises"
import path from "node:path"
import type { Source } from "../shared/types"
import { probeMediaDuration } from "./MediaMetadata"

const FALLBACK_SOURCE_DURATION = 12
const SOURCE_URL_PREFIX = "/clips"

type SourceRegistryOptions = {
  sessionId?: string | null
}

export type RegisteredSource = Source & {
  filePath: string
  registeredAt: string
}

type RegisterSourceOptions = {
  duration?: number
}

function sourceTitle(file: string) {
  return file.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")
}

function sourceIdBase(file: string) {
  return file.replace(/\.[^.]+$/, "")
}

function sourceUrlPath(file: string, sessionId?: string | null) {
  if (sessionId) {
    return `/sessions/${encodeURIComponent(sessionId)}/clips/${encodeURIComponent(file)}`
  }

  return `${SOURCE_URL_PREFIX}/${encodeURIComponent(file)}`
}

function publicSource({ filePath: _filePath, registeredAt: _registeredAt, ...source }: RegisteredSource): Source {
  return source
}

export class SourceRegistry {
  private readonly sourcesById = new Map<string, RegisteredSource>()
  private readonly sourceIdsByFilePath = new Map<string, string>()
  private readonly sourceIdsByUrlPath = new Map<string, string>()

  constructor(private readonly options: SourceRegistryOptions = {}) {}

  registerSource(filePath: string, options: RegisterSourceOptions = {}) {
    const resolvedFilePath = path.resolve(filePath)
    const existingId = this.sourceIdsByFilePath.get(resolvedFilePath)
    if (existingId) {
      return this.sourcesById.get(existingId) as RegisteredSource
    }

    const file = path.basename(resolvedFilePath)
    const id = this.nextSourceId(sourceIdBase(file))
    const urlPath = sourceUrlPath(file, this.options.sessionId)
    const source: RegisteredSource = {
      id,
      title: sourceTitle(file),
      file,
      path: urlPath,
      sourcePath: urlPath,
      duration: options.duration ?? FALLBACK_SOURCE_DURATION,
      filePath: resolvedFilePath,
      registeredAt: new Date().toISOString(),
    }

    this.sourcesById.set(id, source)
    this.sourceIdsByFilePath.set(resolvedFilePath, id)
    this.sourceIdsByUrlPath.set(urlPath, id)

    return source
  }

  async registerSourceWithMetadata(filePath: string) {
    const resolvedFilePath = path.resolve(filePath)
    const existingId = this.sourceIdsByFilePath.get(resolvedFilePath)
    if (existingId) {
      return this.sourcesById.get(existingId) as RegisteredSource
    }

    const duration = await probeMediaDuration(filePath)
    return this.registerSource(filePath, duration ? { duration } : {})
  }

  async registerSourcesInDirectory(directory: string) {
    const files = await readdir(directory).catch(() => [])

    for (const file of files
      .filter((file) => file.toLowerCase().endsWith(".mov"))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))) {
      await this.registerSourceWithMetadata(path.join(directory, file))
    }
  }

  listSources(): Source[] {
    return [...this.sourcesById.values()]
      .sort((left, right) => left.registeredAt.localeCompare(right.registeredAt))
      .map(publicSource)
  }

  sourceForEditor(source: RegisteredSource): Source {
    return publicSource(source)
  }

  sourceForUrlPath(urlPath: string) {
    const id = this.sourceIdsByUrlPath.get(urlPath)
    return id ? this.sourcesById.get(id) ?? null : null
  }

  updateDuration(id: string, duration: number) {
    const source = this.sourcesById.get(id)
    if (!source) {
      throw new Error(`Source not found for ${id}.`)
    }

    source.duration = duration
    return source
  }

  private nextSourceId(baseId: string) {
    if (!this.sourcesById.has(baseId)) {
      return baseId
    }

    let suffix = 2
    while (this.sourcesById.has(`${baseId}-${suffix}`)) {
      suffix += 1
    }

    return `${baseId}-${suffix}`
  }
}
