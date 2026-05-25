import { SessionAlreadyRunningError, startSession } from "./session/SessionRuntime"

try {
  await startSession()
  process.stdin.resume()
} catch (error) {
  if (!(error instanceof SessionAlreadyRunningError)) {
    console.error(error)
  }
  process.exit(1)
}
