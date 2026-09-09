/**
 * Правка тональности оператором: провенанс и защита от перезаписи.
 *
 * Прод 2026-08-04, вопрос владельца: «когда я меняю негатив на нейтрал,
 * обучение происходит или нет?». Ответ был — нет, и хуже:
 *
 *  - правка писала только поле `sentiment`, без кто/когда/из чего;
 *  - повторный сбор той же записи ЗАТИРАЛ её: обновление в приёме писало
 *    `sentiment` безусловно, хотя рядом стоит комментарий «источник не должен
 *    стирать поля, которых не знает»;
 *  - ни один классификатор эти правки не читал.
 *
 * Что делает этот модуль. Метит правку в `sourceMetadata.socialTriage` и даёт
 * приёму признак «здесь решил человек». Метка нужна не только для защиты: она
 * превращает правки в размеченный набор, на котором можно мерить каждое
 * изменение правил — по нему и видно, «учится» ли система на самом деле.
 *
 * Обучения модели тут нет и не обещается. Есть закреплённое решение человека и
 * измеримая обратная связь: чем меньше расхождений классификатора с правками,
 * тем лучше правила.
 */
export const OPERATOR_SENTIMENT_SOURCE = "operator"

export type SocialSentiment = "positive" | "neutral" | "negative"

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * `sourceMetadata` с отметкой правки. Прежние ключи `socialTriage` (язык,
 * признаки триажа) сохраняются: их пишут другие подсистемы.
 */
export function withOperatorSentimentStamp(input: {
  sourceMetadata: unknown
  sentimentBefore: string | null
  sentimentAfter: SocialSentiment
  actorId: string | null
  at: Date
}): Record<string, unknown> {
  const metadata = asRecord(input.sourceMetadata)
  const triage = asRecord(metadata.socialTriage)
  return {
    ...metadata,
    socialTriage: {
      ...triage,
      sentimentSource: OPERATOR_SENTIMENT_SOURCE,
      sentimentBefore: input.sentimentBefore,
      sentimentAfter: input.sentimentAfter,
      sentimentCorrectedAt: input.at.toISOString(),
      sentimentCorrectedBy: input.actorId,
    },
  }
}

/**
 * Тональность закреплена человеком.
 *
 * Приём и автоматический триаж обязаны это уважать: иначе очередной сбор той же
 * записи вернёт метку, которую владелец только что снял, и правка будет выглядеть
 * как «не сохранилось».
 */
export function hasOperatorSentiment(sourceMetadata: unknown): boolean {
  return asRecord(asRecord(sourceMetadata).socialTriage).sentimentSource
    === OPERATOR_SENTIMENT_SOURCE
}

export type OperatorSentimentCorrection = {
  before: string | null
  after: string | null
  correctedAt: string | null
  correctedBy: string | null
}

/** Разбор отметки для отчёта и замеров. Мусор в метаданных не роняет разбор. */
export function operatorSentimentCorrection(
  sourceMetadata: unknown,
): OperatorSentimentCorrection | null {
  const triage = asRecord(asRecord(sourceMetadata).socialTriage)
  if (triage.sentimentSource !== OPERATOR_SENTIMENT_SOURCE) return null
  const text = (value: unknown): string | null => (
    typeof value === "string" && value.trim() ? value : null
  )
  return {
    before: text(triage.sentimentBefore),
    after: text(triage.sentimentAfter),
    correctedAt: text(triage.sentimentCorrectedAt),
    correctedBy: text(triage.sentimentCorrectedBy),
  }
}
