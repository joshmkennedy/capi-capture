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

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const editorRoot = path.join(repoRoot, "editor")
const runtimePort = 5173
const runtimeUrl = `http://127.0.0.1:${runtimePort}/`
const capiRoot = path.join(os.tmpdir(), "capi")
const sessionId = randomUUID()
const sessionDir = path.join(capiRoot, sessionId)
const runtimeLockFile = path.join(capiRoot, "runtime.lock")

let viteProcess: ChildProcess | null = null
let shuttingDown = false
let browserOpened = false
let editorStdoutBuffer = ""
let editorStderrBuffer = ""
let runtimeLockOwned = false

type RuntimeLock = {
  pid: number
  sessionId: string
  sessionDir: string
  url: string
  startedAt: string
}

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

async function acquireRuntimeLock() {
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
      runtimeLockOwned = true
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
  if (process.env.CAPI_NO_OPEN === "1") {
    return
  }

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

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  await killProcessGroup(viteProcess)
  await rm(sessionDir, { recursive: true, force: true })
  if (runtimeLockOwned) {
    await rm(runtimeLockFile, { force: true })
  }
  process.exit(exitCode)
}

function cleanupSessionDirSync() {
  rmSync(sessionDir, { recursive: true, force: true })
  if (runtimeLockOwned) {
    try {
      unlinkSync(runtimeLockFile)
    } catch {
      // The async shutdown path may have already removed it.
    }
  }
}

async function main() {
  if (!(await acquireRuntimeLock())) {
    process.exit(1)
  }

  await mkdir(sessionDir, { recursive: true })

  console.log(`Capi session ${sessionId}`)
  console.log(`Session directory ${sessionDir}`)

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
      CAPI_SESSION_ID: sessionId,
      CAPI_CAPTURE_DIR: sessionDir,
      VITE_CAPI_RUNTIME: "1",
      FORCE_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  viteProcess = child

  child.stdout.on("data", (data: Buffer) => {
    const output = consumeCompleteLines(editorStdoutBuffer, data)
    editorStdoutBuffer = output.remainder
    writePrefixedLines("[editor] ", output.lines, process.stdout)

    if (!browserOpened) {
      const url = editorUrlFromOutput(output.lines.join("\n"))
      if (url) {
        browserOpened = true
        console.log(`Opening ${url}`)
        openBrowser(url)
      }
    }
  })

  child.stderr.on("data", (data: Buffer) => {
    const output = consumeCompleteLines(editorStderrBuffer, data)
    editorStderrBuffer = output.remainder
    writePrefixedLines("[editor] ", output.lines, process.stderr)
  })

  child.on("error", async (error) => {
    console.error(`Failed to start the editor server: ${error.message}`)
    await shutdown(1)
  })

  child.on("close", async (code, signal) => {
    if (shuttingDown) {
      return
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`
    console.error(`Editor server stopped with ${reason}.`)
    await shutdown(code ?? 1)
  })

  process.stdin.resume()
}

process.on("SIGINT", () => {
  void shutdown(0)
})

process.on("SIGTERM", () => {
  void shutdown(0)
})

process.on("uncaughtException", async (error) => {
  console.error(error)
  await shutdown(1)
})

process.on("unhandledRejection", async (reason) => {
  console.error(reason)
  await shutdown(1)
})

process.on("exit", cleanupSessionDirSync)

await main()
