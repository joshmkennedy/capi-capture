import {
  SessionAlreadyRunningError,
  SessionNotFoundError,
  killRunningRuntime,
  startSession,
  type StartSessionOptions,
} from "./session/SessionRuntime"

function shouldKillRuntime(args: string[]) {
  return args.includes("kill") || args.includes("--kill") || args.includes("stop") || args.includes("--stop")
}

function startupOptions(args: string[]): StartSessionOptions {
  const sessionFlagIndex = args.indexOf("--session")
  if (sessionFlagIndex !== -1) {
    const sessionId = args[sessionFlagIndex + 1]
    if (!sessionId) {
      throw new Error("Use --session <session-id>.")
    }

    return { sessionId }
  }

  if (args.includes("--last-session")) {
    return { lastSession: true }
  }

  if (args.includes("--grid")) {
    return { grid: true }
  }

  if (args.includes("--record") || args.includes("--immediate-record")) {
    return { immediateRecord: true }
  }

  return {}
}

try {
  const args = process.argv.slice(2)
  if (shouldKillRuntime(args)) {
    await killRunningRuntime()
    process.exit(0)
  }

  const runtime = await startSession(startupOptions(args))
  if (runtime) {
    process.stdin.resume()
  }
} catch (error) {
  if (error instanceof SessionNotFoundError) {
    console.error(error.message)
    console.error("Start a new session with npm run capi.")
  } else if (!(error instanceof SessionAlreadyRunningError)) {
    console.error(error)
  }
  process.exit(1)
}
