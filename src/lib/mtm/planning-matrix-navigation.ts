export type PlanningMatrixCoordinate = {
  row: number
  column: number
}

export function orderedMobilePlanningDays<
  TDay extends { date: string },
  TState extends { date: string },
>(
  days: readonly TDay[],
  states: readonly TState[],
  isMutable: (day: TDay) => boolean,
): Array<{ day: TDay; mutable: boolean; state: TState | undefined }> {
  const stateByDate = new Map<string, TState>()
  for (const state of states) {
    // Match the existing `find` semantics if defensive input ever contains
    // more than one projection for a date.
    if (!stateByDate.has(state.date)) stateByDate.set(state.date, state)
  }
  return days
    .map((day) => ({ day, mutable: isMutable(day), state: stateByDate.get(day.date) }))
    .filter(({ mutable, state }) => mutable || Boolean(state))
    .sort((left, right) => left.day.date.localeCompare(right.day.date))
}

export function mobilePlanningDayLayout(days: readonly { mutable: boolean }[]) {
  const editableDayCount = days.filter(({ mutable }) => mutable).length
  const lockedDayCount = days.length - editableDayCount
  return {
    editableDayCount,
    lockedDayCount,
    state: editableDayCount === 0 && days.length > 0
      ? "all-locked" as const
      : lockedDayCount > 0
        ? "mixed" as const
        : "editable" as const,
  }
}

type PlanningMatrixNavigationKey =
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "End"
  | "Home"

export function nextPlanningMatrixCoordinate(
  current: PlanningMatrixCoordinate,
  key: string,
  rowCount: number,
  columnCount: number,
): PlanningMatrixCoordinate | null {
  if (rowCount < 1 || columnCount < 1) return null

  const lastRow = rowCount - 1
  const lastColumn = columnCount - 1
  const row = Math.min(Math.max(current.row, 0), lastRow)
  const column = Math.min(Math.max(current.column, 0), lastColumn)

  const targetByKey: Partial<Record<PlanningMatrixNavigationKey, PlanningMatrixCoordinate>> = {
    ArrowDown: { row: Math.min(row + 1, lastRow), column },
    ArrowLeft: { row, column: Math.max(column - 1, 0) },
    ArrowRight: { row, column: Math.min(column + 1, lastColumn) },
    ArrowUp: { row: Math.max(row - 1, 0), column },
    End: { row, column: lastColumn },
    Home: { row, column: 0 },
  }

  return targetByKey[key as PlanningMatrixNavigationKey] ?? null
}
