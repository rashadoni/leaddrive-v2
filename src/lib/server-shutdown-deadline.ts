/**
 * How long a stopping server process may wait for its open connections.
 *
 * On SIGINT/SIGTERM Next.js (16.2, `start-server.js`) closes the listening
 * socket at once and exits only when every open connection has ended. Each
 * open CRM tab holds one that never ends — the shell's event stream
 * (`/api/v1/shell/events`) — so the process never exited on its own: pm2 waited
 * its full `kill_timeout` and then sent SIGKILL. Measured on the deploy of
 * 2026-10-28 10:30 UTC: `failed to kill - retrying in 100ms` for 10 s, and
 * since the port was already closed, nginx answered 502 for all of those
 * seconds — including the phone station's calls for Zeytun's line.
 *
 * The deadline gives a request already being answered time to finish, then
 * exits. A tab's event stream reconnects by itself to the new process.
 */
export const SERVER_SHUTDOWN_GRACE_MS = 2000

type SignalProcess = {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown
  exit(code: number): never
}

export function installServerShutdownDeadline(
  proc: SignalProcess = process,
  graceMs: number = SERVER_SHUTDOWN_GRACE_MS,
): void {
  // The exit codes Next.js itself uses, so pm2 and the logs read the same thing
  // whichever side finishes first. unref(): when Next.js exits sooner (no open
  // connections), this timer does not hold the process.
  const arm = (code: number) => () => {
    setTimeout(() => proc.exit(code), graceMs).unref()
  }
  proc.once("SIGINT", arm(130))
  proc.once("SIGTERM", arm(143))
}
