/**
 * Срочность тикета, который ИИ WhatsApp открывает сам, — из того, что написал
 * клиент. Поэтому не выше «высокой»: «критический» ставит человек.
 *
 * До 2026-11-11 слово «срочно» / «təcili» / «urgent» или «жалоба» в сообщении
 * делало тикет критическим (разбор «гардрейлов»: слова клиента решали за
 * компанию). Любой мог поставить свой вопрос впереди всей очереди одним словом.
 * Слова остаются сигналом — тикет открывается, категория и реестр жалоб те же,
 * приоритет «высокий», — но верхнюю ступень они не дают.
 */
export type WhatsAppTicketUrgency = "normal" | "high"

export function whatsappTicketUrgency(signals: {
  urgentWords: boolean
  complaint: boolean
  frustration: boolean
  contactTried: boolean
  refund: boolean
}): WhatsAppTicketUrgency {
  return signals.urgentWords || signals.complaint || signals.frustration || signals.contactTried || signals.refund
    ? "high"
    : "normal"
}
