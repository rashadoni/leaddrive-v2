/**
 * Register this number for Cloud API, or leave it alone? One place decides.
 *
 * Meta's instruction for a number that stays in the WhatsApp Business app on a phone (coexistence)
 * is one sentence: «onboard the customer as you normally would, but **skip the phone number
 * registration step**, as the number is already registered». The two mistakes are not symmetric:
 *
 *   • not registering a number that needed it → sends fail, the customer retries, nothing is lost;
 *   • registering a coexistence number → we touched a registration Meta told us not to touch, on a
 *     live number somebody answers calls and messages on, and the Deregister API does not work on
 *     such a number.
 *
 * So every uncertainty resolves towards NOT registering, and an outright contradiction refuses the
 * whole signup instead of guessing. Two independent signals say what kind of number this is:
 *
 *   1. `is_on_biz_app` from Graph (`GET /<PHONE_NUMBER_ID>?fields=is_on_biz_app,platform_type`) —
 *      authoritative, but we have never seen it answer for a real coexistence number, and the field
 *      may simply be absent on an older Graph version. Unreadable is therefore a real outcome, not
 *      an error.
 *   2. The Embedded Signup completion event from the browser — `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`
 *      instead of `FINISH` — which is the customer's own choice on Meta's screen, relayed through our
 *      page.
 *
 * Both are guesses until a real number goes through, which is exactly why they meet here and nowhere
 * else: when one of them turns out to be wrong, this file is the only thing to correct.
 */

/** Completion events Embedded Signup can report; anything else is treated as "not stated". */
export const COEXISTENCE_FINISH_EVENT = "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"

export type NumberPlatformFacts = {
  /** Meta's answer, or null when the field could not be read (old Graph version, refused request). */
  isOnBizApp: boolean | null
  /** `CLOUD_API` / `ON_PREMISE` / `NOT_APPLICABLE`, or null when unreadable. */
  platformType: string | null
}

export type OnboardingMode = "coexistence" | "cloud_api" | "contradiction"

export type OnboardingDecision = {
  mode: OnboardingMode
  /** True only for a number we are confident Meta expects us to register. */
  register: boolean
  /** Stored on the channel and logged, so a wrong guess is visible afterwards. */
  reason:
    | "graph_says_business_app"
    | "signup_event_says_business_app"
    | "graph_says_cloud_api"
    | "no_signal"
    | "graph_and_signup_disagree"
  /** Human-readable refusal for the customer; only set for a contradiction. */
  error?: string
}

/**
 * Decide from the two signals.
 *
 * Deliberately pure and total: no network, no database, every combination answered. The caller does
 * the logging and the refusing.
 */
export function decideNumberOnboarding(input: {
  facts: NumberPlatformFacts
  signupEvent: string | null | undefined
}): OnboardingDecision {
  const eventSaysBusinessApp = input.signupEvent === COEXISTENCE_FINISH_EVENT
  const { isOnBizApp } = input.facts

  if (isOnBizApp === true) {
    // Authoritative, and it does not matter what the browser reported: the number is in the app.
    return { mode: "coexistence", register: false, reason: "graph_says_business_app" }
  }

  if (isOnBizApp === false) {
    if (eventSaysBusinessApp) {
      // Meta's own two answers disagree about the same number. Registering could be the irreversible
      // mistake, and connecting a number we cannot describe would hide the problem in a workspace
      // nobody is watching — so neither happens.
      return {
        mode: "contradiction",
        register: false,
        reason: "graph_and_signup_disagree",
        error: "Meta describes this number inconsistently (the dialog reported the WhatsApp Business app, the API did not). Connect it again; if it repeats, connect it without the app option.",
      }
    }
    return { mode: "cloud_api", register: true, reason: "graph_says_cloud_api" }
  }

  // Graph said nothing we could read.
  if (eventSaysBusinessApp) {
    // The customer chose "keep my app" on Meta's own screen. Taking them at their word costs a
    // failed send at worst; disbelieving them costs the registration we were told to skip.
    return { mode: "coexistence", register: false, reason: "signup_event_says_business_app" }
  }
  // Neither signal mentions the app: the ordinary Cloud API onboarding we have always done.
  return { mode: "cloud_api", register: true, reason: "no_signal" }
}

/** Does this decision describe a number that also lives in the WhatsApp Business app? */
export function isCoexistenceChannel(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false
  return (settings as Record<string, unknown>).coexistence === true
}
