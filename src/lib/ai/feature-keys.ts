/**
 * Organization-level AI switches shared by settings UI and server-side gates.
 *
 * Keep these values separate from paid module ids. They are operational
 * switches: the `ai` add-on grants access, while these flags decide whether a
 * module is currently allowed to run AI.
 */
export const OMNICHANNEL_AI_FEATURE = "aiAutoReply" as const
/**
 * Support AI predates its switch and is already live for existing tenants.
 * Store an explicit opt-out so deploying the gate does not silently turn the
 * feature off for every organization that has no new flag yet.
 */
export const SUPPORT_AI_DISABLED_FEATURE = "supportAiDisabled" as const
