/**
 * The browser half of the demo form's bot check (form-challenge.ts on the
 * server). The marketing site (rashadoni/leaddrive-site, DemoModal.tsx)
 * carries a copy of these few lines: it is another repository and cannot
 * import this one.
 */
export interface DemoFormChallengePayload {
  salt: string
  issuedAt: number
  challenge: string
  maxNumber: number
  signature: string
}

export type DemoFormSolutionPayload = DemoFormChallengePayload & { number: number }

/** The server refuses a solution signed less than this long ago. */
const MIN_FILL_MS = 3_000

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function solve(challenge: DemoFormChallengePayload): Promise<number | null> {
  const encoder = new TextEncoder()
  for (let number = 0; number <= challenge.maxNumber; number += 1) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${challenge.salt}${number}`))
    if (hex(digest) === challenge.challenge) return number
    // Let the page breathe: the visitor is typing while this runs.
    if (number % 1_000 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return null
}

/**
 * Fetches a challenge and solves it in the background. Start it when the form
 * appears and await it on submit: by then it is done. Resolves to null when
 * the challenge could not be had; the server then asks to send again.
 */
export function prepareDemoFormSolution(endpoint: string): Promise<DemoFormSolutionPayload | null> {
  const received = Date.now()
  return fetch(endpoint, { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<DemoFormChallengePayload>) : null))
    .then(async (challenge) => {
      if (!challenge) return null
      const number = await solve(challenge)
      if (number === null) return null
      // Submitting within the first seconds is refused as a bot; a person who
      // autofilled the form that fast just waits the rest of it here.
      const wait = MIN_FILL_MS + 250 - (Date.now() - received)
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      return { ...challenge, number }
    })
    .catch(() => null)
}
