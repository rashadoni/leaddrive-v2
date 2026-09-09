/**
 * Advice must come from the tenant's numbers, not from the model's erudition.
 *
 * "How do I raise sales" and "why don't leads convert" carry no period and no
 * ranking, so the verified-analytics detector never fires and the model is free
 * to answer from general knowledge — plausible words that have nothing to do
 * with THIS organisation. The owner's requirement is the opposite: the
 * assistant advises exclusively from their data.
 *
 * This detector recognises advisory intent and names the read tool whose result
 * the first model round is forced to observe. It deliberately maps to the
 * shared voice read tools, NOT to CHAT_ANALYTICS_TOOLS: an analytics tool call
 * makes the deterministic renderer replace the model's final text with a
 * template, which is right for "how many deals in July" and fatal for advice.
 */

const LEAD_CONVERSION = new RegExp(
  [
    // ru: почему лиды не конвертируются/не превращаются/теряются
    "(?:почему|отчего)[^.!?]{0,60}лид",
    "лид\\p{L}*[^.!?]{0,50}(?:не\\s+(?:конверт|превращ|станов|доход|закрыва|покупа)|теря)",
    // en
    "why[^.!?]{0,60}lead",
    "leads?[^.!?]{0,50}(?:don'?t|do\\s+not|aren'?t|not)\\s+(?:convert|becom|clos|buy)",
    // az: niyə lidlər müştəriyə çevrilmir
    "(?:niyə|nə\\s*üçün|nəyə\\s*görə)[^.!?]{0,60}lid",
    "lid\\p{L}*[^.!?]{0,50}çevrilm",
  ].join("|"),
  "iu",
)

const SALES_IMPROVEMENT = new RegExp(
  [
    // ru: как поднять/увеличить/улучшить продажи; почему продажи упали
    "как[^.!?]{0,40}(?:подня|увелич|улучш|вырост|растить|поднять)[^.!?]{0,40}(?:продаж|выручк|конверси|сдел)",
    "(?:почему|отчего)[^.!?]{0,50}(?:продаж|выручк|конверси)[^.!?]{0,40}(?:упал|снизил|нет|не\\s+раст|мало)",
    // en
    "how[^.!?]{0,50}(?:increase|improve|grow|boost|raise)[^.!?]{0,40}(?:sales|revenue|conversion|deals)",
    "why[^.!?]{0,50}(?:sales|revenue|conversion)[^.!?]{0,40}(?:down|drop|low|not\\s+grow)",
    // az: satışları necə artıraq; satış niyə azalıb
    "(?:necə|nə\\s*cür)[^.!?]{0,50}(?:artır|yüksəlt|çoxalt)[^.!?]{0,40}sat",
    "sat[ıi]ş\\p{L}*[^.!?]{0,40}(?:necə|nə\\s*cür)[^.!?]{0,40}(?:artır|yüksəlt|çoxalt)",
    "sat[ıi]ş[^.!?]{0,50}(?:niyə|nə\\s*üçün)[^.!?]{0,40}(?:azal|aşağ|düşü|artm)",
    "(?:niyə|nə\\s*üçün)[^.!?]{0,40}sat[ıi]ş[^.!?]{0,40}(?:azal|aşağ|düşü|artm|yoxdur)",
  ].join("|"),
  "iu",
)

/**
 * The read tool an advisory question is grounded on, or null for non-advisory
 * messages. Lead questions ground on lead coverage — where leads come from and
 * where they stall; sales questions ground on the pipeline by stage — where the
 * money actually sits.
 */
export function advisoryGroundingTool(message: string): "get_lead_coverage" | "get_pipeline_by_stage" | null {
  const text = message.normalize("NFC")
  if (LEAD_CONVERSION.test(text)) return "get_lead_coverage"
  if (SALES_IMPROVEMENT.test(text)) return "get_pipeline_by_stage"
  return null
}

/** Prompt rules that keep advice tethered to the numbers the tools returned. */
export const ADVISORY_GROUNDING_RULES = `
ADVICE AND DIAGNOSIS - data first, always:
- When the user asks WHY something is happening (why leads don't convert, why sales dropped) or HOW to improve a result (raise sales, improve conversion), you MUST look at their data through your read tools BEFORE advising: lead coverage, pipeline by stage, overdue work, recent activity - whatever the question touches.
- Every recommendation must cite the specific numbers you just retrieved ("48 из 57 лидов так и стоят в статусе 'новый' - начните с них"). A recommendation you cannot tie to a retrieved number does not belong in the answer.
- Never present general sales wisdom as if it came from their CRM. If the data needed for a real diagnosis is not reachable through your tools, say plainly that this part is general advice, not their data.
- Prefer one diagnosis built on three numbers over five generic tips.`
