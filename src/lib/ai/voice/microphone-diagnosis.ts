/**
 * Why the microphone did not open, said precisely enough to act on.
 *
 * One message covered five different failures and named only the first of them:
 * "the browser did not allow the microphone — grant it from the address bar".
 * That advice is right for exactly one cause and useless or misleading for the
 * rest. A user with no microphone attached is sent hunting for an icon that
 * will not appear; a user on an http:// address is told to change a permission
 * the browser never even offered, because in an insecure context the API is not
 * merely denied — it does not exist.
 *
 * That last one is the reason this file exists. It is the classic shape of
 * "works for me, not for them": the microphone is fine, the permission is fine,
 * and the page is simply not served over TLS. Measured on this deployment on
 * 2026-08-24: two tenant custom domains are configured and NEITHER has a
 * certificate issued, so anyone reaching the CRM through one of them cannot use
 * voice at all, whatever they click.
 *
 * Every branch here is a different sentence and a different remedy, and the
 * remedy is sometimes for the administrator rather than the person who clicked.
 */

export type MicrophoneProblem =
  /** http:// or a bare IP. The browser hides the API entirely; nothing to grant. */
  | "insecure_context"
  /** Inside an iframe whose embed does not carry allow="microphone". */
  | "embedded"
  /** A real denial: the person, a browser setting, or an enterprise policy. */
  | "blocked"
  /** No microphone attached at all. */
  | "no_device"
  /** One exists, but another application or the operating system holds it. */
  | "device_busy"
  | "unknown"

export type MicrophoneEnvironment = {
  /** window.isSecureContext */
  secureContext: boolean
  /** Whether navigator.mediaDevices?.getUserMedia is there to be called. */
  mediaDevicesPresent: boolean
  /** window.self !== window.top */
  embedded: boolean
  /**
   * What the browser says the site's microphone permission already is.
   *
   * "unknown" where the Permissions API is missing or refuses the query —
   * Safari has historically done both — so a browser that cannot answer is
   * never treated as having answered.
   */
  permission: "granted" | "prompt" | "denied" | "unknown"
}

/**
 * Read the environment from a real browser. Kept apart so the rest is testable.
 *
 * Asynchronous only because the permission state is: the Permissions API
 * returns a promise, and reading it is what separates "you denied this" from
 * "something else is holding the microphone".
 */
export async function readMicrophoneEnvironment(): Promise<MicrophoneEnvironment> {
  const nav = typeof navigator === "undefined" ? undefined : navigator
  let permission: MicrophoneEnvironment["permission"] = "unknown"
  try {
    const status = await nav?.permissions?.query({ name: "microphone" as PermissionName })
    if (status?.state === "granted" || status?.state === "prompt" || status?.state === "denied") {
      permission = status.state
    }
  } catch {
    // Left as "unknown": a browser that cannot report the permission must not
    // have an answer invented for it.
  }
  return {
    secureContext: typeof window !== "undefined" && window.isSecureContext === true,
    mediaDevicesPresent: typeof nav?.mediaDevices?.getUserMedia === "function",
    embedded: typeof window !== "undefined" && window.self !== window.top,
    permission,
  }
}

/**
 * A problem visible BEFORE asking, or null when it is worth asking.
 *
 * Checking first matters: in an insecure context the call throws a TypeError
 * about a missing property, which no error-name check would ever classify as a
 * microphone problem — so the user would get the generic failure message and
 * nobody would learn the page simply needs to be opened over https.
 */
export function microphonePrecheck(env: MicrophoneEnvironment): MicrophoneProblem | null {
  if (!env.secureContext || !env.mediaDevicesPresent) return "insecure_context"
  return null
}

/**
 * Classify a getUserMedia rejection.
 *
 * The embedded case is decided by where we are rather than by the error, since
 * a frame with no microphone permission and a person clicking "block" both
 * arrive as NotAllowedError — and the fixes are in different hands.
 */
export function diagnoseMicrophoneFailure(
  error: unknown,
  env: MicrophoneEnvironment,
): MicrophoneProblem {
  const precheck = microphonePrecheck(env)
  if (precheck) return precheck

  const name = (error as { name?: unknown } | null)?.name
  switch (name) {
    case "NotFoundError":
    case "OverconstrainedError":
      return "no_device"
    case "NotReadableError":
    case "AbortError":
      return "device_busy"
    case "NotAllowedError":
    case "SecurityError":
      if (env.embedded) return "embedded"
      // A permission the site ALREADY holds cannot be what just refused it.
      //
      // macOS reports a microphone held by another application as
      // NotAllowedError, the same name a person clicking "block" produces. Told
      // apart by the name alone, the two are indistinguishable — and the wrong
      // half sends someone to a browser setting that is already correct while a
      // video call quietly keeps the device. Observed on 2026-08-28: the owner
      // was mid-presentation, the site permission read "granted", and the
      // advice on screen was to grant it again.
      //
      // Only "granted" redirects. "denied", "prompt" and a browser that cannot
      // answer all stay on the denial message, which is right for them.
      return env.permission === "granted" ? "device_busy" : "blocked"
    default:
      return "unknown"
  }
}

/** The i18n key under `voice` for each cause. */
export function microphoneMessageKey(problem: MicrophoneProblem): string {
  switch (problem) {
    case "insecure_context": return "micInsecureContext"
    case "embedded": return "micEmbedded"
    case "no_device": return "micNoDevice"
    case "device_busy": return "micBusy"
    case "blocked": return "micDenied"
    default: return "micUnavailable"
  }
}
