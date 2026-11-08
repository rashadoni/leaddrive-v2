import { NextResponse } from "next/server"
import { CrmCommandError } from "./errors"

/**
 * Ответ экрана на отказ команды — тот же вид, что у маршрутов сделок:
 * `{ error, code }` со статусом команды. Всё, что не CrmCommandError, —
 * настоящая поломка: она пробрасывается дальше, в общий обработчик.
 */
export function crmCommandErrorResponse(error: unknown): NextResponse {
  if (error instanceof CrmCommandError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  throw error
}
