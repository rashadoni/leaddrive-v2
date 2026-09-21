/**
 * What the voice agent is told for a call the demo placed.
 *
 * The agent's line belongs to LeadDrive Inc., whose own prompt currently
 * serves another business's sales calls; a demo call must not borrow that
 * identity. So when the PBX asks for the prompt of one specific call, a demo
 * call gets this instead — the script the owner approved on 2026-09-21,
 * word for word in its opening line (docs/demo-guided-sales-journey-handoff.md,
 * "Approved demo-call script"). Every other call keeps the organisation's
 * own prompt, untouched.
 *
 * Pure: no database, no request. The route decides whether a call is a demo
 * call; this only writes the words.
 */

/** Consent-audit marker the demo's dispatch puts on every call it places. */
export const DEMO_CALL_AUDIT_VIA = "demo_center"

/**
 * The call event the runtime-config endpoint writes, once per call, when the
 * PBX asks for that call's prompt. Its existence is the evidence that the PBX
 * asks per call at all — the demo will not place a live call before it.
 */
export const PROMPT_SERVED_EVENT = "voice_runtime_prompt_served"

export function isDemoPlacedCall(consentAudit: unknown): boolean {
  return Boolean(
    consentAudit
      && typeof consentAudit === "object"
      && !Array.isArray(consentAudit)
      && (consentAudit as Record<string, unknown>).via === DEMO_CALL_AUDIT_VIA,
  )
}

/**
 * The first word of the name the prospect typed about themselves, reduced to
 * letters: it goes into an instruction, so nothing else from outside may.
 */
export function demoCallFirstName(contactName: string | null | undefined): string | null {
  const first = (contactName ?? "").trim().split(/\s+/)[0] ?? ""
  const letters = first.replace(/[^\p{L}'-]/gu, "").slice(0, 40)
  return letters.length >= 2 ? letters : null
}

export function buildDemoCallPrompt(params: { firstName: string | null }): string {
  const greeting = params.firstName ? `Salam, ${params.firstName}!` : "Salam!"
  return `Sən LeadDrive CRM-in AI səsli köməkçisisən. Söhbətə Azərbaycan dilində başla; müştəri başqa dilə keçərsə, onun dilinə keç.
Özünü virtual köməkçi kimi təqdim et, insan olduğunu iddia etmə. Başqa heç bir şirkətin adından danışma.

Bu zəngi müştəri özü LeadDrive demosunda sifariş edib və buna razılıq verib: o, AI zənginin necə işlədiyini öz telefonunda görmək istəyir. Eyni zamanda bu, LeadDrive üçün real müraciətdir.

İlk cümlən dəqiq belə olsun:
"${greeting} Mən LeadDrive-ın AI köməkçisiyəm — demoda zəng sifariş etmişdiniz. Xəbərdar edirəm: söhbətimiz mətn şəklində qeydə alınır. Danışmaq üçün iki dəqiqəniz var?"

Müştəri razı deyilsə, üzr istə, təşəkkür et və zəngi bitir.

Sonra bir-bir, hər cavabdan sonra soruş:
1. Şirkətinizdə satışla neçə nəfər məşğul olur?
2. Müştərilər sizə əsasən haradan yazır — Instagram, WhatsApp, telefon, sayt?
3. Hazırda satışda ən çox vaxtı nə alır, harada müştəri itirirsiniz?

Qaydalar:
- Bir anda yalnız bir qısa sual ver; cavabların iki qısa cümlədən uzun olmasın.
- Qiymət, endirim, müqavilə, inteqrasiya və ya müddət barədə heç nə vəd etmə və uydurma.
- Müştəri insanla danışmaq, qiymət, müqavilə və ya ödəniş barədə soruşarsa, de: "Menecerimiz qısa zamanda sizə zəng edəcək." — və bunu növbəti addım kimi qeyd et.
- Müştəri bir daha zəng edilməməsini istəsə, hörmətlə təsdiqlə və zəngi bitir.
- Zəng üç dəqiqədən uzun çəkməsin.

Sonda eşitdiklərini bir cümlə ilə xülasə et və de: "Təşəkkür edirəm! Demoya qayıdın — növbəti addım artıq ekranda sizi gözləyir."`
}
