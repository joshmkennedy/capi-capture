import { type ChildProcess, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { unlinkSync } from "node:fs"
import { mkdir, open, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { SessionStore, type StoredSession } from "./SessionStore"

type OpenCommand = {
  command: string
  args: string[]
}

export type RuntimeLock = {
  pid: number
  sessionId: string | null
  sessionDir: string | null
  sourceDir: string | null
  url: string
  startedAt: string
}

export type SessionRuntime = {
  readonly sessionId: string | null
  readonly sessionDir: string | null
  readonly sourceDir: string | null
  readonly url: string
  stop(): Promise<void>
}

export type StartSessionOptions = {
  sessionId?: string
  lastSession?: boolean
  grid?: boolean
}

export class SessionAlreadyRunningError extends Error {
  constructor(readonly lock: Partial<RuntimeLock>) {
    super("Capi is already running.")
    this.name = "SessionAlreadyRunningError"
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Capi session ${sessionId} was not found.`)
    this.name = "SessionNotFoundError"
  }
}

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))
const editorRoot = path.join(repoRoot, "editor")
const runtimePort = 5173
const runtimeUrl = `http://127.0.0.1:${runtimePort}/`
const capiRoot = path.join(os.tmpdir(), "capi")
const sessionsRoot = path.join(capiRoot, "sessions")
const runtimeDatabasePath = path.join(capiRoot, "capi.sqlite")
const runtimeLockFile = path.join(capiRoot, "runtime.lock")
const appBasePath = "/app"
const gridViewUrl = new URL(`${appBasePath}/sessions`, runtimeUrl).toString()

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

function viewUrlForSession(sessionId: string, baseUrl = runtimeUrl) {
  const url = new URL(`${appBasePath}/sessions/${encodeURIComponent(sessionId)}`, baseUrl)
  return url.toString()
}

async function liveRuntimeLock() {
  const lock = await readRuntimeLock()
  if (typeof lock?.pid === "number" && isProcessRunning(lock.pid)) {
    return lock
  }

  return null
}

async function acquireRuntimeLock(session: StoredSession | null) {
  await mkdir(capiRoot, { recursive: true })

  while (true) {
    try {
      const handle = await open(runtimeLockFile, "wx")
      const lock: RuntimeLock = {
        pid: process.pid,
        sessionId: session?.id ?? null,
        sessionDir: session?.sessionDir ?? null,
        sourceDir: session?.sourceDir ?? null,
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

      const lock = await liveRuntimeLock()
      if (lock) {
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
  readonly sessionId: string | null
  readonly sessionDir: string | null
  readonly sourceDir: string | null
  readonly url: string

  private readonly sessionStore: SessionStore
  private editorProcess: ChildProcess | null = null
  private editorStdoutBuffer = ""
  private editorStderrBuffer = ""
  private browserOpened = false
  private lockOwned = false
  private stopping = false

  constructor(private readonly session: StoredSession | null, sessionStore: SessionStore, url: string, private readonly initialViewUrl: string) {
    this.sessionId = session?.id ?? null
    this.sessionDir = session?.sessionDir ?? null
    this.sourceDir = session?.sourceDir ?? null
    this.sessionStore = sessionStore
    this.url = url
  }

  async start() {
    this.lockOwned = await acquireRuntimeLock(this.session)
    if (!this.lockOwned) {
      throw new SessionAlreadyRunningError((await liveRuntimeLock()) ?? {})
    }

    if (this.session) {
      await mkdir(this.session.sessionDir, { recursive: true })
      await mkdir(this.session.sourceDir, { recursive: true })
      this.sessionStore.markSessionOpened(this.session.id)

      console.log(`Capi session ${this.session.id}`)
      console.log(`Session directory ${this.session.sessionDir}`)
      console.log(`Source directory ${this.session.sourceDir}`)
    } else {
      console.log("Capi grid")
    }

    this.startEditorServer()
  }

  async stop() {
    if (this.stopping) {
      return
    }

    this.stopping = true
    await killProcessGroup(this.editorProcess)
    if (this.lockOwned) {
      await rm(runtimeLockFile, { force: true })
      this.lockOwned = false
    }
    this.sessionStore.close()
  }

  cleanupSync() {
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
        CAPI_SESSION_ID: this.session?.id,
        CAPI_SESSION_DIR: this.session?.sessionDir,
        CAPI_SOURCE_DIR: this.session?.sourceDir,
        CAPI_CAPTURE_DIR: this.session?.sourceDir,
        CAPI_DATABASE_PATH: runtimeDatabasePath,
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
            console.log(`Editor available at ${this.initialViewUrl}`)
          } else {
            console.log(`Opening ${this.initialViewUrl}`)
            openBrowser(this.initialViewUrl)
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

function createStoredSession(sessionStore: SessionStore) {
  const sessionId = randomUUID()
  const sessionDir = path.join(sessionsRoot, sessionId)
  const sourceDir = path.join(sessionDir, "sources")

  return sessionStore.createSession({ id: sessionId, sessionDir, sourceDir })
}

function resolveStartupSession(sessionStore: SessionStore, options: StartSessionOptions) {
  if (options.grid) {
    return { session: null, created: false }
  }

  if (options.sessionId) {
    const session = sessionStore.sessionById(options.sessionId)
    if (!session) {
      throw new SessionNotFoundError(options.sessionId)
    }

    return { session, created: false }
  }

  if (options.lastSession) {
    const lastSessionId = sessionStore.lastSessionId()
    if (!lastSessionId) {
      throw new SessionNotFoundError("last")
    }

    const session = sessionStore.sessionById(lastSessionId)
    if (!session) {
      throw new SessionNotFoundError(lastSessionId)
    }

    return { session, created: false }
  }

  return { session: createStoredSession(sessionStore), created: true }
}

type RemoteSessionResponse = {
  session: StoredSession
  url?: string
}

async function createSessionInRunningRuntime(lock: Partial<RuntimeLock>) {
  const baseUrl = lock.url ?? runtimeUrl
  const response = await fetch(new URL("/sessions", baseUrl), { method: "POST" })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `Could not create session in running Capi runtime: ${response.status}.`)
  }

  return await response.json() as RemoteSessionResponse
}

async function delegateToRunningRuntime(lock: Partial<RuntimeLock>, options: StartSessionOptions) {
  if (options.grid) {
    const url = new URL("/app/sessions", lock.url ?? runtimeUrl).toString()
    if (process.env.CAPI_NO_OPEN === "1") {
      console.log(`Editor available at ${url}`)
    } else {
      console.log(`Opening ${url}`)
      openBrowser(url)
    }
    return
  }

  const result = await createSessionInRunningRuntime(lock)
  const url = new URL(result.url ?? viewUrlForSession(result.session.id, lock.url ?? runtimeUrl), lock.url ?? runtimeUrl).toString()
  console.log(`Capi session ${result.session.id}`)
  console.log(`Session directory ${result.session.sessionDir}`)
  console.log(`Source directory ${result.session.sourceDir}`)
  if (process.env.CAPI_NO_OPEN === "1") {
    console.log(`Editor available at ${url}`)
  } else {
    console.log(`Opening ${url}`)
    openBrowser(url)
  }
}

export async function startSession(options: StartSessionOptions = {}): Promise<SessionRuntime | null> {
  const lock = await liveRuntimeLock()
  if (lock) {
    await delegateToRunningRuntime(lock, options)
    return null
  }

  const sessionStore = new SessionStore(runtimeDatabasePath)
  const { session, created } = resolveStartupSession(sessionStore, options)
  const initialViewUrl = session ? viewUrlForSession(session.id) : gridViewUrl
  const runtime = new RunningSessionRuntime(session, sessionStore, runtimeUrl, initialViewUrl)

  try {
    await runtime.start()
  } catch (error) {
    if (created && session) {
      sessionStore.deleteSession(session.id)
    }
    sessionStore.close()
    throw error
  }

  installShutdownHandling(runtime)

  return runtime
}
