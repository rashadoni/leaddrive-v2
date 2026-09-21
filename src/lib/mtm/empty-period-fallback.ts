/**
 * Opening a screen on a period where there is nothing to see.
 *
 * Audit 2026-09-21 of the field module on prod: «Визиты» opened on «Сегодня»
 * with four zero counters, three «(0)» filters, a search box, a sort control
 * and «Показано: 0» — and only then said there were no visits. Seven were
 * recorded over the previous week. «Фотографии» opened on «Эта неделя» with
 * four zeros while 1367 photos were stored, and told the manager to pick
 * «Все загруженные» themselves. The screen made the reader do the search.
 *
 * So: when the default period is empty, widen it ONCE and say so in one line.
 * The rules that keep this honest:
 *
 * - only while the period is still the default — the moment a person picks a
 *   period, their choice stands even if it is empty. Nothing is more annoying
 *   than a filter that moves under your hand;
 * - only one step wider, never straight to «всё»: the nearest period with
 *   data is the answer, not the largest one;
 * - only once per screen, so an empty tenant cannot walk the list end to end;
 * - never while a request is in flight — an empty list that has not loaded
 *   yet is not an empty period.
 */

export interface WidenPeriodInput<T extends string> {
  /** Periods from narrowest to widest, exactly as the control offers them. */
  order: readonly T[]
  current: T
  /** Rows the last completed load returned for `current`. */
  rows: number
  /** True once the reader has chosen a period themselves. */
  userChose: boolean
  /** True once this screen has already widened by itself. */
  alreadyWidened: boolean
  loading: boolean
}

/** The period to move to, or null to stay where we are. */
export function nextWiderPeriod<T extends string>(input: WidenPeriodInput<T>): T | null {
  if (input.loading) return null
  if (input.rows > 0) return null
  if (input.userChose || input.alreadyWidened) return null
  const index = input.order.indexOf(input.current)
  if (index < 0 || index >= input.order.length - 1) return null
  return input.order[index + 1]
}
