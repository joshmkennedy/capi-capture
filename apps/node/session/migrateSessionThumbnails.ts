import { existsSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createMediaStill } from "../sources/MediaMetadata"
import { SessionStore } from "./SessionStore"

const capiRoot = path.join(os.tmpdir(), "capi")
const runtimeDatabasePath = path.join(capiRoot, "capi.sqlite")
const thumbnailFile = "session-still.jpg"

async function firstSourcePath(sourceDir: string) {
  const files = await readdir(sourceDir).catch(() => [])
  const file = files
    .filter((candidate) => candidate.toLowerCase().endsWith(".mov"))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0]

  return file ? path.join(sourceDir, file) : null
}

async function migrateSessionThumbnails() {
  const store = new SessionStore(runtimeDatabasePath)
  const sessions = store.listSessions()
  store.close()

  let created = 0
  let skippedEmpty = 0
  let skippedExisting = 0
  let failed = 0

  for (const session of sessions) {
    const thumbnailPath = path.join(session.sessionDir, thumbnailFile)
    if (existsSync(thumbnailPath)) {
      skippedExisting += 1
      continue
    }

    const sourcePath = await firstSourcePath(session.sourceDir)
    if (!sourcePath) {
      skippedEmpty += 1
      continue
    }

    const ok = await createMediaStill(sourcePath, thumbnailPath)
    const thumbnailStat = await stat(thumbnailPath).catch(() => null)
    if (ok && thumbnailStat?.isFile()) {
      created += 1
      console.log(`Created ${thumbnailPath}`)
    } else {
      failed += 1
      console.error(`Could not create thumbnail for session ${session.id}`)
    }
  }

  console.log(
    `Session thumbnail migration complete: ${created} created, ${skippedExisting} already existed, ${skippedEmpty} empty, ${failed} failed.`,
  )

  if (failed > 0) {
    process.exitCode = 1
  }
}

await migrateSessionThumbnails()
