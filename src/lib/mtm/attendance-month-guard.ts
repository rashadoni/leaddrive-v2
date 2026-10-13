import { Prisma } from "@prisma/client"
export function isAttendanceMonthClosedWrite(error:unknown):boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && ["P2004","P2010"].includes(error.code)
    && (error.message.includes("MTM_ATTENDANCE_MONTH_CLOSED") || JSON.stringify(error.meta??{}).includes("MTM_ATTENDANCE_MONTH_CLOSED"))
}
