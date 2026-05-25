import { type ChildProcess, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { rmSync, unlinkSync } from "node:fs"
import { mkdir, open, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

type OpenCommand = {
  command: string
  args: string[]
}

type RuntimeLock = {
  pid: number
  sessionId: string
  sessionDir: string
  url: string
  startedAt: string
}

export type SessionRuntime = {
  readonly sessionId: string
  readonly sessionDir: string
  readonly url: string
  stop(): Promise<void>
}

export class SessionAlreadyRunningError extends Error {
  constructor() {
    super("Capi is already running.")
    this.name = "SessionAlreadyRunningError"
  }
}

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))
const editorRoot = path.join(repoRoot, "editor")
const runtimePort = 5173
const runtimeUrl = `http://127.0.0.1:${runtimePort}/`
const capiRoot = path.join(os.tmpdir(), "capi")
const runtimeLockFile = path.join(capiRoot, "runtime.lock")

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm"
}

function openCommandFor(url: string): OpenCommand {
  if (process.platform === "darwin") {
    return { command: "open", args: [url] }
  }

  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] }
  }

  return { command: "xdg-open", args: [url] }
}

function stripAnsi(text: string) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
}

function writePrefixedLines(prefix: string, lines: string[], stream: NodeJS.WritableStream) {
  for (const line of lines) {
    if (line.length > 0) {
      stream.write(`${prefix}${line}\n`)
    }
  }
}

function editorUrlFromOutput(output: string) {
  const match = stripAnsi(output).match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/?/i)
  return match?.[0] ?? null
}

function consumeCompleteLines(buffer: string, data: Buffer) {
  buffer += data.toString()
  const lines = buffer.split(/\r?\n/)
  const remainder = lines.pop() ?? ""

  return { lines, remainder }
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function readRuntimeLock() {
  try {
    return JSON.parse(await readFile(runtimeLockFile, "utf8")) as Partial<RuntimeLock>
  } catch {
    return null
  }
}

async function acquireRuntimeLock(sessionId: string, sessionDir: string) {
  await mkdir(capiRoot, { recursive: true })

  while (true) {
    try {
      const handle = await open(runtimeLockFile, "wx")
      const lock: RuntimeLock = {
        pid: process.pid,
        sessionId,
        sessionDir,
        url: runtimeUrl,
        startedAt: new Date().toISOString(),
      }

      try {
        await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`)
      } finally {
        await handle.close()
      }
      return true
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error
      }

      const lock = await readRuntimeLock()
      if (typeof lock?.pid === "number" && isProcessRunning(lock.pid)) {
        console.error("Capi is already running.")
        console.error(`Open ${lock.url ?? runtimeUrl} or stop the existing session first.`)
        console.error(`Existing session: ${lock.sessionId ?? "unknown"} (pid ${lock.pid})`)
        return false
      }

      await rm(runtimeLockFile, { force: true })
    }
  }
}

function openBrowser(url: string) {
  const opener = openCommandFor(url)
  const child = spawn(opener.command, opener.args, {
    detached: true,
    stdio: "ignore",
  })

  child.on("error", () => {
    console.warn(`Could not open the browser automatically. Open ${url} manually.`)
  })
  child.unref()
}

async function killProcessGroup(child: ChildProcess | null) {
  if (!child || child.killed || child.pid === undefined) {
    return
  }

  const pid = child.pid

  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM")
    } else {
      process.kill(-pid, "SIGTERM")
    }
  } catch {
    return
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try {
        if (process.platform === "win32") {
          child.kill("SIGKILL")
        } else {
          process.kill(-pid, "SIGKILL")
        }
      } catch {
        // The process may have already exited.
      }
      resolve()
    }, 5000)

    child.once("close", () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

class RunningSessionRuntime implements SessionRuntime {
  readonly sessionId: string
  readonly sessionDir: string
  readonly url: string

  private editorProcess: ChildProcess | null = null
  private editorStdoutBuffer = ""
  private editorStderrBuffer = ""
  private browserOpened = false
  private lockOwned = false
  private stopping = false

  constructor(sessionId: string, sessionDir: string, url: string) {
    this.sessionId = sessionId
    this.sessionDir = sessionDir
    this.url = url
  }

  async start() {
    this.lockOwned = await acquireRuntimeLock(this.sessionId, this.sessionDir)
    if (!this.lockOwned) {
      throw new SessionAlreadyRunningError()
    }

    await mkdir(this.sessionDir, { recursive: true })

    console.log(`Capi session ${this.sessionId}`)
    console.log(`Session directory ${this.sessionDir}`)

    this.startEditorServer()
  }

  async stop() {
    if (this.stopping) {
      return
    }

    this.stopping = true
    await killProcessGroup(this.editorProcess)
    await rm(this.sessionDir, { recursive: true, force: true })
    if (this.lockOwned) {
      await rm(runtimeLockFile, { force: true })
      this.lockOwned = false
    }
  }

  cleanupSync() {
    rmSync(this.sessionDir, { recursive: true, force: true })
    if (this.lockOwned) {
      try {
        unlinkSync(runtimeLockFile)
      } catch {
        // The async shutdown path may have already removed it.
      }
    }
  }

  private startEditorServer() {
    const child = spawn(npmCommand(), [
      "run",
      "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(runtimePort),
      "--strictPort",
    ], {
      cwd: editorRoot,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        CAPI_SESSION_ID: this.sessionId,
        CAPI_CAPTURE_DIR: this.sessionDir,
        VITE_CAPI_RUNTIME: "1",
        FORCE_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    this.editorProcess = child

    child.stdout.on("data", (data: Buffer) => {
      const output = consumeCompleteLines(this.editorStdoutBuffer, data)
      this.editorStdoutBuffer = output.remainder
      writePrefixedLines("[editor] ", output.lines, process.stdout)

      if (!this.browserOpened) {
        const url = editorUrlFromOutput(output.lines.join("\n"))
        if (url) {
          this.browserOpened = true
          if (process.env.CAPI_NO_OPEN === "1") {
            console.log(`Editor available at ${url}`)
          } else {
            console.log(`Opening ${url}`)
            openBrowser(url)
          }
        }
      }
    })

    child.stderr.on("data", (data: Buffer) => {
      const output = consumeCompleteLines(this.editorStderrBuffer, data)
      this.editorStderrBuffer = output.remainder
      writePrefixedLines("[editor] ", output.lines, process.stderr)
    })

    child.on("error", async (error) => {
      console.error(`Failed to start the editor server: ${error.message}`)
      await stopRuntimeAndExit(this, 1)
    })

    child.on("close", async (code, signal) => {
      if (this.stopping) {
        return
      }

      const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`
      console.error(`Editor server stopped with ${reason}.`)
      await stopRuntimeAndExit(this, code ?? 1)
    })
  }
}

async function stopRuntimeAndExit(runtime: RunningSessionRuntime, exitCode: number) {
  await runtime.stop()
  process.exit(exitCode)
}

function installShutdownHandling(runtime: RunningSessionRuntime) {
  process.on("SIGINT", () => {
    void stopRuntimeAndExit(runtime, 0)
  })

  process.on("SIGTERM", () => {
    void stopRuntimeAndExit(runtime, 0)
  })

  process.on("uncaughtException", async (error) => {
    console.error(error)
    await stopRuntimeAndExit(runtime, 1)
  })

  process.on("unhandledRejection", async (reason) => {
    console.error(reason)
    await stopRuntimeAndExit(runtime, 1)
  })

  process.on("exit", () => {
    runtime.cleanupSync()
  })
}

export async function startSession(): Promise<SessionRuntime> {
  const sessionId = randomUUID()
  const sessionDir = path.join(capiRoot, sessionId)
  const runtime = new RunningSessionRuntime(sessionId, sessionDir, runtimeUrl)

  await runtime.start()
  installShutdownHandling(runtime)

  return runtime
}
