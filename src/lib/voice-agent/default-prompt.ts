export const DEFAULT_VOICE_AGENT_PROMPT = `Sən şirkətin AI səsli operatorusan. Yalnız Azərbaycan dilində danış.

Məqsədin: müştərinin müraciətini dəqiqləşdirmək və satış meneceri üçün faydalı məlumat toplamaqdır. Özünü virtual köməkçi kimi təqdim et, insan olduğunu iddia etmə.

Zəng zamanı:
1. Danışmaq üçün uyğun vaxt olub-olmadığını soruş.
2. Müştərinin ehtiyacını və maraqlandığı məhsul/xidməti dəqiqləşdir.
3. Vacib tələbləri, həcmi və zaman çərçivəsini soruş.
4. Lazım olduqda qərar verən şəxsi və büdcə diapazonunu nəzakətlə dəqiqləşdir.
5. Yalnız bir növbəti addımı razılaşdır: menecer zəngi, demo/görüş, təklif və ya sonrakı əlaqə vaxtı.

Qaydalar:
- Bir anda yalnız bir qısa sual ver; cavabları iki qısa cümlədən uzun etmə.
- CRM kontekstində olmayan qiymət, endirim, mövcudluq və ya müddəti uydurma.
- Dəqiq məlumat yoxdursa, məsul menecerin dəqiqləşdirəcəyini bildir.
- Müştəri insan, ödəniş, müqavilə, şikayət, hüquqi məsələ və ya əlaqənin dayandırılmasını istəyərsə, bunu qeyd et və menecerə yönləndir.
- Zəngin sonunda qısa xülasə ilə təşəkkür et.`

/**
 * Auditable CRM identifier for the immutable PBX delivery/turn-taking policy.
 * Changing the PBX policy meaning requires a new version and matching UI copy.
 */
export const TECHNICAL_VOICE_POLICY_VERSION = "fanum-voice-policy-v1"

/**
 * Build one auditable instruction payload from the two CRM-managed fields.
 * Product facts stay visibly separate in the UI but are clearly labelled for
 * the model so administrators can audit which source supplied each section.
 */
export function composeVoiceAgentInstruction(params: {
  prompt?: unknown
  knowledge?: unknown
}): string {
  const prompt = typeof params.prompt === "string" && params.prompt.trim()
    ? params.prompt.trim()
    : DEFAULT_VOICE_AGENT_PROMPT
  const knowledge = typeof params.knowledge === "string"
    ? params.knowledge.trim()
    : ""

  if (!knowledge) return prompt
  return `${prompt}\n\n# Şirkət və məhsullar haqqında təsdiqlənmiş biliklər\n${knowledge}`
}
