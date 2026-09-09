/**
 * Pure legal-case category model (no server deps) — safe to import from
 * client components. Server-side report/letter logic lives in legal-case.ts.
 */

export const SOCIAL_LEGAL_CATEGORIES = [
  "insult",
  "defamation",
  "false_accusation",
  "threat",
  "complaint",
  "reputation_risk",
  "other",
] as const

export type SocialLegalCategory = (typeof SOCIAL_LEGAL_CATEGORIES)[number]

export const SOCIAL_LEGAL_CASE_STATUSES = ["open", "included", "dismissed"] as const
export type SocialLegalCaseStatus = (typeof SOCIAL_LEGAL_CASE_STATUSES)[number]

export const SOCIAL_LEGAL_REPORT_STATUSES = ["draft", "final"] as const
export type SocialLegalReportStatus = (typeof SOCIAL_LEGAL_REPORT_STATUSES)[number]

export const SOCIAL_LEGAL_LETTER_LANGUAGES = ["az", "ru", "en"] as const
export type SocialLegalLetterLanguage = (typeof SOCIAL_LEGAL_LETTER_LANGUAGES)[number]

export function isSocialLegalCategory(value: unknown): value is SocialLegalCategory {
  return typeof value === "string" && (SOCIAL_LEGAL_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Heuristic category hint for the flag dialog (az / ru / en). Ordered by
 * severity — a threat outranks an insult when both patterns match. This is a
 * SUGGESTION for the operator, never an automatic legal qualification.
 */
// NOTE: no \b anchors on Azerbaijani/Russian patterns — JS \b is ASCII-only
// and never matches before ö/ə/ş or Cyrillic letters.
const CATEGORY_PATTERNS: Array<{ category: SocialLegalCategory; patterns: RegExp[] }> = [
  {
    category: "threat",
    patterns: [
      /(h[əe]d[əe]-?qorxu|h[əe]d[əe]l[əe]|t[əe]hdid|öldür|oldur[əe]c|dağıdacağ|yandıracağ)/i,
      /(угроз|угрож|убь[юе]|расправ|сожг|уничтож)/i,
      /\b(threat|kill\s+you|destroy\s+you|hurt\s+you)\b/i,
    ],
  },
  {
    category: "defamation",
    patterns: [
      /(böhtan|bohtan|iftira|ş[əe]r\s+at|l[əe]k[əe]l[əe])/i,
      /(клевет|оклевет|порочащ|ложн[аы][яе]\s+информаци)/i,
      /\b(defam|slander|libel|smear)/i,
    ],
  },
  {
    category: "false_accusation",
    patterns: [
      /([əe]sass[ıi]z\s+ittiham|günahland[ıi]r|ittiham\s+edir)/i,
      /(бездоказательн|необоснованн[оы].{0,20}обвин|ложно\s+обвин|голословн)/i,
      /\b(false(ly)?\s+accus|baseless\s+accusation|unfounded\s+claim)/i,
    ],
  },
  {
    category: "insult",
    patterns: [
      /(t[əe]hqir|söyüş|soyus|ş[əe]r[əe]fsiz|d[əe]l[əe]duz|f[ıi]r[ıi]ldaq[çc][ıi])/i,
      /(оскорб|мошенник|обманщик|вор(ы|юга)?\b|позорищ)/i,
      /\b(insult|scammer|fraudster|crook|liar)\b/i,
    ],
  },
  {
    category: "complaint",
    patterns: [
      /(şikay[əe]t|naraz[ıi]yam|naraz[ıi]l[ıi]q|xidm[əe]t.{0,30}(pis|b[əe]rbad)|geri\s+qaytar)/i,
      /(жалоб|недовол|ужасн.{0,20}(сервис|обслужив|качество)|верните\s+деньги|обманули)/i,
      /\b(complaint|terrible\s+(service|quality)|refund|very\s+disappointed|customer\s+service\s+failed)\b/i,
    ],
  },
  {
    category: "reputation_risk",
    patterns: [
      /(saxta|fırıldaq|firildaq|boykot|biab[ıi]rç[ıi]l[ıi]q|keyfiyy[əe]tsiz|z[əe]h[əe]rl[əe]n)/i,
      /(бойкот|подделк|опасн.{0,20}(товар|продукт)|отрав|антисанитар|скандал|позор.{0,20}компан)/i,
      /\b(boycott|fake\s+product|unsafe\s+product|food\s+poison|scandal|reputation)\b/i,
    ],
  },
]

export function suggestLegalCategory(text: string): SocialLegalCategory | null {
  for (const group of CATEGORY_PATTERNS) {
    if (group.patterns.some((pattern) => pattern.test(text))) return group.category
  }
  return null
}
