import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isCaptureSettings } from "../shared/schemas"
import type { CaptureSettings } from "../shared/types"

function configRoot() {
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config")
}

function configDir() {
  return path.join(configRoot(), "capi-capture")
}

function settingsPath() {
  return path.join(configDir(), "capture-settings.json")
}

function migrateCaptureSettings(value: unknown): CaptureSettings | null {
  if (isCaptureSettings(value)) {
    return value
  }

  if (!value || typeof value !== "object") {
    return null
  }

  const legacy = value as {
    target?: unknown
    microphone?: unknown
    showClicks?: unknown
  }

  if (
    legacy.target === "full-desktop" &&
    typeof legacy.microphone === "boolean" &&
    typeof legacy.showClicks === "boolean"
  ) {
    return {
      target: "display",
      displayId: 1,
      microphone: legacy.microphone,
      showClicks: legacy.showClicks,
    }
  }

  return null
}

export async function readCaptureSettings() {
  const rawSettings = await readFile(settingsPath(), "utf8").catch(() => null)
  if (!rawSettings) {
    return null
  }

  const settings = migrateCaptureSettings(JSON.parse(rawSettings) as unknown)
  if (settings) {
    await writeCaptureSettings(settings)
  }

  return settings
}

export async function writeCaptureSettings(settings: CaptureSettings) {
  await mkdir(configDir(), { recursive: true })
  await writeFile(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`)
}
