/**
 * Отсев зарубежных брендов-тёзок.
 *
 * Названия вроде «Grandmart» и «Bravo Supermarket» не уникальны: на проде под
 * них попадали магазины из Камбоджи, Сирии, Испании, Индонезии и США. У
 * Grandmart релевантными оказались 15 находок из 188, у Bravo — 7 из 41.
 * Такие находки занимают квоты платных прогонов и засоряют ленту.
 *
 * Здесь только ВЫСОКОТОЧНЫЕ признаки. Ложно отклонить настоящую азербайджанскую
 * находку хуже, чем пропустить зарубежную: пропущенную видно в ленте, а
 * отклонённую — нет. Поэтому:
 *
 *   - письменность: азербайджанский — латиница с əğışçöü, русский — кириллица.
 *     Арабица, кхмерский, CJK, тайский и подобное к рынку отношения не имеют.
 *     Требуем заметную долю, чтобы одиночный символ или эмодзи не решал;
 *   - испанский: «¡» и «¿» в азербайджанском не встречаются вообще.
 *
 * Английский СОЗНАТЕЛЬНО не отсеивается: на нём пишет и местная пресса.
 * Индонезийские и прочие латинские тёзки этим слоем не ловятся — для них нужен
 * позитивный локальный сигнал, а не отрицательный, и это отдельная задача.
 */

const FOREIGN_SCRIPT = /[\p{Script=Arabic}\p{Script=Khmer}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Hebrew}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Ethiopic}]/gu
const ANY_LETTER = /\p{L}/gu
// Перевёрнутые знаки — однозначный испанский; в азербайджанском их нет.
const SPANISH_PUNCTUATION = /[¡¿]/u

// Ниже этого числа букв доля недостоверна: «ok 👍» не должен решать судьбу.
const MIN_LETTERS = 12
// Доля подобрана так, чтобы вкрапление (цитата, эмодзи-текст) не отклоняло
// находку, а текст, написанный чужой письменностью, отклонял.
const FOREIGN_SHARE = 0.3

export type ForeignNamesakeVerdict = {
  foreign: boolean
  /** Признак, по которому вынесено решение — попадает в reason находки. */
  signal: "foreign_script" | "spanish_punctuation" | null
}

export function detectForeignNamesake(text: string | null | undefined): ForeignNamesakeVerdict {
  const sample = (text ?? "").slice(0, 2000)
  if (!sample.trim()) return { foreign: false, signal: null }

  if (SPANISH_PUNCTUATION.test(sample)) return { foreign: true, signal: "spanish_punctuation" }

  const letters = sample.match(ANY_LETTER)?.length ?? 0
  if (letters < MIN_LETTERS) return { foreign: false, signal: null }
  const foreignLetters = sample.match(FOREIGN_SCRIPT)?.length ?? 0
  if (foreignLetters / letters >= FOREIGN_SHARE) return { foreign: true, signal: "foreign_script" }

  return { foreign: false, signal: null }
}
